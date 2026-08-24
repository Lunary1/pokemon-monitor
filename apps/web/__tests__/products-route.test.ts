import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyProduct = vi.fn();
const findUniqueProduct = vi.fn();
const createProductRow = vi.fn();
const findUniqueStore = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: {
      findMany: (...args: unknown[]) => findManyProduct(...args),
      findUnique: (...args: unknown[]) => findUniqueProduct(...args),
      create: (...args: unknown[]) => createProductRow(...args),
    },
    store: { findUnique: (...args: unknown[]) => findUniqueStore(...args) },
  },
}));

import { GET, POST } from '../app/api/products/route';

const checkedAt = new Date('2026-01-01T12:00:00.000Z');

const validProductInput = {
  storeId: 'store-1',
  name: 'Scarlet & Violet Booster Box',
  url: 'https://www.dreamland.be/pokemon-sv-booster-box',
};

function makeGet(query = '') {
  return GET(new Request(`http://localhost/api/products${query}`));
}

function makePost(body: unknown) {
  return POST(
    new Request('http://localhost/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueStore.mockResolvedValue({ id: 'store-1', name: 'Dreamland' });
  findUniqueProduct.mockResolvedValue(null);
});

describe('GET /api/products', () => {
  test('returns products joined with their latest stock check', async () => {
    findManyProduct.mockResolvedValue([
      {
        id: 'product-1',
        name: 'Scarlet & Violet Booster Box',
        url: 'https://www.toychamp.be/pokemon-sv-booster-box',
        imageUrl: null,
        enabled: true,
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

    const response = await makeGet();
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
        enabled: true,
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
        enabled: true,
        store: { id: 'store-1', name: 'ToyChamp' },
        checks: [],
      },
    ]);

    const response = await makeGet();
    const body = await response.json();

    expect(body[0].latestCheck).toBeNull();
  });

  test('includeDisabled=true drops the enabled filter', async () => {
    findManyProduct.mockResolvedValue([]);

    await makeGet('?includeDisabled=true');

    expect(findManyProduct).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});

describe('POST /api/products', () => {
  test('creates a product and returns 201', async () => {
    createProductRow.mockResolvedValue({
      id: 'product-9',
      ...validProductInput,
      imageUrl: null,
      enabled: true,
      store: { id: 'store-1', name: 'Dreamland' },
      checks: [],
    });

    const response = await makePost(validProductInput);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createProductRow).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeId: 'store-1', url: validProductInput.url }),
      }),
    );
    expect(body).toMatchObject({ id: 'product-9', enabled: true });
  });

  test('normalizes an empty imageUrl to null', async () => {
    createProductRow.mockResolvedValue({
      id: 'product-9',
      ...validProductInput,
      imageUrl: null,
      enabled: true,
      store: { id: 'store-1', name: 'Dreamland' },
      checks: [],
    });

    await makePost({ ...validProductInput, imageUrl: '' });

    expect(createProductRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ imageUrl: null }) }),
    );
  });

  test('rejects a missing required field with 400', async () => {
    const response = await makePost({ name: 'Only a name' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('storeId is required');
    expect(createProductRow).not.toHaveBeenCalled();
  });

  test('rejects a non-http url with 400', async () => {
    const response = await makePost({ ...validProductInput, url: 'not-a-url' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('url must be a valid http(s) URL');
    expect(createProductRow).not.toHaveBeenCalled();
  });

  test('rejects an unknown store with 400', async () => {
    findUniqueStore.mockResolvedValue(null);

    const response = await makePost(validProductInput);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems[0]).toContain('Unknown store');
    expect(createProductRow).not.toHaveBeenCalled();
  });

  test('rejects a duplicate (storeId, url) with 409', async () => {
    findUniqueProduct.mockResolvedValue({ id: 'product-1' });

    const response = await makePost(validProductInput);

    expect(response.status).toBe(409);
    expect(createProductRow).not.toHaveBeenCalled();
  });

  test('rejects a malformed JSON body with 400', async () => {
    const response = await makePost('{not json');

    expect(response.status).toBe(400);
    expect(createProductRow).not.toHaveBeenCalled();
  });
});
