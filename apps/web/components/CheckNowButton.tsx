'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CheckNowButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'checking' | 'error'>('idle');

  async function handleClick() {
    setStatus('checking');
    const response = await fetch(`/api/products/${productId}/check`, { method: 'POST' });

    if (!response.ok) {
      setStatus('error');
      return;
    }

    setStatus('idle');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === 'checking'}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--color-border)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        cursor: status === 'checking' ? 'default' : 'pointer',
      }}
    >
      {status === 'checking' ? 'Checking…' : status === 'error' ? 'Failed — retry' : 'Check now'}
    </button>
  );
}
