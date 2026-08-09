export type StatusBadgeStatus = 'in-stock' | 'out-of-stock' | 'unknown';

const LABELS: Record<StatusBadgeStatus, string> = {
  'in-stock': 'In stock',
  'out-of-stock': 'Out of stock',
  unknown: 'Unknown',
};

const COLORS: Record<StatusBadgeStatus, string> = {
  'in-stock': 'var(--color-instock)',
  'out-of-stock': 'var(--color-outofstock)',
  unknown: 'var(--color-muted)',
};

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: '#fff',
        background: COLORS[status],
      }}
    >
      {LABELS[status]}
    </span>
  );
}
