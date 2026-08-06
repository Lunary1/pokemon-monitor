import { NextResponse } from 'next/server';
import {
  InvalidAdapterConfigError,
  StoreNotFoundError,
  updateStoreAdapterConfig,
} from '../../../../lib/stores';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('adapterConfig' in body)) {
    return NextResponse.json(
      { error: 'Body must include an adapterConfig field (object, or null to reset)' },
      { status: 400 },
    );
  }

  try {
    const store = await updateStoreAdapterConfig(id, (body as { adapterConfig: unknown }).adapterConfig);
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
    throw err;
  }
}
