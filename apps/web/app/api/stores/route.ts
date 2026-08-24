import { NextResponse } from 'next/server';
import {
  createStore,
  DuplicateStoreKeyError,
  InvalidStoreError,
  listStores,
  type StoreInput,
} from '../../../lib/stores';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stores = await listStores();
  return NextResponse.json(stores);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  try {
    const store = await createStore(body as StoreInput);
    return NextResponse.json(store, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidStoreError) {
      return NextResponse.json({ error: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof DuplicateStoreKeyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
