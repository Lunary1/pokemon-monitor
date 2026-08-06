'use client';

import { useState } from 'react';
import type { StoreView } from '../lib/stores';

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  fontFamily: 'ui-monospace, monospace',
  resize: 'vertical',
};

export function StoreConfigList({ initialStores }: { initialStores: StoreView[] }) {
  if (initialStores.length === 0) {
    return <p style={{ fontSize: 14, opacity: 0.7 }}>No stores configured yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {initialStores.map((store) => (
        <StoreConfigEditor key={store.id} store={store} />
      ))}
    </div>
  );
}

function StoreConfigEditor({ store }: { store: StoreView }) {
  const [text, setText] = useState(
    store.adapterConfig === null ? '' : JSON.stringify(store.adapterConfig, null, 2),
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    let config: unknown = null;
    const trimmed = text.trim();
    if (trimmed !== '') {
      try {
        config = JSON.parse(trimmed);
      } catch {
        setError('Not valid JSON');
        setStatus('error');
        return;
      }
    }

    setStatus('saving');
    setError(null);

    const response = await fetch(`/api/stores/${store.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapterConfig: config }),
    });

    if (response.ok) {
      setStatus('saved');
    } else {
      const body = await response.json().catch(() => null);
      const problems = body?.problems as string[] | undefined;
      setError(problems?.join('; ') ?? body?.error ?? 'Failed to save');
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSave}>
      <label
        htmlFor={`store-config-${store.id}`}
        style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}
      >
        {store.name}{' '}
        <span style={{ fontWeight: 400, opacity: 0.7 }}>
          ({store.adapterKey})
        </span>
      </label>
      <textarea
        id={`store-config-${store.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'{\n  "minIntervalMs": 10000,\n  "defaultTimeoutMs": 12000,\n  "customHeaders": { "Accept-Language": "nl-BE" }\n}'}
        spellCheck={false}
        style={textareaStyle}
      />
      <p style={{ margin: '6px 0 10px', fontSize: 12, opacity: 0.7 }}>
        JSON overrides for this store&apos;s adapter. Recognized keys: minIntervalMs,
        defaultTimeoutMs, customHeaders. Leave empty and save to revert to the
        adapter&apos;s defaults.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            background: 'var(--color-fg)',
            color: 'var(--color-bg)',
            fontSize: 13,
            fontWeight: 600,
            cursor: status === 'saving' ? 'default' : 'pointer',
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save config'}
        </button>
        {status === 'saved' && <span style={{ color: 'var(--color-instock)', fontSize: 13 }}>Saved</span>}
        {status === 'error' && (
          <span style={{ color: 'var(--color-outofstock)', fontSize: 13 }}>{error}</span>
        )}
      </div>
    </form>
  );
}
