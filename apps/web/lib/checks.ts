import { detectTransition, isErrorResult, logger, throttleDomain } from '@pokemon-monitor/core';
import { prisma, type StockCheck } from '@pokemon-monitor/db';
import { getAdapter } from '@pokemon-monitor/store-adapters';

export class ProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundError';
  }
}

export class AdapterNotFoundError extends Error {
  constructor(adapterKey: string) {
    super(`No adapter registered for key: ${adapterKey}`);
    this.name = 'AdapterNotFoundError';
  }
}

export async function runManualCheck(productId: string): Promise<StockCheck> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: true },
  });
  if (!product) throw new ProductNotFoundError(productId);

  const adapter = getAdapter(product.store.adapterKey);
  if (!adapter) throw new AdapterNotFoundError(product.store.adapterKey);

  const lastCheck = await prisma.stockCheck.findFirst({
    where: { productId: product.id },
    orderBy: { checkedAt: 'desc' },
  });

  await throttleDomain(new URL(adapter.config.baseUrl).hostname, adapter.config.minIntervalMs);
  const result = await adapter.checkProduct(product.url);

  const stockCheck = await prisma.stockCheck.create({
    data: {
      productId: product.id,
      inStock: result.inStock,
      price: result.price,
      currency: result.currency,
      availability: result.availability ?? null,
      checkedAt: result.checkedAt,
    },
  });

  if (isErrorResult(result.availability)) {
    logger.warn(
      { productId: product.id, availability: result.availability },
      'manual check: adapter returned error result, skipping transition check',
    );
    return stockCheck;
  }

  const eventType = detectTransition(
    lastCheck && !isErrorResult(lastCheck.availability) ? lastCheck.inStock : null,
    stockCheck.inStock,
  );
  if (!eventType) return stockCheck;

  await prisma.stockEvent.create({
    data: {
      productId: product.id,
      eventType,
      previousPrice: lastCheck?.price ?? null,
      currentPrice: stockCheck.price,
    },
  });

  logger.info(
    { productId: product.id, eventType, storeKey: product.store.key },
    'manual check: stock transition detected',
  );

  return stockCheck;
}
