import { NextResponse } from 'next/server';
import {
  createProduct,
  DuplicateProductUrlError,
  InvalidProductError,
  listProducts,
  type ProductInput,
} from '../../../lib/products';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const includeDisabled =
    new URL(request.url).searchParams.get('includeDisabled') === 'true';
  const products = await listProducts({ includeDisabled });
  return NextResponse.json(products);
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
    const product = await createProduct(body as ProductInput);
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidProductError) {
      return NextResponse.json({ error: err.message, problems: err.problems }, { status: 400 });
    }
    if (err instanceof DuplicateProductUrlError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
