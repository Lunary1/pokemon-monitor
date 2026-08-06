import { SettingsForm } from '../../../components/SettingsForm';
import { StoreConfigList } from '../../../components/StoreConfigEditor';
import { getSettings } from '../../../lib/settings';
import { listStores } from '../../../lib/stores';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [settings, stores] = await Promise.all([getSettings(), listStores()]);

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Settings</h1>
      <SettingsForm initialSettings={settings} />

      <h2 style={{ marginTop: 40 }}>Store adapter configuration</h2>
      <StoreConfigList initialStores={stores} />
    </main>
  );
}
