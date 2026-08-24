import { NextResponse } from 'next/server';
import {
  deleteStore,
  DuplicateStoreKeyError,
  InvalidAdapterConfigError,
  InvalidStoreError,
  StoreHasProductsError,
  StoreNotFoundError,
  updateStore,
  updateStoreAdapterConfig,
  type StorePatch,
} from '../../../../lib/stores';

export const dynamic = 'force-dynamic';

/** Store columns editable over PATCH, alongside the separate `adapterConfig` field. */
const STORE_FIELDS = [
  'key',
  'name',
  'baseUrl',
  'adapterKey',
  'enabled',
  'pollingInterval',
  'minIntervalMs',
  'ignoreRobotsTxt',
] as const;

function pickStoreFields(body: Record<string, unknown>): StorePatch {
  const patch: Record<string, unknown> = {};
  for (const field of STORE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  return patch as StorePatch;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const storePatch = pickStoreFields(record);
  const hasStoreFields = Object.keys(storePatch).length > 0;
  const hasAdapterConfig = 'adapterConfig' in record;

  if (!hasStoreFields && !hasAdapterConfig) {
    return NextResponse.json(
      {
        error: `Body must include adapterConfig (object, or null to reset) or at least one of: ${STORE_FIELDS.join(', ')}`,
      },
      { status: 400 },
    );
  }

  try {
    // Store columns and adapterConfig live in different tables; apply whichever
    // the body carried, and return the view reflecting both.
    let store = hasStoreFields ? await updateStore(id, storePatch) : undefined;
    if (hasAdapterConfig) {
      store = await updateStoreAdapterConfig(id, record.adapterConfig);
    }
    return NextResponse.json(store);
  } catch (err) {
    if (err instanceof StoreNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidAdapterConfigError) {
      return NextResponse.json(
        { error: 'Invalid adapter config', problems: err.problems },
        { status: 400 },
      );
    }
    if (err instanceof InvalidStoreError) {
      return NextResponse.json({ error: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof DuplicateStoreKeyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await deleteStore(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof StoreNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof StoreHasProductsError) {
      return NextResponse.json(
        { error: err.message, productCount: err.productCount },
        { status: 409 },
      );
    }
    throw err;
  }
}
