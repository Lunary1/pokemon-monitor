import { NextResponse } from 'next/server';
import { InvalidPurgeError, listLogs, parseLogLevel, purgeLogs } from '../../../lib/logs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const page = Number(searchParams.get('page')) || undefined;
  const limit = Number(searchParams.get('limit')) || undefined;
  const source = searchParams.get('source') ?? undefined;
  const level = parseLogLevel(searchParams.get('level'));

  const result = await listLogs({ page, limit, source, level });
  return NextResponse.json(result);
}

/**
 * Purge logs older than `?olderThanDays=N`.
 *
 * The parameter is required — a bare `DELETE /api/logs` is rejected rather
 * than defaulted, because this deletion is irreversible and an accidental
 * no-argument call should do nothing. Deliberately not wired to a dashboard
 * button: the dashboard is unauthenticated (auth is excluded per plan §1), so
 * this stays a deliberate curl/cron operation.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('olderThanDays');

  if (raw === null) {
    return NextResponse.json(
      { error: 'olderThanDays query parameter is required' },
      { status: 400 },
    );
  }

  try {
    const result = await purgeLogs(Number(raw));
    return NextResponse.json({ deleted: result.deleted, cutoff: result.cutoff.toISOString() });
  } catch (err) {
    if (err instanceof InvalidPurgeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
