import { beforeEach, describe, expect, test, vi } from 'vitest';

const findFirstSetting = vi.fn();
const createSetting = vi.fn();
const updateSetting = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    setting: {
      findFirst: (...args: unknown[]) => findFirstSetting(...args),
      create: (...args: unknown[]) => createSetting(...args),
      update: (...args: unknown[]) => updateSetting(...args),
    },
  },
}));

import { GET, PATCH } from '../app/api/settings/route';

const existingSetting = {
  id: 'setting-1',
  discordWebhookUrl: 'https://discord.com/api/webhooks/existing',
  telegramBotToken: null,
  telegramChatId: null,
  emailAddress: null,
  notificationsEnabled: true,
  defaultCooldownSecs: 3600,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/settings', () => {
  test('returns the existing settings row, scoped to the exposed fields', async () => {
    findFirstSetting.mockResolvedValue(existingSetting);

    const response = await GET();
    const body = await response.json();

    expect(createSetting).not.toHaveBeenCalled();
    expect(body).toEqual({
      discordWebhookUrl: 'https://discord.com/api/webhooks/existing',
      notificationsEnabled: true,
      defaultCooldownSecs: 3600,
    });
  });

  test('creates a default row when none exists yet', async () => {
    findFirstSetting.mockResolvedValue(null);
    createSetting.mockResolvedValue({
      id: 'setting-new',
      discordWebhookUrl: null,
      telegramBotToken: null,
      telegramChatId: null,
      emailAddress: null,
      notificationsEnabled: true,
      defaultCooldownSecs: 3600,
    });

    const response = await GET();
    const body = await response.json();

    expect(createSetting).toHaveBeenCalledWith({ data: {} });
    expect(body).toEqual({
      discordWebhookUrl: null,
      notificationsEnabled: true,
      defaultCooldownSecs: 3600,
    });
  });
});

describe('PATCH /api/settings', () => {
  test('updates only the supplied fields on the existing row', async () => {
    findFirstSetting.mockResolvedValue(existingSetting);
    updateSetting.mockResolvedValue({
      ...existingSetting,
      notificationsEnabled: false,
    });

    const request = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ notificationsEnabled: false }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(updateSetting).toHaveBeenCalledWith({
      where: { id: 'setting-1' },
      data: { notificationsEnabled: false },
    });
    expect(body.notificationsEnabled).toBe(false);
  });

  test('creates a default row first when patching before any settings exist', async () => {
    findFirstSetting.mockResolvedValue(null);
    createSetting.mockResolvedValue({ ...existingSetting, id: 'setting-new' });
    updateSetting.mockResolvedValue({
      ...existingSetting,
      id: 'setting-new',
      defaultCooldownSecs: 1800,
    });

    const request = new Request('http://localhost/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ defaultCooldownSecs: 1800 }),
    });
    await PATCH(request);

    expect(createSetting).toHaveBeenCalledWith({ data: {} });
    expect(updateSetting).toHaveBeenCalledWith({
      where: { id: 'setting-new' },
      data: { defaultCooldownSecs: 1800 },
    });
  });
});
