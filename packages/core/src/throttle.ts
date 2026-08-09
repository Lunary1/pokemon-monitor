const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until at least `minIntervalMs` has passed since the last call for
 * `domain`, then records the current time as that domain's last request.
 * Shared module-level state, so all callers within the process throttle
 * against the same clock per domain.
 */
export async function throttleDomain(
  domain: string,
  minIntervalMs: number,
): Promise<void> {
  const last = lastRequestAt.get(domain);
  const now = Date.now();

  if (last !== undefined) {
    const elapsed = now - last;
    const remaining = minIntervalMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }

  lastRequestAt.set(domain, Date.now());
}

/** Test-only: clears throttle state between test cases. */
export function resetThrottleState(): void {
  lastRequestAt.clear();
}
