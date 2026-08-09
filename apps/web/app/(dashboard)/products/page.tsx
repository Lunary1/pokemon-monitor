import { ProductCard } from '../../../components/ProductCard';
import { listProducts } from '../../../lib/products';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Products</h1>
      {products.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>No products yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </main>
  );
}
