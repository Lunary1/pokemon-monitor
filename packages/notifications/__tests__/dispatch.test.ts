import { beforeEach, describe, expect, test, vi } from 'vitest';

const findUniqueProduct = vi.fn();
const findFirstSetting = vi.fn();
const findFirstNotification = vi.fn();
const createNotification = vi.fn();
const recordErrorLog = vi.fn();
const sendDiscordWebhook = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => findUniqueProduct(...args) },
    setting: { findFirst: (...args: unknown[]) => findFirstSetting(...args) },
    notification: {
      findFirst: (...args: unknown[]) => findFirstNotification(...args),
      create: (...args: unknown[]) => createNotification(...args),
    },
  },
}));

vi.mock('@pokemon-monitor/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  recordErrorLog: (...args: unknown[]) => recordErrorLog(...args),
}));

vi.mock('../src/discord', async () => {
  const actual = await vi.importActual<typeof import('../src/discord')>('../src/discord');
  return {
    ...actual,
    sendDiscordWebhook: (...args: unknown[]) => sendDiscordWebhook(...args),
  };
});

import { dispatch } from '../src/index';

const occurredAt = new Date('2026-01-01T12:00:00.000Z');

const product = {
  id: 'product-1',
  name: 'Scarlet & Violet Booster Box',
  url: 'https://www.toychamp.be/pokemon-sv-booster-box',
  imageUrl: null,
  store: { name: 'ToyChamp' },
};

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    productId: 'product-1',
    eventType: 'RESTOCK',
    previousPrice: null,
    currentPrice: 54.99,
    occurredAt,
    ...overrides,
  } as never;
}

/** The status of the single Notification row written by a dispatch call. */
function writtenStatus(): string {
  return createNotification.mock.calls[0][0].data.status;
}

function writtenData(): Record<string, unknown> {
  return createNotification.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DISCORD_WEBHOOK_URL;

  findUniqueProduct.mockResolvedValue(product);
  findFirstSetting.mockResolvedValue({
    notificationsEnabled: true,
    defaultCooldownSecs: 3600,
    discordWebhookUrl: 'https://discord.com/api/webhooks/test',
  });
  findFirstNotification.mockResolvedValue(null);
  createNotification.mockResolvedValue({});
  recordErrorLog.mockResolvedValue(undefined);
  sendDiscordWebhook.mockResolvedValue({ ok: true });
});

