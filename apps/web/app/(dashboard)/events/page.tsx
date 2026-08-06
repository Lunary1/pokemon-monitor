import { EventRow } from '../../../components/EventRow';
import { listEvents } from '../../../lib/events';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const { events } = await listEvents();

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Events</h1>
      {events.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>No events yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  );
}
