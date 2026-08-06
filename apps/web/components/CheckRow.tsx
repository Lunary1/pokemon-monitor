import type { ProductCheckItem } from '../lib/products';
import { StatusBadge, type StatusBadgeStatus } from './StatusBadge';

function statusOf(check: ProductCheckItem): StatusBadgeStatus {
  if (check.availability?.startsWith('ERROR')) return 'unknown';
  return check.inStock ? 'in-stock' : 'out-of-stock';
}

function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '—';
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency }).format(price);
}

export function CheckRow({ check }: { check: ProductCheckItem }) {
  return (
    <div
      data-testid="check-row"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: '10px 16px',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>
        {new Date(check.checkedAt).toLocaleString()}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 14 }}>{formatPrice(check.price, check.currency)}</span>
        <StatusBadge status={statusOf(check)} />
      </div>
    </div>
  );
}
