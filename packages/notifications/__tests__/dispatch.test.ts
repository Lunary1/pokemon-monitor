import { beforeEach, describe, expect, test, vi } from 'vitest';

const findUniqueProduct = vi.fn();
const findFirstSetting = vi.fn();
const findFirstNotification = vi.fn();
const createNotification = vi.fn();
const createErrorLog = vi.fn();
const sendDiscordWebhook = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => findUniqueProduct(...args) },
    setting: { findFirst: (...args: unknown[]) => findFirstSetting(...args) },
    notification: {
      findFirst: (...args: unknown[]) => findFirstNotification(...args),
      create: (...args: unknown[]) => createNotification(...args),
    },
    errorLog: { create: (...args: unknown[]) => createErrorLog(...args) },
  },
}));

vi.mock('@pokemon-monitor/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
  createErrorLog.mockResolvedValue({});
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

    const cooldownCall = findFirstNotification.mock.calls[1][0];
    const gte = cooldownCall.where.createdAt.gte as Date;
    // 60s window, allowing a little slack for execution time.
    expect(before - gte.getTime()).toBeGreaterThanOrEqual(60_000);
    expect(before - gte.getTime()).toBeLessThan(65_000);
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

  test('writes exactly one Notification row per dispatch', async () => {
    await dispatch(makeEvent());
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch — surfacing failures to ErrorLog', () => {
  test('mirrors a delivery failure into ErrorLog', async () => {
    sendDiscordWebhook.mockResolvedValue({ ok: false, error: 'Request failed with status code 401' });

    await dispatch(makeEvent());

    expect(createErrorLog).toHaveBeenCalledTimes(1);
    const data = createErrorLog.mock.calls[0][0].data;
    expect(data.source).toBe('notification');
    expect(data.level).toBe('ERROR');
    expect(data.message).toContain('401');
    expect(data.context).toEqual({
      eventId: 'event-1',
      productId: 'product-1',
      channel: 'DISCORD',
    });
  });

  test('does not write to ErrorLog on a successful send', async () => {
    await dispatch(makeEvent());

    expect(createErrorLog).not.toHaveBeenCalled();
  });

  test('does not write to ErrorLog when the dispatch was merely skipped', async () => {
    findFirstSetting.mockResolvedValue({
      notificationsEnabled: false,
      defaultCooldownSecs: 3600,
      discordWebhookUrl: 'https://discord.com/api/webhooks/test',
    });

    await dispatch(makeEvent());

    expect(createErrorLog).not.toHaveBeenCalled();
  });

  test('still reports FAILED when the ErrorLog write itself fails', async () => {
    // The error-reporting path must never become the thing that breaks
    // dispatch — its no-throw contract has to hold even here.
    sendDiscordWebhook.mockResolvedValue({ ok: false, error: 'connect ECONNREFUSED' });
    createErrorLog.mockRejectedValue(new Error('ErrorLog table unavailable'));

    const result = await dispatch(makeEvent());

    expect(result.outcome).toBe('FAILED');
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(writtenStatus()).toBe('FAILED');
  });
});
