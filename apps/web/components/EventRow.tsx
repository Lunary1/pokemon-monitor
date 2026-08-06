import type { EventListItem } from '../lib/events';

const EVENT_LABELS: Record<EventListItem['eventType'], string> = {
  RESTOCK: 'Restocked',
  OUT_OF_STOCK: 'Out of stock',
  PRICE_DROP: 'Price drop',
  PRICE_INCREASE: 'Price increase',
  ADAPTER_ERROR: 'Adapter error',
};

const EVENT_COLORS: Record<EventListItem['eventType'], string> = {
  RESTOCK: 'var(--color-instock)',
  OUT_OF_STOCK: 'var(--color-outofstock)',
  PRICE_DROP: 'var(--color-instock)',
  PRICE_INCREASE: 'var(--color-outofstock)',
  ADAPTER_ERROR: 'var(--color-muted)',
};

function formatPrice(price: number | null): string {
  if (price === null) return '—';
  return new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR' }).format(price);
}

export function EventRow({ event }: { event: EventListItem }) {
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
      <div>
        <div style={{ fontWeight: 600 }}>{event.product.name}</div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{event.store.name}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            background: EVENT_COLORS[event.eventType],
          }}
        >
          {EVENT_LABELS[event.eventType]}
        </span>
        {(event.eventType === 'PRICE_DROP' || event.eventType === 'PRICE_INCREASE') && (
          <div style={{ marginTop: 6, fontSize: 14 }}>
            {formatPrice(event.previousPrice)} → {formatPrice(event.currentPrice)}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>
          {new Date(event.occurredAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
