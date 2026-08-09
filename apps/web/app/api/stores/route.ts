import { NextResponse } from 'next/server';
import { listStores } from '../../../lib/stores';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stores = await listStores();
  return NextResponse.json(stores);
}
