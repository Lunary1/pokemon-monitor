'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { StoreView } from '../lib/stores';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-fg)',
  color: 'var(--color-bg)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

interface FormState {
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
  pollingInterval: number;
  minIntervalMs: number;
  ignoreRobotsTxt: boolean;
}

function toFormState(store: StoreView | null, adapterKeys: string[]): FormState {
  return {
    key: store?.key ?? '',
    name: store?.name ?? '',
    baseUrl: store?.baseUrl ?? '',
    adapterKey: store?.adapterKey ?? adapterKeys[0] ?? '',
    enabled: store?.enabled ?? true,
    pollingInterval: store?.pollingInterval ?? 300,
    minIntervalMs: store?.minIntervalMs ?? 10_000,
    ignoreRobotsTxt: store?.ignoreRobotsTxt ?? false,
  };
}

export function StoreForm({
  store,
  adapterKeys,
  onDone,
}: {
  /** null creates a new store; a StoreView edits that store. */
  store: StoreView | null;
  adapterKeys: string[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(store, adapterKeys));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isEdit = store !== null;

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus('idle');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);

    const response = await fetch(isEdit ? `/api/stores/${store.id}` : '/api/stores', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (response.ok) {
      setStatus('saved');
      if (!isEdit) setForm(toFormState(null, adapterKeys));
      router.refresh();
      onDone?.();
    } else {
      const body = await response.json().catch(() => null);
      const problems = body?.problems as string[] | undefined;
      setError(problems?.join('; ') ?? body?.error ?? 'Failed to save');
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Key" hint="Stable identifier, unique across stores (e.g. dreamland).">
        <input
          value={form.key}
          onChange={(e) => update('key', e.target.value)}
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Base URL">
        <input
          type="url"
          value={form.baseUrl}
          onChange={(e) => update('baseUrl', e.target.value)}
          placeholder="https://www.example.be"
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Adapter" hint="Which scraper handles this store's product pages.">
        <select
          value={form.adapterKey}
          onChange={(e) => update('adapterKey', e.target.value)}
          style={inputStyle}
        >
          {adapterKeys.map((key) => (
            <option key={key} value={key}>
              {key === 'toychamp' ? 'toychamp (legacy alias for dreamland)' : key}
            </option>
          ))}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Polling interval (s)">
          <input
            type="number"
            min={0}
            value={form.pollingInterval}
            onChange={(e) => update('pollingInterval', Number(e.target.value))}
            style={inputStyle}
          />
        </Field>
        <Field label="Min interval (ms)">
          <input
            type="number"
            min={0}
            value={form.minIntervalMs}
            onChange={(e) => update('minIntervalMs', Number(e.target.value))}
            style={inputStyle}
          />
        </Field>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => update('enabled', e.target.checked)}
        />
        Enabled
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.ignoreRobotsTxt}
          onChange={(e) => update('ignoreRobotsTxt', e.target.checked)}
        />
        Ignore robots.txt
      </label>
      {form.ignoreRobotsTxt && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--color-outofstock)',
            border: '1px solid var(--color-outofstock)',
            borderRadius: 6,
            padding: '8px 10px',
          }}
        >
          This store will poll without honouring robots.txt. Every bypass is logged at WARN.
          Only enable this knowingly, for a site you have permission to scrape.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="submit" disabled={status === 'saving'} style={buttonStyle}>
          {status === 'saving' ? 'Saving…' : isEdit ? 'Save store' : 'Create store'}
        </button>
        {status === 'saved' && (
          <span style={{ color: 'var(--color-instock)', fontSize: 13 }}>Saved</span>
        )}
        {status === 'error' && (
          <span style={{ color: 'var(--color-outofstock)', fontSize: 13 }}>{error}</span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', flex: 1 }}>
      <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.7 }}>{hint}</span>
      )}
    </label>
  );
}
