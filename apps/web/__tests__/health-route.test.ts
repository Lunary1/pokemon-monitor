import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const aggregateStore = vi.fn();
const findFirstStockCheck = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    store: {
      aggregate: (...args: unknown[]) => aggregateStore(...args),
    },
    stockCheck: {
      findFirst: (...args: unknown[]) => findFirstStockCheck(...args),
    },
  },
}));

import { GET } from '../app/api/health/route';
import { getHealth, isStale } from '../lib/health';

/** Default polling interval is 300s, so the staleness threshold is 600s. */
const POLLING_INTERVAL_SECS = 300;
const THRESHOLD_MS = POLLING_INTERVAL_SECS * 2 * 1000;

const now = new Date('2026-08-09T12:00:00.000Z');

function ago(ms: number): Date {
  return new Date(now.getTime() - ms);
}

beforeEach(() => {
  vi.clearAllMocks();
  aggregateStore.mockResolvedValue({ _min: { pollingInterval: POLLING_INTERVAL_SECS } });
  findFirstStockCheck.mockResolvedValue({ checkedAt: ago(1000) });
});

describe('isStale', () => {
  test('is false for a check inside the threshold', () => {
    expect(isStale(ago(THRESHOLD_MS - 1000), POLLING_INTERVAL_SECS, now)).toBe(false);
  });

  test('is true for a check beyond the threshold', () => {
    expect(isStale(ago(THRESHOLD_MS + 1000), POLLING_INTERVAL_SECS, now)).toBe(true);
  });

  test('is false exactly at the threshold', () => {
    // The rule is "older than 2x", so the boundary itself is not yet stale.
    expect(isStale(ago(THRESHOLD_MS), POLLING_INTERVAL_SECS, now)).toBe(false);
  });

  test('is true one millisecond past the threshold', () => {
    expect(isStale(ago(THRESHOLD_MS + 1), POLLING_INTERVAL_SECS, now)).toBe(true);
  });

  test('derives the threshold from the interval rather than a fixed constant', () => {
    // A 60s store goes stale after 120s, where a 300s store would not.
    const elapsed = 130 * 1000;

    expect(isStale(ago(elapsed), 60, now)).toBe(true);
    expect(isStale(ago(elapsed), 300, now)).toBe(false);
  });

  test('is false when no check has ever run', () => {
    // A fresh deploy has not fallen behind; alerting here would fire on every
    // clean deploy and train the operator to ignore the signal.
    expect(isStale(null, POLLING_INTERVAL_SECS, now)).toBe(false);
  });

  test('is false when no store is enabled', () => {
    // Nothing is scheduled, so there is no cadence to be behind.
    expect(isStale(ago(THRESHOLD_MS * 10), null, now)).toBe(false);
  });
});

describe('getHealth', () => {
  test('reports the shortest enabled polling interval as the threshold source', async () => {
    aggregateStore.mockResolvedValue({ _min: { pollingInterval: 60 } });
    findFirstStockCheck.mockResolvedValue({ checkedAt: ago(130 * 1000) });

    const health = await getHealth(now);

    expect(health.stale).toBe(true);
    expect(aggregateStore).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
        _min: { pollingInterval: true },
      }),
    );
  });

  test('only counts checks for enabled products in enabled stores', async () => {
    await getHealth(now);

    expect(findFirstStockCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { product: { enabled: true, store: { enabled: true } } },
        orderBy: { checkedAt: 'desc' },
      }),
    );
  });

  test('reports db error without throwing when Postgres is unreachable', async () => {
    findFirstStockCheck.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    const health = await getHealth(now);

    expect(health.db).toBe('error');
    expect(health.worker).toBe('degraded');
    expect(health.stale).toBe(true);
    expect(health.lastCheck).toBeNull();
  });

  test('does not leak the database error text into the response', async () => {
    // This endpoint is the one most likely to be exposed to an external uptime
    // checker, and Prisma errors can carry connection-string fragments.
    findFirstStockCheck.mockRejectedValue(
      new Error('Authentication failed against database server at `db.internal:5432`'),
    );

    const health = await getHealth(now);

    expect(JSON.stringify(health)).not.toContain('db.internal');
    expect(JSON.stringify(health)).not.toContain('Authentication failed');
  });
});

describe('GET /api/health', () => {
  // The route calls getHealth() with no argument, so it reads the real clock.
  // Freezing it lets the fixtures below stay relative to `now`.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  test('returns the documented response shape', async () => {
    const checkedAt = ago(1000);
    findFirstStockCheck.mockResolvedValue({ checkedAt });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      worker: 'running',
      db: 'ok',
      lastCheck: checkedAt.toISOString(),
      stale: false,
    });
  });

  test('returns 200 with stale: true rather than a 5xx when the worker is behind', async () => {
    // UptimeRobot matches on the body, per docs/RUNBOOK.md. A 5xx here would
    // be indistinguishable from the web service itself being down, which is a
    // different incident with a different fix.
    findFirstStockCheck.mockResolvedValue({ checkedAt: ago(THRESHOLD_MS + 60_000) });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.worker).toBe('degraded');
  });

  test('returns 200 with db: error rather than a 5xx when Postgres is down', async () => {
    findFirstStockCheck.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.db).toBe('error');
  });

  test('reports lastCheck null and stale false on a fresh deploy', async () => {
    findFirstStockCheck.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.lastCheck).toBeNull();
    expect(body.stale).toBe(false);
    expect(body.worker).toBe('running');
  });

  test('reports stale false when no store is enabled', async () => {
    aggregateStore.mockResolvedValue({ _min: { pollingInterval: null } });
    findFirstStockCheck.mockResolvedValue({ checkedAt: ago(THRESHOLD_MS * 10) });

    const response = await GET();
    const body = await response.json();

    expect(body.stale).toBe(false);
    expect(body.worker).toBe('running');
  });
});
