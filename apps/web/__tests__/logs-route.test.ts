import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyErrorLog = vi.fn();
const countErrorLog = vi.fn();
const groupByErrorLog = vi.fn();
const deleteManyErrorLog = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    errorLog: {
      findMany: (...args: unknown[]) => findManyErrorLog(...args),
      count: (...args: unknown[]) => countErrorLog(...args),
      groupBy: (...args: unknown[]) => groupByErrorLog(...args),
      deleteMany: (...args: unknown[]) => deleteManyErrorLog(...args),
    },
  },
}));

import { DELETE, GET } from '../app/api/logs/route';
import { InvalidPurgeError, listLogs, purgeLogs } from '../lib/logs';

const logRow = {
  id: 'log-1',
  source: 'notification',
  level: 'ERROR' as const,
  message: 'Discord webhook returned 401',
  stack: null,
  context: { eventId: 'event-1' },
  occurredAt: new Date('2026-08-09T10:00:00.000Z'),
};

function makeRequest(query = ''): Request {
  return new Request(`http://localhost/api/logs${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyErrorLog.mockResolvedValue([logRow]);
  countErrorLog.mockResolvedValue(1);
  groupByErrorLog.mockResolvedValue([{ source: 'notification' }, { source: 'adapter:dreamland' }]);
  deleteManyErrorLog.mockResolvedValue({ count: 0 });
});

describe('GET /api/logs', () => {
  test('returns paginated rows with the distinct source list', async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.sources).toEqual(['notification', 'adapter:dreamland']);
    expect(body.logs[0]).toMatchObject({
      id: 'log-1',
      source: 'notification',
      level: 'ERROR',
      message: 'Discord webhook returned 401',
    });
  });

  test('newest logs come first', async () => {
    await GET(makeRequest());

    expect(findManyErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { occurredAt: 'desc' } }),
    );
  });

  test('filters by source and level together', async () => {
    await GET(makeRequest('?source=notification&level=ERROR'));

    expect(findManyErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: 'notification', level: 'ERROR' } }),
    );
  });

  test('ignores an unrecognised level rather than returning nothing', async () => {
    // A bad filter value should not silently produce an empty page that looks
    // like "no errors" — the operator would read that as good news.
    await GET(makeRequest('?level=BOGUS'));

    expect(findManyErrorLog).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  test('paginates with skip/take', async () => {
    await GET(makeRequest('?page=3&limit=10'));

    expect(findManyErrorLog).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  test('caps limit so a caller cannot request the whole table', async () => {
    await GET(makeRequest('?limit=5000'));

    expect(findManyErrorLog).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  test('the source list is not narrowed by the active filter', async () => {
    // The list drives the filter control, so filtering to one source must not
    // remove every other option from the UI.
    await GET(makeRequest('?source=notification'));

    expect(groupByErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['source'] }),
    );
    expect(groupByErrorLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() }),
    );
  });
});

describe('listLogs', () => {
  test('defaults to page 1 with the default limit', async () => {
    const result = await listLogs();

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  test('treats a zero or negative page as page 1', async () => {
    expect((await listLogs({ page: 0 })).page).toBe(1);
    expect((await listLogs({ page: -3 })).page).toBe(1);
  });
});

describe('DELETE /api/logs', () => {
  test('purges rows older than the cutoff and reports the count', async () => {
    deleteManyErrorLog.mockResolvedValue({ count: 42 });

    const response = await DELETE(makeRequest('?olderThanDays=30'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(42);
    expect(deleteManyErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({ where: { occurredAt: { lt: expect.any(Date) } } }),
    );
  });

  test('rejects a missing olderThanDays rather than defaulting', async () => {
    // A bare DELETE must not purge anything — this deletion is irreversible.
    const response = await DELETE(makeRequest());

    expect(response.status).toBe(400);
    expect(deleteManyErrorLog).not.toHaveBeenCalled();
  });

  test('rejects olderThanDays=0, which would mean the entire table', async () => {
    const response = await DELETE(makeRequest('?olderThanDays=0'));

    expect(response.status).toBe(400);
    expect(deleteManyErrorLog).not.toHaveBeenCalled();
  });

  test.each(['-5', 'abc', ''])('rejects olderThanDays=%s without deleting', async (value) => {
    const response = await DELETE(makeRequest(`?olderThanDays=${value}`));

    expect(response.status).toBe(400);
    expect(deleteManyErrorLog).not.toHaveBeenCalled();
  });
});

describe('purgeLogs', () => {
  test('computes the cutoff as N days before now', async () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    deleteManyErrorLog.mockResolvedValue({ count: 0 });

    const { cutoff } = await purgeLogs(7, now);

    expect(cutoff.toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  test('deletes strictly older than the cutoff, not on or after it', async () => {
    deleteManyErrorLog.mockResolvedValue({ count: 0 });

    await purgeLogs(30, new Date('2026-08-09T12:00:00.000Z'));

    const call = deleteManyErrorLog.mock.calls[0][0];
    expect(call.where.occurredAt).toHaveProperty('lt');
    expect(call.where.occurredAt).not.toHaveProperty('lte');
  });

  test('throws InvalidPurgeError for a non-positive window', async () => {
    await expect(purgeLogs(0)).rejects.toBeInstanceOf(InvalidPurgeError);
    await expect(purgeLogs(-1)).rejects.toBeInstanceOf(InvalidPurgeError);
    await expect(purgeLogs(Number.NaN)).rejects.toBeInstanceOf(InvalidPurgeError);
  });
});
