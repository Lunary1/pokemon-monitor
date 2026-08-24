import Link from 'next/link';
import type { ProductListItem } from '../lib/products';
import { CheckNowButton } from './CheckNowButton';
import { ProductActions } from './ProductActions';
import { StatusBadge, type StatusBadgeStatus } from './StatusBadge';

function statusOf(product: ProductListItem): StatusBadgeStatus {
  if (!product.latestCheck) return 'unknown';
  if (product.latestCheck.availability?.startsWith('ERROR')) return 'unknown';
  return product.latestCheck.inStock ? 'in-stock' : 'out-of-stock';
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '—';
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency }).format(price);
}

export function ProductCard({ product }: { product: ProductListItem }) {
  const check = product.latestCheck;

  return (
    <div
      data-testid="product-card"
      data-product-id={product.id}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        opacity: product.enabled ? 1 : 0.55,
      }}
    >
      <div>
        <Link
          href={`/products/${product.id}`}
          style={{ textDecoration: 'none', color: 'inherit', fontWeight: 600 }}
        >
          {product.name}
        </Link>
        {!product.enabled && (
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-muted)' }}>disabled</span>
        )}
        <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{product.store.name}</div>
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--color-muted)' }}
        >
          View on store ↗
        </a>
      </div>
      <div style={{ textAlign: 'right' }}>
        <StatusBadge status={statusOf(product)} />
        <div style={{ marginTop: 6, fontSize: 14 }}>
          {check ? formatPrice(check.price, check.currency) : '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          {check ? `Checked ${new Date(check.checkedAt).toLocaleString()}` : 'Never checked'}
        </div>
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          {product.enabled && <CheckNowButton productId={product.id} />}
          <ProductActions
            productId={product.id}
            productName={product.name}
            enabled={product.enabled}
          />
        </div>
      </div>
    </div>
  );
}
