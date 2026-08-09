import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyNotification = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    notification: { findMany: (...args: unknown[]) => findManyNotification(...args) },
  },
}));

import { getNotificationHealth } from '../lib/notification-health';

function failed(error = 'Request failed with status code 401') {
  return { status: 'FAILED', error };
}

function sent() {
  return { status: 'SENT', error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNotificationHealth', () => {
  test('reports failing when the last three attempts all failed', async () => {
    findManyNotification.mockResolvedValue([failed(), failed(), failed()]);

    const health = await getNotificationHealth();

    expect(health.failing).toBe(true);
    expect(health.consecutiveFailures).toBe(3);
    expect(health.lastError).toContain('401');
  });

  test('does not report failing at two consecutive failures', async () => {
    findManyNotification.mockResolvedValue([failed(), failed(), sent()]);

    const health = await getNotificationHealth();

    expect(health.failing).toBe(false);
    expect(health.consecutiveFailures).toBe(2);
  });

  test('a recent success breaks the streak even with older failures', async () => {
    findManyNotification.mockResolvedValue([sent(), failed(), failed()]);

    const health = await getNotificationHealth();

    expect(health.failing).toBe(false);
    expect(health.consecutiveFailures).toBe(0);
  });

  test('is healthy when there are no delivery attempts at all', async () => {
    findManyNotification.mockResolvedValue([]);

    const health = await getNotificationHealth();

    expect(health.failing).toBe(false);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastError).toBeNull();
  });

  test('is healthy when fewer attempts exist than the threshold', async () => {
    findManyNotification.mockResolvedValue([failed(), failed()]);

    const health = await getNotificationHealth();

    expect(health.failing).toBe(false);
    expect(health.consecutiveFailures).toBe(2);
  });

  test('excludes SKIPPED rows from the query so quiet periods cannot mask an outage', async () => {
    findManyNotification.mockResolvedValue([failed(), failed(), failed()]);

    await getNotificationHealth();

    expect(findManyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['SENT', 'FAILED'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
    );
  });
});
