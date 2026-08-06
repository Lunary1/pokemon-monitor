import { beforeEach, describe, expect, test, vi } from 'vitest';

const findUniqueProduct = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => findUniqueProduct(...args) },
  },
}));

import { GET } from '../app/api/products/[id]/route';

const checkedAt = new Date('2026-01-01T12:00:00.000Z');
const earlierCheckedAt = new Date('2026-01-01T11:00:00.000Z');

function makeRequest(id: string) {
  return GET(new Request(`http://localhost/api/products/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/products/:id', () => {
  test('returns the product with its check history, newest first', async () => {
    findUniqueProduct.mockResolvedValue({
      id: 'product-1',
      name: 'Scarlet & Violet Booster Box',
      url: 'https://www.toychamp.be/pokemon-sv-booster-box',
      imageUrl: null,
      store: { id: 'store-1', name: 'ToyChamp' },
      checks: [
        {
          id: 'check-2',
          inStock: true,
          price: 54.99,
          currency: 'EUR',
          availability: 'Op voorraad',
          checkedAt,
        },
        {
          id: 'check-1',
          inStock: false,
          price: 59.99,
          currency: 'EUR',
          availability: 'Uitverkocht',
          checkedAt: earlierCheckedAt,
        },
      ],
    });

    const response = await makeRequest('product-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findUniqueProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1' },
        include: expect.objectContaining({
          checks: expect.objectContaining({
            orderBy: { checkedAt: 'desc' },
            take: 50,
          }),
        }),
      }),
    );
    expect(body.id).toBe('product-1');
    expect(body.store).toEqual({ id: 'store-1', name: 'ToyChamp' });
    expect(body.checks).toHaveLength(2);
    expect(body.checks[0].id).toBe('check-2');
    expect(body.checks[1].id).toBe('check-1');
  });

  test('derives latestCheck from the most recent check', async () => {
    findUniqueProduct.mockResolvedValue({
      id: 'product-1',
      name: 'Scarlet & Violet Booster Box',
      url: 'https://www.toychamp.be/pokemon-sv-booster-box',
      imageUrl: null,
      store: { id: 'store-1', name: 'ToyChamp' },
      checks: [
        {
          id: 'check-2',
          inStock: true,
          price: 54.99,
          currency: 'EUR',
          availability: 'Op voorraad',
          checkedAt,
        },
        {
          id: 'check-1',
          inStock: false,
          price: 59.99,
          currency: 'EUR',
          availability: 'Uitverkocht',
          checkedAt: earlierCheckedAt,
        },
      ],
    });

    const response = await makeRequest('product-1');
    const body = await response.json();

    expect(body.latestCheck).toEqual({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: checkedAt.toISOString(),
    });
  });

  test('returns latestCheck: null and an empty history for a never-checked product', async () => {
    findUniqueProduct.mockResolvedValue({
      id: 'product-2',
      name: 'Never Checked Product',
      url: 'https://www.toychamp.be/never-checked',
      imageUrl: null,
      store: { id: 'store-1', name: 'ToyChamp' },
      checks: [],
    });

    const response = await makeRequest('product-2');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.latestCheck).toBeNull();
    expect(body.checks).toEqual([]);
  });

  test('returns 404 when the product does not exist', async () => {
    findUniqueProduct.mockResolvedValue(null);

    const response = await makeRequest('missing-product');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('missing-product');
  });
});
