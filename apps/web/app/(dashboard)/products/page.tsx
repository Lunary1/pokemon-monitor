import { ProductCard } from '../../../components/ProductCard';
import { NewProductSection } from '../../../components/ProductListSection';
import { listProducts } from '../../../lib/products';
import { listStores } from '../../../lib/stores';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  // Disabled products are included so soft-deleted ones stay reachable and can
  // be re-enabled; ProductCard dims them.
  const [products, stores] = await Promise.all([
    listProducts({ includeDisabled: true }),
    listStores(),
  ]);

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Products</h1>
      <NewProductSection stores={stores.map((store) => ({ id: store.id, name: store.name }))} />
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
