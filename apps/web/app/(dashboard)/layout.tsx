import Link from 'next/link';
import { NotificationFailureBanner } from '../../components/NotificationFailureBanner';
import { getNotificationHealth } from '../../lib/notification-health';

export const dynamic = 'force-dynamic';

const NAV_LINKS = [
  { href: '/products', label: 'Products' },
  { href: '/events', label: 'Events' },
  { href: '/settings', label: 'Settings' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const notificationHealth = await getNotificationHealth();

  return (
    <>
      <NotificationFailureBanner health={notificationHealth} />
      <header
        style={{
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <nav
          aria-label="Main"
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          <Link href="/products" style={{ fontWeight: 600, color: 'var(--color-fg)', textDecoration: 'none' }}>
            Pokemon Monitor
          </Link>
          <div style={{ display: 'flex', gap: 16 }}>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                style={{ color: 'var(--color-fg)', textDecoration: 'none' }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      {children}
    </>
  );
}
