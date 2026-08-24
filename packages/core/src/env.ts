/**
 * Fails fast with one clear error instead of letting callers (worker
 * check-cycle, web request handlers) discover a missing env var only when
 * they first touch the database, once per tick/request, forever.
 */
export function assertRequiredEnv(vars: string[]): void {
  const missing = vars.filter((name) => !process.env[name]);
  if (missing.length === 0) return;

  throw new Error(
    `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and fill in the values before starting the app.',
  );
}
