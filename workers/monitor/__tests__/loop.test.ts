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
}));

const checkProduct = vi.fn();
vi.mock('@pokemon-monitor/store-adapters', () => ({
  getAdapter: vi.fn(() => ({ checkProduct })),
}));

import { runCheckCycle } from '../src/loop';

const baseStore = {
  id: 'store-1',
  key: 'toychamp',
  adapterKey: 'toychamp',
  pollingInterval: 300,
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
});
