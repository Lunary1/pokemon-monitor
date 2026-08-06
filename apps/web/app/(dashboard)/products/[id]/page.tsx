import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckRow } from '../../../../components/CheckRow';
import { CheckNowButton } from '../../../../components/CheckNowButton';
import { StatusBadge, type StatusBadgeStatus } from '../../../../components/StatusBadge';
import { getProduct, type ProductDetail } from '../../../../lib/products';

export const dynamic = 'force-dynamic';

function statusOf(product: ProductDetail): StatusBadgeStatus {
  if (!product.latestCheck) return 'unknown';
  if (product.latestCheck.availability?.startsWith('ERROR')) return 'unknown';
  return product.latestCheck.inStock ? 'in-stock' : 'out-of-stock';
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!product) notFound();

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <Link href="/products" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
        ← Back to products
      </Link>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginTop: 12,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>{product.name}</h1>
          <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>{product.store.name}</div>
          <a
            href={product.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: 'var(--color-muted)' }}
          >
            View on store ↗
          </a>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge status={statusOf(product)} />
          <div style={{ marginTop: 8 }}>
            <CheckNowButton productId={product.id} />
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Check history</h2>
      {product.checks.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>No checks yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {product.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>
      )}
    </main>
  );
}
