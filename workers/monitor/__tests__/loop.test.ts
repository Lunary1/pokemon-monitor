import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyStore = vi.fn();
const findFirstStockCheck = vi.fn();
const createStockCheck = vi.fn();
const createStockEvent = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    store: { findMany: (...args: unknown[]) => findManyStore(...args) },
    stockCheck: {
      findFirst: (...args: unknown[]) => findFirstStockCheck(...args),
      create: (...args: unknown[]) => createStockCheck(...args),
    },
    stockEvent: {
      create: (...args: unknown[]) => createStockEvent(...args),
    },
  },
}));

vi.mock('@pokemon-monitor/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  throttleDomain: vi.fn().mockResolvedValue(undefined),
  isUrlAllowed: vi.fn().mockResolvedValue(true),
  isErrorResult: (availability: string | null | undefined) =>
    typeof availability === 'string' && availability.startsWith('ERROR:'),
  detectTransition: (previous: boolean | null, current: boolean) => {
    if (previous === null || previous === current) return null;
    return current ? 'RESTOCK' : 'OUT_OF_STOCK';
  },
}));

const checkProduct = vi.fn();
// Keep the real resolveAdapterConfig so these tests exercise the actual
// override-merging the loop relies on; only the registry lookup is mocked.
vi.mock('@pokemon-monitor/store-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pokemon-monitor/store-adapters')>();
  return {
    ...actual,
    getAdapter: vi.fn(() => ({
      checkProduct,
      config: { baseUrl: 'https://www.toychamp.be', minIntervalMs: 5_000 },
    })),
  };
});

import { isUrlAllowed, throttleDomain } from '@pokemon-monitor/core';
import { runCheckCycle } from '../src/loop';

const baseStore = {
  id: 'store-1',
  key: 'toychamp',
  adapterKey: 'toychamp',
  pollingInterval: 300,
  ignoreRobotsTxt: false,
};

const baseProduct = {
  id: 'product-1',
  url: 'https://www.toychamp.be/pokemon-booster',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runCheckCycle', () => {
  test('persists a StockCheck and emits no event on the first-ever check', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 54.99 });

    await runCheckCycle();

    expect(createStockCheck).toHaveBeenCalledTimes(1);
    expect(createStockEvent).not.toHaveBeenCalled();
    expect(throttleDomain).toHaveBeenCalledWith('www.toychamp.be', 5_000);
  });

  test('writes a RESTOCK event on false -> true transition', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue({
      inStock: false,
      price: 49.99,
      availability: 'Uitverkocht',
      checkedAt: new Date(Date.now() - 1_000_000),
    });
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 54.99 });

    const onStockEvent = vi.fn();
    await runCheckCycle({ onStockEvent });

    expect(createStockEvent).toHaveBeenCalledTimes(1);
    expect(createStockEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'product-1',
          eventType: 'RESTOCK',
          previousPrice: 49.99,
          currentPrice: 54.99,
        }),
      }),
    );
    expect(onStockEvent).toHaveBeenCalledTimes(1);
  });

  test('writes an OUT_OF_STOCK event on true -> false transition', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue({
      inStock: true,
      price: 54.99,
      availability: 'Op voorraad',
      checkedAt: new Date(Date.now() - 1_000_000),
    });
    checkProduct.mockResolvedValue({
      inStock: false,
      price: 54.99,
      currency: 'EUR',
      availability: 'Uitverkocht',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: false, price: 54.99 });

    await runCheckCycle();

    expect(createStockEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'OUT_OF_STOCK' }),
      }),
    );
  });

  test('does not emit a false OUT_OF_STOCK when the adapter returns an error result', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue({
      inStock: true,
      price: 54.99,
      availability: 'Op voorraad',
      checkedAt: new Date(Date.now() - 1_000_000),
    });
    checkProduct.mockResolvedValue({
      inStock: false,
      price: null,
      currency: 'EUR',
      availability: 'ERROR: Connection timeout',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: false, price: null });

    await runCheckCycle();

    expect(createStockCheck).toHaveBeenCalledTimes(1);
    expect(createStockEvent).not.toHaveBeenCalled();
  });

  test('does not treat a prior error-result check as a real prior state', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue({
      inStock: false,
      price: null,
      availability: 'ERROR: Connection timeout',
      checkedAt: new Date(Date.now() - 1_000_000),
    });
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 54.99,
      currency: 'EUR',
      availability: 'Op voorraad',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 54.99 });

    await runCheckCycle();

    // previous "state" was an error, not a real false -> no RESTOCK should fire
    expect(createStockEvent).not.toHaveBeenCalled();
  });

  test('skips a product that is not yet due for polling', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue({
      inStock: true,
      price: 54.99,
      availability: 'Op voorraad',
      checkedAt: new Date(),
    });

    await runCheckCycle();

    expect(checkProduct).not.toHaveBeenCalled();
    expect(createStockCheck).not.toHaveBeenCalled();
  });

  test('skips a store with no matching adapter without throwing', async () => {
    findManyStore.mockResolvedValue([
      { ...baseStore, adapterKey: 'unknown-store', products: [baseProduct] },
    ]);
    const { getAdapter } = await import('@pokemon-monitor/store-adapters');
    vi.mocked(getAdapter).mockReturnValueOnce(undefined);

    await expect(runCheckCycle()).resolves.not.toThrow();
    expect(checkProduct).not.toHaveBeenCalled();
  });

  test('throttles on the product host, not the adapter baseUrl', async () => {
    // Multi-domain adapters (shopify-generic) carry a placeholder baseUrl, so
    // pooling every store onto that one key would defeat the per-domain
    // throttle. Each product must throttle against its own host.
    findManyStore.mockResolvedValue([
      {
        ...baseStore,
        products: [
          { id: 'product-1', url: 'https://shop-one.example/products/booster' },
          { id: 'product-2', url: 'https://shop-two.example/products/booster' },
        ],
      },
    ]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 10,
      currency: 'EUR',
      availability: 'In stock',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await runCheckCycle();

    expect(throttleDomain).toHaveBeenCalledWith('shop-one.example', 5_000);
    expect(throttleDomain).toHaveBeenCalledWith('shop-two.example', 5_000);
    expect(throttleDomain).not.toHaveBeenCalledWith('www.toychamp.be', 5_000);
  });
});

