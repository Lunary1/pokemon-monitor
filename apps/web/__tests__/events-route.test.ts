import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyStockEvent = vi.fn();
const countStockEvent = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    stockEvent: {
      findMany: (...args: unknown[]) => findManyStockEvent(...args),
      count: (...args: unknown[]) => countStockEvent(...args),
    },
  },
}));

import { GET } from '../app/api/events/route';

const occurredAt = new Date('2026-01-01T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  countStockEvent.mockResolvedValue(1);
});

describe('GET /api/events', () => {
  test('returns paginated events joined with product and store', async () => {
    findManyStockEvent.mockResolvedValue([
      {
        id: 'event-1',
        eventType: 'RESTOCK',
        previousPrice: null,
        currentPrice: 54.99,
        occurredAt,
        product: {
          id: 'product-1',
          name: 'Scarlet & Violet Booster Box',
          url: 'https://www.toychamp.be/pokemon-sv-booster-box',
          store: { id: 'store-1', name: 'ToyChamp' },
        },
      },
    ]);

    const request = new Request('http://localhost/api/events');
    const response = await GET(request);
    const body = await response.json();

    expect(findManyStockEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { occurredAt: 'desc' },
        skip: 0,
        take: 20,
        include: expect.objectContaining({
          product: expect.objectContaining({
            include: expect.objectContaining({ store: expect.any(Object) }),
          }),
        }),
      }),
    );
    expect(body).toEqual({
      events: [
        {
          id: 'event-1',
          eventType: 'RESTOCK',
          previousPrice: null,
          currentPrice: 54.99,
          occurredAt: occurredAt.toISOString(),
          product: {
            id: 'product-1',
            name: 'Scarlet & Violet Booster Box',
            url: 'https://www.toychamp.be/pokemon-sv-booster-box',
          },
          store: { id: 'store-1', name: 'ToyChamp' },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  test('applies productId, storeId, eventType filters and pagination params', async () => {
    findManyStockEvent.mockResolvedValue([]);
    countStockEvent.mockResolvedValue(0);

    const request = new Request(
      'http://localhost/api/events?page=2&limit=5&productId=product-1&storeId=store-1&eventType=PRICE_DROP',
    );
    await GET(request);

    expect(findManyStockEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productId: 'product-1',
          eventType: 'PRICE_DROP',
          product: { storeId: 'store-1' },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  test('ignores an invalid eventType filter', async () => {
    findManyStockEvent.mockResolvedValue([]);
    countStockEvent.mockResolvedValue(0);

    const request = new Request('http://localhost/api/events?eventType=NOT_REAL');
    await GET(request);

    expect(findManyStockEvent).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  test('caps limit at the maximum page size', async () => {
    findManyStockEvent.mockResolvedValue([]);
    countStockEvent.mockResolvedValue(0);

    const request = new Request('http://localhost/api/events?limit=500');
    await GET(request);

    expect(findManyStockEvent).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
