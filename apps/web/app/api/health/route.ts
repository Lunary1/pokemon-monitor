import { NextResponse } from 'next/server';
import { getHealth } from '../../../lib/health';

export const dynamic = 'force-dynamic';

/**
 * Always 200 while the process is serving, including when `stale` is true or
 * `db` is `error`. External uptime checks match on the JSON body (see
 * `docs/RUNBOOK.md`): a non-200 here would mean "the web service is down",
 * which is a different incident with a different fix than "the worker is
 * behind" or "Postgres is unreachable".
 */
export async function GET() {
  return NextResponse.json(await getHealth());
}
