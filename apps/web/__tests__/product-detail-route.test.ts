import { beforeEach, describe, expect, test, vi } from 'vitest';

const findUniqueProduct = vi.fn();
const updateProductRow = vi.fn();
const deleteProductRow = vi.fn();
const countStockChecks = vi.fn();
const countStockEvents = vi.fn();
const countNotifications = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => findUniqueProduct(...args),
      update: (...args: unknown[]) => updateProductRow(...args),
      delete: (...args: unknown[]) => deleteProductRow(...args),
    },
    store: { findUnique: vi.fn() },
    stockCheck: { count: (...args: unknown[]) => countStockChecks(...args) },
    stockEvent: { count: (...args: unknown[]) => countStockEvents(...args) },
    notification: { count: (...args: unknown[]) => countNotifications(...args) },
  },
}));

import { DELETE, GET, PATCH } from '../app/api/products/[id]/route';

const checkedAt = new Date('2026-01-01T12:00:00.000Z');
const earlierCheckedAt = new Date('2026-01-01T11:00:00.000Z');

const existingProduct = {
  id: 'product-1',
  storeId: 'store-1',
  name: 'Scarlet & Violet Booster Box',
  url: 'https://www.dreamland.be/pokemon-sv-booster-box',
  imageUrl: null,
  enabled: true,
};

function makeRequest(id: string) {
  return GET(new Request(`http://localhost/api/products/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function makePatch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function makeDelete(id: string) {
  return DELETE(new Request(`http://localhost/api/products/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  countStockChecks.mockResolvedValue(0);
  countStockEvents.mockResolvedValue(0);
  countNotifications.mockResolvedValue(0);
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

describe('PATCH /api/products/:id', () => {
  beforeEach(() => {
    findUniqueProduct.mockResolvedValue(existingProduct);
    updateProductRow.mockResolvedValue({
      ...existingProduct,
      name: 'Renamed',
      store: { id: 'store-1', name: 'Dreamland' },
      checks: [],
    });
  });

  test('updates the supplied fields', async () => {
    const response = await makePatch('product-1', { name: 'Renamed', notifyOnDrop: true });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateProductRow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1' },
        data: expect.objectContaining({ name: 'Renamed', notifyOnDrop: true }),
      }),
    );
    expect(body.name).toBe('Renamed');
  });

  test('re-enabling a soft-deleted product works', async () => {
    const response = await makePatch('product-1', { enabled: true });

    expect(response.status).toBe(200);
    expect(updateProductRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: true }) }),
    );
  });

  test('rejects a body with no recognized field with 400', async () => {
    const response = await makePatch('product-1', { nonsense: true });

    expect(response.status).toBe(400);
    expect(updateProductRow).not.toHaveBeenCalled();
  });

  test('rejects an invalid url with 400', async () => {
    const response = await makePatch('product-1', { url: 'nope' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('url must be a valid http(s) URL');
    expect(updateProductRow).not.toHaveBeenCalled();
  });

  test('rejects moving onto an existing (storeId, url) pair with 409', async () => {
    findUniqueProduct
      .mockResolvedValueOnce(existingProduct)
      .mockResolvedValueOnce({ id: 'product-2' });

    const response = await makePatch('product-1', { url: 'https://www.dreamland.be/taken' });

    expect(response.status).toBe(409);
    expect(updateProductRow).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown product', async () => {
    findUniqueProduct.mockResolvedValue(null);

    const response = await makePatch('missing', { name: 'x' });

    expect(response.status).toBe(404);
    expect(updateProductRow).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/products/:id', () => {
  beforeEach(() => {
    findUniqueProduct.mockResolvedValue(existingProduct);
  });

  test('hard-deletes a product with no history', async () => {
    const response = await makeDelete('product-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: 'hard' });
    expect(deleteProductRow).toHaveBeenCalledWith({ where: { id: 'product-1' } });
    expect(updateProductRow).not.toHaveBeenCalled();
  });

  test('soft-deletes a product that has check history', async () => {
    countStockChecks.mockResolvedValue(12);

    const response = await makeDelete('product-1');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: 'soft', relatedRows: 12 });
    expect(updateProductRow).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { enabled: false },
    });
    expect(deleteProductRow).not.toHaveBeenCalled();
  });

  test('soft-deletes on notification history alone', async () => {
    countNotifications.mockResolvedValue(1);

    const response = await makeDelete('product-1');
    const body = await response.json();

    expect(body).toEqual({ deleted: 'soft', relatedRows: 1 });
    expect(deleteProductRow).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown product', async () => {
    findUniqueProduct.mockResolvedValue(null);

    const response = await makeDelete('missing');

    expect(response.status).toBe(404);
    expect(deleteProductRow).not.toHaveBeenCalled();
    expect(updateProductRow).not.toHaveBeenCalled();
  });
});
