import { prisma } from '@pokemon-monitor/db';

/**
 * How many of the most recent delivery attempts must have failed before the
 * dashboard warns. One failure is noise (a transient 5xx or rate limit);
 * three consecutive is a pattern worth surfacing.
 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export interface NotificationHealth {
  failing: boolean;
  /** Most recent consecutive failures, capped at the threshold. */
  consecutiveFailures: number;
  /** Error from the latest failed attempt, for display. */
  lastError: string | null;
}

/**
 * Detect a persistently broken notification channel.
 *
 * Only SENT and FAILED rows count as delivery attempts — a SKIPPED row means
 * the service deliberately didn't send (cooldown, dedup, notifications off),
 * so counting them would let a quiet period either mask a real outage or
 * fabricate one.
 */
export async function getNotificationHealth(): Promise<NotificationHealth> {
  const recentAttempts = await prisma.notification.findMany({
    where: { status: { in: ['SENT', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    take: CONSECUTIVE_FAILURE_THRESHOLD,
    select: { status: true, error: true },
  });

  let consecutiveFailures = 0;
  for (const attempt of recentAttempts) {
    if (attempt.status !== 'FAILED') break;
    consecutiveFailures += 1;
  }

  return {
    failing: consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD,
    consecutiveFailures,
    lastError: recentAttempts[0]?.error ?? null,
  };
}
