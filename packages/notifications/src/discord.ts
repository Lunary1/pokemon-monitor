import got from 'got';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields: DiscordEmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string };
}

export interface DiscordPayload {
  username: string;
  embeds: DiscordEmbed[];
}

export interface DiscordSendResult {
  ok: boolean;
  error?: string;
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * POST a payload to a Discord webhook.
 *
 * Never throws: a revoked webhook, a rate limit, or a Discord outage must not
 * take down the caller's check cycle. Failures come back as `ok: false` with a
 * message the caller persists on the Notification row.
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordPayload,
): Promise<DiscordSendResult> {
  try {
    await got.post(webhookUrl, {
      json: payload,
      timeout: { request: SEND_TIMEOUT_MS },
      retry: { limit: 0 },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
