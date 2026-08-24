import { prisma, type LogLevel } from '@pokemon-monitor/db';
import { logger } from './logger';

export interface RecordErrorLogInput {
  /** e.g. "worker", "adapter:dreamland", "notification". */
  source: string;
  level?: LogLevel;
  message: string;
  stack?: string | null;
  context?: Record<string, unknown>;
}

/**
 * Write one ErrorLog row so a failure surfaces in the dashboard log viewer
 * instead of only stdout.
 *
 * Deliberately swallows its own failure: none of this helper's callers
 * (worker loop, notification dispatch, manual check) may throw from their
 * own error-reporting path — that would turn an ErrorLog write failure into
 * a second, unrelated outage.
 */
export async function recordErrorLog(input: RecordErrorLogInput): Promise<void> {
  try {
    await prisma.errorLog.create({
      data: {
        source: input.source,
        level: input.level ?? 'ERROR',
        message: input.message,
        stack: input.stack ?? null,
        context: (input.context ?? undefined) as object | undefined,
      },
    });
  } catch (err) {
    logger.error({ err, source: input.source }, 'failed to write ErrorLog row');
  }
}