describe('runCheckCycle — per-store AdapterConfig overrides (#30)', () => {
  const inStockResult = {
    inStock: true,
    price: 10,
    currency: 'EUR',
    availability: 'In stock',
    checkedAt: new Date(),
  };

  test('applies throttle, timeout, and header overrides from the store row', async () => {
    findManyStore.mockResolvedValue([
      {
        ...baseStore,
        adapterConfig: {
          config: {
            minIntervalMs: 30_000,
            defaultTimeoutMs: 5_000,
            customHeaders: { 'X-Api-Key': 'store-secret' },
          },
        },
        products: [baseProduct],
      },
    ]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue(inStockResult);
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await runCheckCycle();

    expect(throttleDomain).toHaveBeenCalledWith('www.toychamp.be', 30_000);
    expect(checkProduct).toHaveBeenCalledWith(baseProduct.url, {
      timeoutMs: 5_000,
      customHeaders: { 'X-Api-Key': 'store-secret' },
    });
  });

  test('a store without an AdapterConfig row keeps the adapter defaults', async () => {
    findManyStore.mockResolvedValue([
      { ...baseStore, adapterConfig: null, products: [baseProduct] },
    ]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue(inStockResult);
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await runCheckCycle();

    expect(throttleDomain).toHaveBeenCalledWith('www.toychamp.be', 5_000);
  });

  test('a malformed config blob degrades to adapter defaults, not a crash', async () => {
    findManyStore.mockResolvedValue([
      {
        ...baseStore,
        adapterConfig: { config: 'not an object at all' },
        products: [baseProduct],
      },
    ]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue(inStockResult);
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await expect(runCheckCycle()).resolves.not.toThrow();
    expect(throttleDomain).toHaveBeenCalledWith('www.toychamp.be', 5_000);
  });
});

describe('runCheckCycle — robots.txt gate (#29)', () => {
  test('skips a product whose URL robots.txt disallows', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue(null);
    vi.mocked(isUrlAllowed).mockResolvedValueOnce(false);

    await runCheckCycle();

    expect(checkProduct).not.toHaveBeenCalled();
    expect(createStockCheck).not.toHaveBeenCalled();
  });

  test('does not consume the domain rate budget for a skipped product', async () => {
    // The gate runs before throttling on purpose — a product we refuse to
    // fetch shouldn't make the next allowed product wait.
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue(null);
    vi.mocked(isUrlAllowed).mockResolvedValueOnce(false);

    await runCheckCycle();

    expect(throttleDomain).not.toHaveBeenCalled();
  });

  test('checks the product URL, not the store baseUrl', async () => {
    findManyStore.mockResolvedValue([{ ...baseStore, products: [baseProduct] }]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 10,
      currency: 'EUR',
      availability: 'In stock',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await runCheckCycle();

    expect(isUrlAllowed).toHaveBeenCalledWith(baseProduct.url);
  });

  test('ignoreRobotsTxt bypasses the gate entirely', async () => {
    findManyStore.mockResolvedValue([
      { ...baseStore, ignoreRobotsTxt: true, products: [baseProduct] },
    ]);
    findFirstStockCheck.mockResolvedValue(null);
    checkProduct.mockResolvedValue({
      inStock: true,
      price: 10,
      currency: 'EUR',
      availability: 'In stock',
      checkedAt: new Date(),
    });
    createStockCheck.mockResolvedValue({ inStock: true, price: 10 });

    await runCheckCycle();

    expect(isUrlAllowed).not.toHaveBeenCalled();
    expect(checkProduct).toHaveBeenCalled();
  });
});
