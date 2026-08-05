import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyProduct = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: { findMany: (...args: unknown[]) => findManyProduct(...args) },
  },
}));

import { GET } from '../app/api/products/route';

const checkedAt = new Date('2026-01-01T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/products', () => {
  test('returns products joined with their latest stock check', async () => {
    findManyProduct.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Scarlet & Violet Booster Box',
        url: 'https://www.toychamp.be/pokemon-sv-booster-box',
        imageUrl: null,
        store: { id: 'store-1', name: 'ToyChamp' },
        checks: [
          {
            inStock: true,
            price: 54.99,
            currency: 'EUR',
            availability: 'Op voorraad',
            checkedAt,
          },
        ],
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(findManyProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
        include: expect.objectContaining({
          checks: expect.objectContaining({ take: 1 }),
        }),
      }),
    );
    expect(body).toEqual([
      {
        id: 'product-1',
        name: 'Scarlet & Violet Booster Box',
        url: 'https://www.toychamp.be/pokemon-sv-booster-box',
        imageUrl: null,
        store: { id: 'store-1', name: 'ToyChamp' },
        latestCheck: {
          inStock: true,
          price: 54.99,
          currency: 'EUR',
          availability: 'Op voorraad',
          checkedAt: checkedAt.toISOString(),
        },
      },
    ]);
  });

  test('returns latestCheck: null for a product that has never been checked', async () => {
    findManyProduct.mockResolvedValue([
      {
        id: 'product-2',
        name: 'Never Checked Product',
        url: 'https://www.toychamp.be/never-checked',
        imageUrl: null,
        store: { id: 'store-1', name: 'ToyChamp' },
        checks: [],
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(body[0].latestCheck).toBeNull();
  });
});
