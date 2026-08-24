'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { StoreView } from '../lib/stores';
import { StoreForm } from './StoreForm';

export function StoreList({
  stores,
  adapterKeys,
}: {
  stores: StoreView[];
  adapterKeys: string[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {creating ? 'Cancel' : 'New store'}
        </button>
      </div>

      {creating && (
        <section
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>New store</h2>
          <StoreForm store={null} adapterKeys={adapterKeys} onDone={() => setCreating(false)} />
        </section>
      )}

      {stores.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>No stores yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stores.map((store) => (
            <StoreRow key={store.id} store={store} adapterKeys={adapterKeys} />
          ))}
        </div>
      )}
    </>
  );
}

function StoreRow({ store, adapterKeys }: { store: StoreView; adapterKeys: string[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete store "${store.name}"? This cannot be undone.`)) return;

    setDeleting(true);
    setDeleteError(null);

    const response = await fetch(`/api/stores/${store.id}`, { method: 'DELETE' });

    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => null);
      setDeleteError(body?.error ?? 'Failed to delete');
      setDeleting(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 15 }}>{store.name}</strong>
        <span style={{ fontSize: 13, opacity: 0.7 }}>{store.adapterKey}</span>
        {!store.enabled && (
          <span style={{ fontSize: 12, color: 'var(--color-outofstock)' }}>disabled</span>
        )}
        {store.ignoreRobotsTxt && (
          <span style={{ fontSize: 12, color: 'var(--color-outofstock)' }}>ignores robots.txt</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={linkButtonStyle}
          >
            {expanded ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{ ...linkButtonStyle, color: 'var(--color-outofstock)' }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </span>
      </div>

      <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.7 }}>
        {store.baseUrl} · every {store.pollingInterval}s
      </p>

      {deleteError && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-outofstock)' }}>
          {deleteError}
        </p>
      )}

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
          <StoreForm
            store={store}
            adapterKeys={adapterKeys}
            onDone={() => setExpanded(false)}
          />
        </div>
      )}
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  fontSize: 13,
  textDecoration: 'underline',
  cursor: 'pointer',
};
