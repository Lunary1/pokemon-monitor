import { logger } from '@pokemon-monitor/core';
import { prisma, type StockEvent } from '@pokemon-monitor/db';
import { getAdapter } from '@pokemon-monitor/store-adapters';
import { detectTransition, isErrorResult } from './transitions';

export interface RunCheckCycleOptions {
  /**
   * Called after a StockEvent is persisted. Notification dispatch (#6) hooks
   * in here without this loop needing to know about NotificationService.
   */
  onStockEvent?: (event: StockEvent) => void | Promise<void>;
}

export async function runCheckCycle(
  options: RunCheckCycleOptions = {},
): Promise<void> {
  const stores = await prisma.store.findMany({
    where: { enabled: true },
    include: {
      products: { where: { enabled: true } },
    },
  });

  for (const store of stores) {
    const adapter = getAdapter(store.adapterKey);
    if (!adapter) {
      logger.warn(
        { storeKey: store.key, adapterKey: store.adapterKey },
        'no adapter registered for store, skipping',
      );
      continue;
    }

    for (const product of store.products) {
      const lastCheck = await prisma.stockCheck.findFirst({
        where: { productId: product.id },
        orderBy: { checkedAt: 'desc' },
      });

      const dueAt = lastCheck
        ? lastCheck.checkedAt.getTime() + store.pollingInterval * 1000
        : 0;
      if (Date.now() < dueAt) continue;

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
          'adapter returned error result, skipping transition check',
        );
        continue;
      }

      const eventType = detectTransition(
        lastCheck && !isErrorResult(lastCheck.availability)
          ? lastCheck.inStock
          : null,
        stockCheck.inStock,
      );

      if (!eventType) continue;

      const event = await prisma.stockEvent.create({
        data: {
          productId: product.id,
          eventType,
          previousPrice: lastCheck?.price ?? null,
          currentPrice: stockCheck.price,
        },
      });

      logger.info(
        { productId: product.id, eventType, storeKey: store.key },
        'stock transition detected',
      );

      await options.onStockEvent?.(event);
    }
  }
}
