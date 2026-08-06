import { NextResponse } from 'next/server';
import { getSettings, updateSettings, type SettingsPatch } from '../../../lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await request.json();

  const patch: SettingsPatch = {};
  if ('discordWebhookUrl' in body) patch.discordWebhookUrl = body.discordWebhookUrl;
  if ('notificationsEnabled' in body) patch.notificationsEnabled = body.notificationsEnabled;
  if ('defaultCooldownSecs' in body) patch.defaultCooldownSecs = body.defaultCooldownSecs;

  const settings = await updateSettings(patch);
  return NextResponse.json(settings);
}
