import { NextResponse } from 'next/server';
import { getProduct } from '../../../../lib/products';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) {
    return NextResponse.json({ error: `Product not found: ${id}` }, { status: 404 });
  }

  return NextResponse.json(product);
}
