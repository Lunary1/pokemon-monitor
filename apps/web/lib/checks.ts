import {
  detectTransition,
  isErrorResult,
  isUrlAllowed,
  logger,
  throttleDomain,
} from '@pokemon-monitor/core';
import { prisma, type StockCheck } from '@pokemon-monitor/db';
import { getAdapter, resolveAdapterConfig } from '@pokemon-monitor/store-adapters';

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

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows fetching: ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export async function runManualCheck(productId: string): Promise<StockCheck> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { store: { include: { adapterConfig: true } } },
  });
  if (!product) throw new ProductNotFoundError(productId);

  const adapter = getAdapter(product.store.adapterKey);
  if (!adapter) throw new AdapterNotFoundError(product.store.adapterKey);

  // robots.txt gate (SDLC §7). A manual "Check now" must not bypass
  // compliance — checked before throttling so a refused product doesn't
  // consume the domain's rate budget.
  if (product.store.ignoreRobotsTxt) {
    logger.warn(
      { storeKey: product.store.key, productId: product.id },
      'robots.txt check bypassed by store configuration',
    );
  } else if (!(await isUrlAllowed(product.url))) {
    logger.warn(
      { storeKey: product.store.key, productId: product.id, url: product.url },
      'robots.txt disallows this URL, refusing manual check',
    );
    throw new RobotsDisallowedError(product.url);
  }

  const lastCheck = await prisma.stockCheck.findFirst({
    where: { productId: product.id },
    orderBy: { checkedAt: 'desc' },
  });

  // Per-store overrides from the AdapterConfig table (#30) — same resolution
  // the worker loop applies, so a manual check behaves like a scheduled one.
  const config = resolveAdapterConfig(adapter.config, product.store.adapterConfig?.config);

  // Throttle on the product's own host, not the adapter's configured baseUrl —
  // multi-domain adapters (e.g. shopify-generic) serve many stores, and a
  // shared adapter-level key would pool unrelated domains into one bucket.
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
