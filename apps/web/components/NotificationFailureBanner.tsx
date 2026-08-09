import Link from 'next/link';
import type { NotificationHealth } from '../lib/notification-health';

/**
 * Warns that Discord delivery is persistently failing.
 *
 * Lives on the dashboard rather than going out over Discord on purpose: when
 * the notification channel itself is what's broken, an alert sent through that
 * same channel can't arrive. The dashboard is reachable independently.
 */
export function NotificationFailureBanner({ health }: { health: NotificationHealth }) {
  if (!health.failing) return null;

  return (
    <div
      role="alert"
      data-testid="notification-failure-banner"
      style={{
        background: 'var(--color-error)',
        color: '#fff',
        padding: '10px 24px',
        fontSize: 14,
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <strong>Notifications are failing.</strong>{' '}
        The last {health.consecutiveFailures} Discord deliveries did not go through — restock
        alerts are not reaching you. Check the webhook URL in{' '}
        <Link href="/settings" style={{ color: '#fff' }}>
          Settings
        </Link>
        {health.lastError ? <> (last error: {health.lastError})</> : null}.
      </div>
    </div>
  );
}
