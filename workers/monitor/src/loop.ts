import {
  detectTransition,
  isErrorResult,
  isUrlAllowed,
  logger,
  throttleDomain,
} from '@pokemon-monitor/core';
import { prisma, type StockEvent } from '@pokemon-monitor/db';
import { getAdapter, resolveAdapterConfig } from '@pokemon-monitor/store-adapters';

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
      adapterConfig: true,
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

    // Per-store overrides from the AdapterConfig table (#30). Resolved every
    // cycle, not cached at startup, so dashboard edits apply within a minute
    // without a worker restart.
    const config = resolveAdapterConfig(adapter.config, store.adapterConfig?.config);

    for (const product of store.products) {
      const lastCheck = await prisma.stockCheck.findFirst({
        where: { productId: product.id },
        orderBy: { checkedAt: 'desc' },
      });

      const dueAt = lastCheck
        ? lastCheck.checkedAt.getTime() + store.pollingInterval * 1000
        : 0;
      if (Date.now() < dueAt) continue;

      // robots.txt gate (SDLC §7). Checked before throttling so a skipped
      // product doesn't consume the domain's rate budget.
      if (store.ignoreRobotsTxt) {
        logger.warn(
          { storeKey: store.key, productId: product.id },
          'robots.txt check bypassed by store configuration',
        );
      } else if (!(await isUrlAllowed(product.url))) {
        logger.warn(
          { storeKey: store.key, productId: product.id, url: product.url },
          'robots.txt disallows this URL, skipping product',
        );
        continue;
      }

      // Throttle on the product's own host, not the adapter's configured
      // baseUrl — multi-domain adapters (e.g. shopify-generic) serve many
      // stores, and a shared adapter-level key would pool unrelated domains
      // into one bucket. Identical behaviour for single-store adapters.
      await throttleDomain(new URL(product.url).hostname, config.minIntervalMs);
      const result = await adapter.checkProduct(product.url, {
        timeoutMs: config.defaultTimeoutMs,
        customHeaders: config.customHeaders,
      });

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
