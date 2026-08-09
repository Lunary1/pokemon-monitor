import Link from 'next/link';
import { LogRow } from '../../../components/LogRow';
import { LOG_LEVELS, listLogs, parseLogLevel } from '../../../lib/logs';

export const dynamic = 'force-dynamic';

interface LogsPageProps {
  searchParams: Promise<{ source?: string; level?: string; page?: string }>;
}

function filterHref(params: { source?: string; level?: string }): string {
  const query = new URLSearchParams();
  if (params.source) query.set('source', params.source);
  if (params.level) query.set('level', params.level);
  const qs = query.toString();
  return qs ? `/logs?${qs}` : '/logs';
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 12,
  textDecoration: 'none',
  border: '1px solid var(--color-border)',
  background: active ? 'var(--color-fg)' : 'transparent',
  color: active ? 'var(--color-bg)' : 'var(--color-fg)',
});

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const { source, level: rawLevel, page: rawPage } = await searchParams;
  const level = parseLogLevel(rawLevel);
  const page = Number(rawPage) || 1;

  const { logs, total, limit, sources } = await listLogs({ page, source, level });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (source) query.set('source', source);
    if (level) query.set('level', level);
    if (target > 1) query.set('page', String(target));
    const qs = query.toString();
    return qs ? `/logs?${qs}` : '/logs';
  };

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>Logs</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0 20px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--color-muted)', minWidth: 48 }}>Level</span>
          <Link href={filterHref({ source })} style={chipStyle(!level)}>
            All
          </Link>
          {LOG_LEVELS.map((value) => (
            <Link key={value} href={filterHref({ source, level: value })} style={chipStyle(level === value)}>
              {value}
            </Link>
          ))}
        </div>

        {sources.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--color-muted)', minWidth: 48 }}>Source</span>
            <Link href={filterHref({ level })} style={chipStyle(!source)}>
              All
            </Link>
            {sources.map((value) => (
              <Link key={value} href={filterHref({ source: value, level })} style={chipStyle(source === value)}>
                {value}
              </Link>
            ))}
          </div>
        )}
      </div>

      {logs.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>
          {total === 0 && !source && !level ? 'No logs yet.' : 'No logs match this filter.'}
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 20,
                fontSize: 14,
              }}
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)}>← Newer</Link>
              ) : (
                <span style={{ color: 'var(--color-muted)' }}>← Newer</span>
              )}
              <span style={{ color: 'var(--color-muted)' }}>
                Page {page} of {totalPages} ({total} entries)
              </span>
              {page < totalPages ? (
                <Link href={pageHref(page + 1)}>Older →</Link>
              ) : (
                <span style={{ color: 'var(--color-muted)' }}>Older →</span>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
