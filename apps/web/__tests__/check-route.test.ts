import { beforeEach, describe, expect, test, vi } from 'vitest';

const findUniqueProduct = vi.fn();
const findFirstStockCheck = vi.fn();
const createStockCheck = vi.fn();
const createStockEvent = vi.fn();
const getAdapter = vi.fn();
const checkProduct = vi.fn();
const throttleDomain = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    product: { findUnique: (...args: unknown[]) => findUniqueProduct(...args) },
    stockCheck: {
      findFirst: (...args: unknown[]) => findFirstStockCheck(...args),
      create: (...args: unknown[]) => createStockCheck(...args),
    },
    stockEvent: { create: (...args: unknown[]) => createStockEvent(...args) },
  },
}));

// Keep the real resolveAdapterConfig so the override plumbing is exercised;
// only the registry lookup is mocked.
vi.mock('@pokemon-monitor/store-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pokemon-monitor/store-adapters')>();
  return {
    ...actual,
    getAdapter: (...args: unknown[]) => getAdapter(...args),
  };
});

const isUrlAllowed = vi.fn();
const recordErrorLog = vi.fn();

vi.mock('@pokemon-monitor/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
  throttleDomain: (...args: unknown[]) => throttleDomain(...args),
  isUrlAllowed: (...args: unknown[]) => isUrlAllowed(...args),
  recordErrorLog: (...args: unknown[]) => recordErrorLog(...args),
  isErrorResult: (availability: string | null | undefined) =>
    typeof availability === 'string' && availability.startsWith('ERROR:'),
  detectTransition: (previous: boolean | null, current: boolean) => {
    if (previous === null || previous === current) return null;
    return current ? 'RESTOCK' : 'OUT_OF_STOCK';
  },
}));

import { POST } from '../app/api/products/[id]/check/route';

const product = {
  id: 'product-1',
  url: 'https://www.toychamp.be/pokemon-sv-booster-box',
  store: {
    id: 'store-1',
    key: 'toychamp',
    adapterKey: 'toychamp',
    ignoreRobotsTxt: false,
    adapterConfig: null,
  },
};

const adapter = {
  config: { baseUrl: 'https://www.toychamp.be', minIntervalMs: 10000 },
  checkProduct: (...args: unknown[]) => checkProduct(...args),
};

function makeRequest(id: string) {
  return POST(new Request(`http://localhost/api/products/${id}/check`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueProduct.mockResolvedValue(product);
  getAdapter.mockReturnValue(adapter);
  throttleDomain.mockResolvedValue(undefined);
  isUrlAllowed.mockResolvedValue(true);
});

describe('POST /api/products/:id/check', () => {
  test('runs the adapter check and persists a StockCheck', async () => {
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    createStockCheck.mockResolvedValue({
      id: 'check-1',
      productId: 'product-1',
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

    const response = await makeRequest('product-1');
    const body = await response.json();

    expect(checkProduct).toHaveBeenCalledWith(product.url, {
      timeoutMs: undefined,
      customHeaders: undefined,
    });
    expect(response.status).toBe(200);
    expect(body.id).toBe('check-1');
    expect(createStockEvent).not.toHaveBeenCalled();
  });

  test('creates a RESTOCK event on an out-of-stock -> in-stock transition', async () => {
    findFirstStockCheck.mockResolvedValue({
      id: 'check-0',
      inStock: false,
      price: 54.99,
      availability: 'Uitverkocht',
    });
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    createStockCheck.mockResolvedValue({
      id: 'check-1',
      inStock: true,
      price: 54.99,
    });

    await makeRequest('product-1');

    expect(createStockEvent).toHaveBeenCalledWith({
      data: {
        productId: 'product-1',
        eventType: 'RESTOCK',
        previousPrice: 54.99,
        currentPrice: 54.99,
      },
    });
  });

  test('skips transition detection when the adapter returns an error result', async () => {
    findFirstStockCheck.mockResolvedValue({ id: 'check-0', inStock: false, price: null });
    checkProduct.mockResolvedValue({
      inStock: false,
      price: null,
      currency: 'EUR',
      availability: 'ERROR: timeout',
      checkedAt: new Date('2026-01-01T12:00:00.000Z'),
    });
    createStockCheck.mockResolvedValue({ id: 'check-1', inStock: false, price: null });

    const response = await makeRequest('product-1');

    expect(response.status).toBe(200);
    expect(createStockEvent).not.toHaveBeenCalled();
    expect(recordErrorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'adapter:toychamp',
        message: 'ERROR: timeout',
        context: { productId: 'product-1', storeKey: 'toychamp', url: product.url },
      }),
    );
  });

  test('applies per-store AdapterConfig overrides to the manual check (#30)', async () => {
    findUniqueProduct.mockResolvedValue({
      ...product,
      store: {
        ...product.store,
        adapterConfig: {
          config: {
            minIntervalMs: 20_000,
            defaultTimeoutMs: 5_000,
            customHeaders: { 'X-Api-Key': 'store-secret' },
          },
        },
      },
    });
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 10,
      currency: 'EUR',
      availability: 'In stock',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ id: 'check-1', inStock: true, price: 10 });

    await makeRequest('product-1');

    expect(throttleDomain).toHaveBeenCalledWith('www.toychamp.be', 20_000);
    expect(checkProduct).toHaveBeenCalledWith(product.url, {
      timeoutMs: 5_000,
      customHeaders: { 'X-Api-Key': 'store-secret' },
    });
  });

  test('returns 404 when the product does not exist', async () => {
    findUniqueProduct.mockResolvedValue(null);

    const response = await makeRequest('missing-product');

    expect(response.status).toBe(404);
    expect(checkProduct).not.toHaveBeenCalled();
  });

  test('returns 422 when no adapter is registered for the store', async () => {
    getAdapter.mockReturnValue(undefined);

    const response = await makeRequest('product-1');

    expect(response.status).toBe(422);
    expect(checkProduct).not.toHaveBeenCalled();
  });
});

describe('POST /api/products/:id/check — robots.txt gate (#29)', () => {
  test('returns 403 and does not fetch when robots.txt disallows the URL', async () => {
    // A manual "Check now" must not be an escape hatch around compliance.
    isUrlAllowed.mockResolvedValue(false);

    const response = await makeRequest('product-1');
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('robots.txt');
    expect(checkProduct).not.toHaveBeenCalled();
    expect(createStockCheck).not.toHaveBeenCalled();
  });

  test('does not consume the domain rate budget when refused', async () => {
    isUrlAllowed.mockResolvedValue(false);

    await makeRequest('product-1');

    expect(throttleDomain).not.toHaveBeenCalled();
  });

  test('ignoreRobotsTxt bypasses the gate', async () => {
    findUniqueProduct.mockResolvedValue({
      ...product,
      store: { ...product.store, ignoreRobotsTxt: true },
    });
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 10,
      currency: 'EUR',
      availability: 'In stock',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ id: 'check-1', inStock: true });

    const response = await makeRequest('product-1');

    expect(response.status).toBe(200);
    expect(isUrlAllowed).not.toHaveBeenCalled();
    expect(checkProduct).toHaveBeenCalled();
  });
});
