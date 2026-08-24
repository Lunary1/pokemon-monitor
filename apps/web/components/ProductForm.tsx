'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ProductListItem } from '../lib/products';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
};

export interface StoreOption {
  id: string;
  name: string;
}

/**
 * Fields the form owns. `tags` is edited as a comma-separated string and split
 * on submit; `priceDrop` stays a string so the input can be left empty.
 */
interface FormState {
  storeId: string;
  name: string;
  url: string;
  imageUrl: string;
  tags: string;
  enabled: boolean;
  trackPrice: boolean;
  notifyOnRestock: boolean;
  notifyOnDrop: boolean;
  priceDrop: string;
}

export interface ProductFormValues extends ProductListItem {
  tags?: string[];
  trackPrice?: boolean;
  notifyOnRestock?: boolean;
  notifyOnDrop?: boolean;
  priceDrop?: number | null;
}

function toFormState(product: ProductFormValues | null, stores: StoreOption[]): FormState {
  return {
    storeId: product?.store.id ?? stores[0]?.id ?? '',
    name: product?.name ?? '',
    url: product?.url ?? '',
    imageUrl: product?.imageUrl ?? '',
    tags: product?.tags?.join(', ') ?? '',
    enabled: product?.enabled ?? true,
    trackPrice: product?.trackPrice ?? true,
    notifyOnRestock: product?.notifyOnRestock ?? true,
    notifyOnDrop: product?.notifyOnDrop ?? false,
    priceDrop: product?.priceDrop != null ? String(product.priceDrop) : '',
  };
}

export function ProductForm({
  product,
  stores,
  onDone,
}: {
  /** null creates a new product; a product edits that one. */
  product: ProductFormValues | null;
  stores: StoreOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(product, stores));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const isEdit = product !== null;

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus('idle');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);

    const payload = {
      storeId: form.storeId,
      name: form.name,
      url: form.url,
      imageUrl: form.imageUrl.trim(),
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
      enabled: form.enabled,
      trackPrice: form.trackPrice,
      notifyOnRestock: form.notifyOnRestock,
      notifyOnDrop: form.notifyOnDrop,
      priceDrop: form.priceDrop.trim() === '' ? null : Number(form.priceDrop),
    };

    const response = await fetch(isEdit ? `/api/products/${product.id}` : '/api/products', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      setStatus('saved');
      if (!isEdit) setForm(toFormState(null, stores));
      router.refresh();
      onDone?.();
    } else {
      const body = await response.json().catch(() => null);
      const problems = body?.problems as string[] | undefined;
      setError(problems?.join('; ') ?? body?.error ?? 'Failed to save');
      setStatus('error');
    }
  }

  if (stores.length === 0) {
    return (
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Add a store first — every product belongs to one.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label="Store">
        <select
          value={form.storeId}
          onChange={(e) => update('storeId', e.target.value)}
          style={inputStyle}
        >
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Name">
        <input
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Product URL">
        <input
          type="url"
          value={form.url}
          onChange={(e) => update('url', e.target.value)}
          placeholder="https://www.example.be/product/..."
          required
          style={inputStyle}
        />
      </Field>

      <Field label="Image URL" hint="Optional.">
        <input
          type="url"
          value={form.imageUrl}
          onChange={(e) => update('imageUrl', e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="Tags" hint="Comma-separated. Optional.">
        <input
          value={form.tags}
          onChange={(e) => update('tags', e.target.value)}
          placeholder="etb, scarlet-violet"
          style={inputStyle}
        />
      </Field>

      <Checkbox
        label="Enabled"
        checked={form.enabled}
        onChange={(v) => update('enabled', v)}
      />
      <Checkbox
        label="Track price"
        checked={form.trackPrice}
        onChange={(v) => update('trackPrice', v)}
      />
      <Checkbox
        label="Notify on restock"
        checked={form.notifyOnRestock}
        onChange={(v) => update('notifyOnRestock', v)}
      />
      <Checkbox
        label="Notify on price drop"
        checked={form.notifyOnDrop}
        onChange={(v) => update('notifyOnDrop', v)}
      />

      {form.notifyOnDrop && (
        <Field label="Price-drop threshold" hint="Notify when the price falls to or below this.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.priceDrop}
            onChange={(e) => update('priceDrop', e.target.value)}
            style={inputStyle}
          />
        </Field>
      )}

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
          {status === 'saving' ? 'Saving…' : isEdit ? 'Save product' : 'Add product'}
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
    <label style={{ display: 'block' }}>
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

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
