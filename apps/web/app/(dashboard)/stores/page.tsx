import { listAdapterKeys } from '@pokemon-monitor/store-adapters';
import { StoreList } from '../../../components/StoreList';
import { listStores } from '../../../lib/stores';

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const stores = await listStores();

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Stores</h1>
      <StoreList stores={stores} adapterKeys={listAdapterKeys()} />
    </main>
  );
}
