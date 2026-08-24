'use client';

import { useState } from 'react';
import { ProductForm, type StoreOption } from './ProductForm';

export function NewProductSection({ stores }: { stores: StoreOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
          {open ? 'Cancel' : 'New product'}
        </button>
      </div>

      {open && (
        <section
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>New product</h2>
          <ProductForm product={null} stores={stores} onDone={() => setOpen(false)} />
        </section>
      )}
    </>
  );
}
