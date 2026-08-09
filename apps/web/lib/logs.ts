import { prisma, type LogLevel } from '@pokemon-monitor/db';

export interface LogListItem {
  id: string;
  source: string;
  level: LogLevel;
  message: string;
  stack: string | null;
  context: unknown;
  occurredAt: Date;
}

export interface ListLogsParams {
  page?: number;
  limit?: number;
  source?: string;
  level?: LogLevel;
}

export interface ListLogsResult {
  logs: LogListItem[];
  total: number;
  page: number;
  limit: number;
  /** Distinct `source` values present, so the viewer can offer a filter that matches reality. */
  sources: string[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const LOG_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR'];

export function parseLogLevel(value: string | null | undefined): LogLevel | undefined {
  if (!value) return undefined;
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : undefined;
}

export async function listLogs(params: ListLogsParams = {}): Promise<ListLogsResult> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

  const where = {
    ...(params.source ? { source: params.source } : {}),
    ...(params.level ? { level: params.level } : {}),
  };

  const [logs, total, sourceGroups] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.errorLog.count({ where }),
    // Unfiltered on purpose: the source list drives the filter control, so it
    // must keep showing every option even once a filter is applied.
    prisma.errorLog.groupBy({ by: ['source'], orderBy: { source: 'asc' } }),
  ]);

  return {
    logs: logs.map((log) => ({
      id: log.id,
      source: log.source,
      level: log.level,
      message: log.message,
      stack: log.stack,
      context: log.context,
      occurredAt: log.occurredAt,
    })),
    total,
    page,
    limit,
    sources: sourceGroups.map((group) => group.source),
  };
}

export class InvalidPurgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPurgeError';
  }
}

/**
 * Delete `ErrorLog` rows older than `olderThanDays`.
 *
 * `olderThanDays` is required and must be a positive finite number — there is
 * deliberately no default. A default here would mean a bare `DELETE /api/logs`
 * silently purges something, and this operation is irreversible.
 *
 * Zero is rejected for the same reason: `olderThanDays=0` reads as "everything
 * older than now", i.e. the entire table, which is far more likely to be a
 * caller bug than an intent.
 */
export async function purgeLogs(
  olderThanDays: number,
  now: Date = new Date(),
): Promise<{ deleted: number; cutoff: Date }> {
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
    throw new InvalidPurgeError('olderThanDays must be a positive number');
  }

  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);

  const { count } = await prisma.errorLog.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });

  return { deleted: count, cutoff };
}
