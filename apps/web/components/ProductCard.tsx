import type { ProductListItem } from '../lib/products';
import { CheckNowButton } from './CheckNowButton';
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
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <a
        href={product.url}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{ fontWeight: 600 }}>{product.name}</div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{product.store.name}</div>
      </a>
      <div style={{ textAlign: 'right' }}>
        <StatusBadge status={statusOf(product)} />
        <div style={{ marginTop: 6, fontSize: 14 }}>
          {check ? formatPrice(check.price, check.currency) : '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          {check ? `Checked ${new Date(check.checkedAt).toLocaleString()}` : 'Never checked'}
        </div>
        <div style={{ marginTop: 8 }}>
          <CheckNowButton productId={product.id} />
        </div>
      </div>
    </div>
  );
}
