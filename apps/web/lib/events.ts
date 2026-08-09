import { prisma, type StockEventType } from '@pokemon-monitor/db';

export interface EventListItem {
  id: string;
  eventType: StockEventType;
  previousPrice: number | null;
  currentPrice: number | null;
  occurredAt: Date;
  product: { id: string; name: string; url: string };
  store: { id: string; name: string };
}

export interface ListEventsParams {
  page?: number;
  limit?: number;
  productId?: string;
  storeId?: string;
  eventType?: StockEventType;
}

export interface ListEventsResult {
  events: EventListItem[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listEvents(params: ListEventsParams = {}): Promise<ListEventsResult> {
  const page = params.page && params.page > 0 ? params.page : 1;
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_LIMIT) : DEFAULT_LIMIT;

  const where = {
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.eventType ? { eventType: params.eventType } : {}),
    ...(params.storeId ? { product: { storeId: params.storeId } } : {}),
  };

  const [events, total] = await Promise.all([
    prisma.stockEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        product: {
          include: {
            store: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.stockEvent.count({ where }),
  ]);

  return {
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      previousPrice: event.previousPrice,
      currentPrice: event.currentPrice,
      occurredAt: event.occurredAt,
      product: { id: event.product.id, name: event.product.name, url: event.product.url },
      store: { id: event.product.store.id, name: event.product.store.name },
    })),
    total,
    page,
    limit,
  };
}
