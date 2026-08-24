import { beforeEach, describe, expect, test, vi } from 'vitest';

const createErrorLog = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    errorLog: { create: (...args: unknown[]) => createErrorLog(...args) },
  },
}));

import { recordErrorLog } from '../src/errorLog';

beforeEach(() => {
  vi.clearAllMocks();
  createErrorLog.mockResolvedValue({});
});

describe('recordErrorLog', () => {
  test('writes an ErrorLog row with the given fields', async () => {
    await recordErrorLog({
      source: 'worker',
      message: 'adapter timed out',
      stack: 'Error: boom\n  at foo',
      context: { productId: 'product-1' },
    });

    expect(createErrorLog).toHaveBeenCalledWith({
      data: {
        source: 'worker',
        level: 'ERROR',
        message: 'adapter timed out',
        stack: 'Error: boom\n  at foo',
        context: { productId: 'product-1' },
      },
    });
  });

  test('defaults level to ERROR and stack to null when omitted', async () => {
    await recordErrorLog({ source: 'worker', message: 'no adapter registered' });

    expect(createErrorLog).toHaveBeenCalledWith({
      data: {
        source: 'worker',
        level: 'ERROR',
        message: 'no adapter registered',
        stack: null,
        context: undefined,
      },
    });
  });

  test('honors an explicit non-ERROR level', async () => {
    await recordErrorLog({ source: 'worker', level: 'WARN', message: 'degraded' });

    expect(createErrorLog.mock.calls[0][0].data.level).toBe('WARN');
  });

  test('does not throw when the write itself fails', async () => {
    createErrorLog.mockRejectedValue(new Error('ErrorLog table unavailable'));

    await expect(
      recordErrorLog({ source: 'worker', message: 'anything' }),
    ).resolves.toBeUndefined();
  });
});
