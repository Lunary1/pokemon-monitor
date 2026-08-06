import { NextResponse } from 'next/server';
import { AdapterNotFoundError, ProductNotFoundError, runManualCheck } from '../../../../../lib/checks';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const stockCheck = await runManualCheck(id);
    return NextResponse.json(stockCheck);
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AdapterNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
