import { prisma } from '@pokemon-monitor/db';

export interface SettingsView {
  discordWebhookUrl: string | null;
  notificationsEnabled: boolean;
  defaultCooldownSecs: number;
}

export interface SettingsPatch {
  discordWebhookUrl?: string | null;
  notificationsEnabled?: boolean;
  defaultCooldownSecs?: number;
}

function toView(setting: {
  discordWebhookUrl: string | null;
  notificationsEnabled: boolean;
  defaultCooldownSecs: number;
}): SettingsView {
  return {
    discordWebhookUrl: setting.discordWebhookUrl,
    notificationsEnabled: setting.notificationsEnabled,
    defaultCooldownSecs: setting.defaultCooldownSecs,
  };
}

async function getOrCreateSettingRow() {
  const existing = await prisma.setting.findFirst();
  if (existing) return existing;
  return prisma.setting.create({ data: {} });
}

export async function getSettings(): Promise<SettingsView> {
  const setting = await getOrCreateSettingRow();
  return toView(setting);
}

export async function updateSettings(patch: SettingsPatch): Promise<SettingsView> {
  const setting = await getOrCreateSettingRow();
  const updated = await prisma.setting.update({
    where: { id: setting.id },
    data: patch,
  });
  return toView(updated);
}
