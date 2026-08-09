import type { LogListItem } from '../lib/logs';

const LEVEL_COLORS: Record<LogListItem['level'], string> = {
  INFO: 'var(--color-muted)',
  WARN: 'var(--color-outofstock)',
  ERROR: 'var(--color-outofstock)',
};

const preStyle: React.CSSProperties = {
  margin: '8px 0 0',
  padding: 10,
  borderRadius: 6,
  background: 'var(--color-border)',
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
};

export function LogRow({ log }: { log: LogListItem }) {
  // `context` is operator-facing debugging detail, so it is rendered verbatim
  // rather than summarised — but only when present, to keep rows scannable.
  const context =
    log.context === null || log.context === undefined
      ? null
      : JSON.stringify(log.context, null, 2);

  return (
    <div
      data-testid="log-row"
      style={{
        padding: 16,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            background: LEVEL_COLORS[log.level],
          }}
        >
          {log.level}
        </span>
        <span style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>{log.source}</span>
        <span style={{ fontSize: 12, color: 'var(--color-muted)', marginLeft: 'auto' }}>
          {new Date(log.occurredAt).toLocaleString()}
        </span>
      </div>

      <div style={{ marginTop: 8, fontWeight: 600 }}>{log.message}</div>

      {context && <pre style={preStyle}>{context}</pre>}
      {log.stack && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 13, cursor: 'pointer', color: 'var(--color-muted)' }}>
            Stack trace
          </summary>
          <pre style={preStyle}>{log.stack}</pre>
        </details>
      )}
    </div>
  );
}
