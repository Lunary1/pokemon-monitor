import { NextResponse } from 'next/server';
import {
  deleteProduct,
  DuplicateProductUrlError,
  getProduct,
  InvalidProductError,
  ProductNotFoundError,
  updateProduct,
  type ProductPatch,
} from '../../../../lib/products';

export const dynamic = 'force-dynamic';

/** Product columns editable over PATCH. */
const PRODUCT_FIELDS = [
  'storeId',
  'name',
  'url',
  'imageUrl',
  'tags',
  'enabled',
  'trackPrice',
  'notifyOnRestock',
  'notifyOnDrop',
  'priceDrop',
] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) {
    return NextResponse.json({ error: `Product not found: ${id}` }, { status: 404 });
  }

  return NextResponse.json(product);
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
  const patch: Record<string, unknown> = {};
  for (const field of PRODUCT_FIELDS) {
    if (field in record) patch[field] = record[field];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: `Body must include at least one of: ${PRODUCT_FIELDS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const product = await updateProduct(id, patch as ProductPatch);
    return NextResponse.json(product);
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof InvalidProductError) {
      return NextResponse.json({ error: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof DuplicateProductUrlError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await deleteProduct(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
