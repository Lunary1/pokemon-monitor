import { prisma } from '@pokemon-monitor/db';

export interface HealthView {
  /** `degraded` whenever `stale` is true — the worker is up but falling behind. */
  worker: 'running' | 'degraded';
  db: 'ok' | 'error';
  /** Most recent StockCheck across enabled products, or null if none exist yet. */
  lastCheck: string | null;
  stale: boolean;
}

/**
 * How far behind `lastCheck` may fall before the worker counts as stale:
 * twice the shortest polling interval among enabled stores.
 *
 * Two intervals rather than one so a single skipped or slow cycle doesn't trip
 * the alert — the operator is paged for a stuck worker, not for jitter.
 */
const STALENESS_INTERVAL_MULTIPLIER = 2;

/**
 * Health snapshot for `GET /api/health`, per the contract in `docs/RUNBOOK.md`
 * and the staleness rule in `docs/SDLC.md` §9.
 *
 * Never throws: a database failure is reported as `db: 'error'` rather than
 * propagating. The endpoint answering at all is the signal that the `web`
 * process is alive, which is a different question from whether the database
 * or worker is healthy — collapsing them into a 5xx would lose that
 * distinction (RUNBOOK "Common failure signatures" treats them separately).
 */
export async function getHealth(now: Date = new Date()): Promise<HealthView> {
  try {
    // `pollingInterval` is seconds (see Store.pollingInterval and its use in
    // workers/monitor/src/loop.ts), so the threshold is converted to ms here.
    const [shortestInterval, latestCheck] = await Promise.all([
      prisma.store.aggregate({
        where: { enabled: true },
        _min: { pollingInterval: true },
      }),
      prisma.stockCheck.findFirst({
        where: { product: { enabled: true, store: { enabled: true } } },
        orderBy: { checkedAt: 'desc' },
        select: { checkedAt: true },
      }),
    ]);

    const lastCheck = latestCheck?.checkedAt ?? null;
    const stale = isStale(lastCheck, shortestInterval._min.pollingInterval, now);

    return {
      worker: stale ? 'degraded' : 'running',
      db: 'ok',
      lastCheck: lastCheck?.toISOString() ?? null,
      stale,
    };
  } catch {
    // The specific Prisma error is deliberately not surfaced in the response —
    // it can carry connection-string fragments, and this endpoint is the one
    // most likely to be exposed to an external uptime checker.
    return { worker: 'degraded', db: 'error', lastCheck: null, stale: true };
  }
}

/**
 * Is `lastCheck` older than the staleness threshold?
 *
 * Two cases deliberately report *not* stale rather than defaulting to alarm:
 *
 * - **No checks have ever run** (`lastCheck` null) — a fresh deploy hasn't
 *   fallen behind, it hasn't started. Alerting here would fire on every clean
 *   deploy and teach the operator to ignore the signal.
 * - **No enabled stores** (`pollingInterval` null) — nothing is scheduled, so
 *   there is no cadence to be behind, and no interval to derive a threshold
 *   from in the first place.
 */
export function isStale(
  lastCheck: Date | null,
  shortestPollingIntervalSecs: number | null,
  now: Date = new Date(),
): boolean {
  if (lastCheck === null || shortestPollingIntervalSecs === null) return false;

  const thresholdMs =
    shortestPollingIntervalSecs * 1000 * STALENESS_INTERVAL_MULTIPLIER;

  return now.getTime() - lastCheck.getTime() > thresholdMs;
}
