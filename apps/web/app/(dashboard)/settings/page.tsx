import { SettingsForm } from '../../../components/SettingsForm';
import { getSettings } from '../../../lib/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Settings</h1>
      <SettingsForm initialSettings={settings} />
    </main>
  );
}
