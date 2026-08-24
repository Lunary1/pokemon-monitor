'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  fontSize: 12,
  textDecoration: 'underline',
  cursor: 'pointer',
};

export function ProductActions({
  productId,
  productName,
  enabled,
}: {
  productId: string;
  productName: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !confirm(
        `Delete "${productName}"? If it has check history it will be disabled instead of removed.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    const response = await fetch(`/api/products/${productId}`, { method: 'DELETE' });

    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Failed to delete');
    }
    setBusy(false);
  }

  async function handleReEnable() {
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? 'Failed to re-enable');
    }
    setBusy(false);
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {enabled ? (
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          style={{ ...linkButtonStyle, color: 'var(--color-outofstock)' }}
        >
          {busy ? 'Working…' : 'Delete'}
        </button>
      ) : (
        <button type="button" onClick={handleReEnable} disabled={busy} style={linkButtonStyle}>
          {busy ? 'Working…' : 'Re-enable'}
        </button>
      )}
      {error && <span style={{ fontSize: 12, color: 'var(--color-outofstock)' }}>{error}</span>}
    </span>
  );
}
