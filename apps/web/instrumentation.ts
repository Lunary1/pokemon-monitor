export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertRequiredEnv } = await import('@pokemon-monitor/core');
  assertRequiredEnv(['DATABASE_URL']);
}
