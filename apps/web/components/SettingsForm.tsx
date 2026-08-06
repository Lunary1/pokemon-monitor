'use client';

import { useState } from 'react';
import type { SettingsView } from '../lib/settings';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 14,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
};

export function SettingsForm({ initialSettings }: { initialSettings: SettingsView }) {
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(
    initialSettings.discordWebhookUrl ?? '',
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    initialSettings.notificationsEnabled,
  );
  const [defaultCooldownSecs, setDefaultCooldownSecs] = useState(
    String(initialSettings.defaultCooldownSecs),
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');

    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discordWebhookUrl: discordWebhookUrl || null,
        notificationsEnabled,
        defaultCooldownSecs: Number(defaultCooldownSecs) || 0,
      }),
    });

    setStatus(response.ok ? 'saved' : 'error');
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 480 }}
    >
      <div>
        <label style={labelStyle} htmlFor="discordWebhookUrl">
          Discord webhook URL
        </label>
        <input
          id="discordWebhookUrl"
          type="url"
          placeholder="https://discord.com/api/webhooks/..."
          value={discordWebhookUrl}
          onChange={(e) => setDiscordWebhookUrl(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="defaultCooldownSecs">
          Default cooldown (seconds)
        </label>
        <input
          id="defaultCooldownSecs"
          type="number"
          min={0}
          value={defaultCooldownSecs}
          onChange={(e) => setDefaultCooldownSecs(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="notificationsEnabled"
          type="checkbox"
          checked={notificationsEnabled}
          onChange={(e) => setNotificationsEnabled(e.target.checked)}
        />
        <label htmlFor="notificationsEnabled" style={{ fontSize: 14 }}>
          Notifications enabled
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            background: 'var(--color-fg)',
            color: 'var(--color-bg)',
            fontSize: 14,
            fontWeight: 600,
            cursor: status === 'saving' ? 'default' : 'pointer',
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {status === 'saved' && <span style={{ color: 'var(--color-instock)' }}>Saved</span>}
        {status === 'error' && <span style={{ color: 'var(--color-outofstock)' }}>Failed to save</span>}
      </div>
    </form>
  );
}