describe('dispatch', () => {
  test('sends a RESTOCK notification and records it as SENT', async () => {
    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SENT');
    expect(sendDiscordWebhook).toHaveBeenCalledTimes(1);
    expect(writtenStatus()).toBe('SENT');
    expect(writtenData().sentAt).toBeInstanceOf(Date);
    expect(writtenData().channel).toBe('DISCORD');
  });

  test('sends a PRICE_DROP notification', async () => {
    const result = await dispatch(
      makeEvent({ eventType: 'PRICE_DROP', previousPrice: 49.99, currentPrice: 39.99 }),
    );

    expect(result.outcome).toBe('SENT');
    const [, payload] = sendDiscordWebhook.mock.calls[0];
    expect(payload.embeds[0].title).toContain('Price Drop');
  });

  test('skips when notifications are globally disabled', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: false,
      defaultCooldownSecs: 3600,
      discordWebhookUrl: 'https://discord.com/api/webhooks/test',
    });

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SKIPPED');
    expect(sendDiscordWebhook).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe('SKIPPED');
  });

  test.each(['OUT_OF_STOCK', 'PRICE_INCREASE', 'ADAPTER_ERROR'])(
    'skips non-notifying event type %s',
    async (eventType) => {
      const result = await dispatch(makeEvent({ eventType }));

      expect(result.outcome).toBe('SKIPPED');
      expect(sendDiscordWebhook).not.toHaveBeenCalled();
      expect(writtenStatus()).toBe('SKIPPED');
    },
  );

  test('skips a duplicate of the same event type within the dedup window', async () => {
    findFirstNotification.mockResolvedValueOnce({ id: 'notification-earlier' });

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SKIPPED');
    expect(result.reason).toContain('duplicate');
    expect(sendDiscordWebhook).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe('SKIPPED');
  });

  test('queries dedup scoped to the same product and event type', async () => {
    await dispatch(makeEvent());

    expect(findFirstNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          productId: 'product-1',
          status: 'SENT',
          event: { eventType: 'RESTOCK' },
        }),
      }),
    );
  });

  test('skips when a SENT notification exists inside the cooldown window', async () => {
    // First findFirst is the dedup probe (no match), second is the cooldown probe.
    findFirstNotification
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'notification-recent' });

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SKIPPED');
    expect(result.reason).toContain('cooldown');
    expect(sendDiscordWebhook).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe('SKIPPED');
  });

  test('derives the cooldown window from defaultCooldownSecs', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: true,
      defaultCooldownSecs: 60,
      discordWebhookUrl: 'https://discord.com/api/webhooks/test',
    });

    const before = Date.now();
    await dispatch(makeEvent());
    const after = Date.now();

    const cooldownCall = findFirstNotification.mock.calls[1][0];
    const gte = cooldownCall.where.createdAt.gte as Date;
    // The cutoff is `dispatch`'s own Date.now() minus the 60s window, and that
    // clock reading sits somewhere in [before, after]. Bracketing it against
    // both ends is what makes this exact rather than timing-dependent:
    // comparing only against `before` asserts the window is >= 60s when any
    // elapsed time inside dispatch necessarily makes it smaller, so it only
    // passed when the two readings landed on the same millisecond.
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(gte.getTime()).toBeLessThanOrEqual(after - 60_000);
  });

  test('records FAILED without throwing when the webhook send fails', async () => {
    sendDiscordWebhook.mockResolvedValue({ ok: false, error: 'connect ECONNREFUSED' });

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('FAILED');
    expect(writtenStatus()).toBe('FAILED');
    expect(writtenData().error).toContain('ECONNREFUSED');
  });

  test('skips when no webhook is configured anywhere', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: true,
      defaultCooldownSecs: 3600,
      discordWebhookUrl: null,
    });

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SKIPPED');
    expect(result.reason).toContain('webhook');
    expect(sendDiscordWebhook).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe('SKIPPED');
  });

  test('falls back to DISCORD_WEBHOOK_URL when the setting is null', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: true,
      defaultCooldownSecs: 3600,
      discordWebhookUrl: null,
    });
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/from-env';

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SENT');
    expect(sendDiscordWebhook).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/from-env',
      expect.anything(),
    );
  });

  test('prefers the DB setting over the env fallback', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/from-env';

    await dispatch(makeEvent());

    expect(sendDiscordWebhook).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/test',
      expect.anything(),
    );
  });

  test('skips when the product no longer exists', async () => {
    findUniqueProduct.mockResolvedValue(null);

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('SKIPPED');
    expect(sendDiscordWebhook).not.toHaveBeenCalled();
    expect(writtenStatus()).toBe('SKIPPED');
  });

  test('does not throw when the database itself fails', async () => {
    findUniqueProduct.mockRejectedValue(new Error('connection lost'));

    await expect(dispatch(makeEvent())).resolves.toEqual(
      expect.objectContaining({ outcome: 'FAILED' }),
    );
  });

  test('mirrors an unexpected dispatch failure into ErrorLog', async () => {
    findUniqueProduct.mockRejectedValue(new Error('connection lost'));

    await dispatch(makeEvent());

    expect(recordErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'notification',
        message: 'connection lost',
        context: { eventId: 'event-1', productId: 'product-1' },
      }),
    );
  });

  test('writes exactly one Notification row per dispatch', async () => {
    await dispatch(makeEvent());
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch — surfacing failures to ErrorLog', () => {
  test('mirrors a delivery failure into ErrorLog', async () => {
    sendDiscordWebhook.mockResolvedValue({ ok: false, error: 'Request failed with status code 401' });

    await dispatch(makeEvent());

    expect(recordErrorLog).toHaveBeenCalledTimes(1);
    const call = recordErrorLog.mock.calls[0][0];
    expect(call.source).toBe('notification');
    expect(call.message).toContain('401');
    expect(call.context).toEqual({
      eventId: 'event-1',
      productId: 'product-1',
      channel: 'DISCORD',
    });
  });

  test('does not write to ErrorLog on a successful send', async () => {
    await dispatch(makeEvent());

    expect(recordErrorLog).not.toHaveBeenCalled();
  });

  test('does not write to ErrorLog when the dispatch was merely skipped', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: false,
      defaultCooldownSecs: 3600,
      discordWebhookUrl: 'https://discord.com/api/webhooks/test',
    });

    await dispatch(makeEvent());

    expect(recordErrorLog).not.toHaveBeenCalled();
  });

  // recordErrorLog's own no-throw-on-failure contract is covered by
  // packages/core/__tests__/errorLog.test.ts; dispatch() just relies on it.
});
