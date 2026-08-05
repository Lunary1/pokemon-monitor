import { NextResponse } from 'next/server';
import { listProducts } from '../../../lib/products';

export const dynamic = 'force-dynamic';

export async function GET() {
  const products = await listProducts();
  return NextResponse.json(products);
}
