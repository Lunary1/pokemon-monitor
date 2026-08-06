import { NextResponse } from 'next/server';
import type { StockEventType } from '@pokemon-monitor/db';
import { listEvents } from '../../../lib/events';

export const dynamic = 'force-dynamic';

const VALID_EVENT_TYPES: StockEventType[] = [
  'RESTOCK',
  'OUT_OF_STOCK',
  'PRICE_DROP',
  'PRICE_INCREASE',
  'ADAPTER_ERROR',
];

function parseEventType(value: string | null): StockEventType | undefined {
  if (!value) return undefined;
  return VALID_EVENT_TYPES.includes(value as StockEventType) ? (value as StockEventType) : undefined;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const page = Number(searchParams.get('page')) || undefined;
  const limit = Number(searchParams.get('limit')) || undefined;
  const productId = searchParams.get('productId') ?? undefined;
  const storeId = searchParams.get('storeId') ?? undefined;
  const eventType = parseEventType(searchParams.get('eventType'));

  const result = await listEvents({ page, limit, productId, storeId, eventType });
  return NextResponse.json(result);
}
