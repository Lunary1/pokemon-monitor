import { prisma } from '@pokemon-monitor/db';

export interface ProductCheckItem {
  id: string;
  inStock: boolean;
  price: number | null;
  currency: string;
  availability: string | null;
  checkedAt: Date;
}

export interface ProductListItem {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  enabled: boolean;
  store: { id: string; name: string };
  latestCheck: {
    inStock: boolean;
    price: number | null;
    currency: string;
    availability: string | null;
    checkedAt: Date;
  } | null;
}

export interface ProductInput {
  storeId: string;
  name: string;
  url: string;
  imageUrl?: string | null;
  tags?: string[];
  enabled?: boolean;
  trackPrice?: boolean;
  notifyOnRestock?: boolean;
  notifyOnDrop?: boolean;
  priceDrop?: number | null;
}

export type ProductPatch = Partial<ProductInput>;

export class ProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'ProductNotFoundError';
  }
}

export class InvalidProductError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid product: ${problems.join('; ')}`);
    this.name = 'InvalidProductError';
  }
}

export class DuplicateProductUrlError extends Error {
  constructor(url: string) {
    super(`This store already tracks ${url}`);
    this.name = 'DuplicateProductUrlError';
  }
}

export interface ProductDetail extends ProductListItem {
  checks: ProductCheckItem[];
}

/** Cap on the check history embedded in the product detail response. */
export const PRODUCT_DETAIL_CHECK_LIMIT = 50;

/**
 * `includeDisabled` exists because deleting a product that has check history
 * soft-deletes it (enabled = false). Without a way to list disabled rows the
 * dashboard would have no route back — the product would simply vanish.
 */
export async function listProducts(
  { includeDisabled = false }: { includeDisabled?: boolean } = {},
): Promise<ProductListItem[]> {
  const products = await prisma.product.findMany({
    where: includeDisabled ? undefined : { enabled: true },
    orderBy: { name: 'asc' },
    include: {
      store: { select: { id: true, name: true } },
      checks: {
        orderBy: { checkedAt: 'desc' },
        take: 1,
      },
    },
  });

  return products.map((product) => {
    const latestCheck = product.checks[0] ?? null;
    return {
      id: product.id,
      name: product.name,
      url: product.url,
      imageUrl: product.imageUrl,
      enabled: product.enabled,
      store: product.store,
      latestCheck: latestCheck
        ? {
            inStock: latestCheck.inStock,
            price: latestCheck.price,
            currency: latestCheck.currency,
            availability: latestCheck.availability,
            checkedAt: latestCheck.checkedAt,
          }
        : null,
    };
  });
}

/**
 * Single product with its recent check history (newest first, capped at
 * PRODUCT_DETAIL_CHECK_LIMIT). Returns null when the id doesn't resolve, so
 * callers decide how to surface that — the route maps it to a 404.
 */
export async function getProduct(id: string): Promise<ProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      store: { select: { id: true, name: true } },
      checks: {
        orderBy: { checkedAt: 'desc' },
        take: PRODUCT_DETAIL_CHECK_LIMIT,
      },
    },
  });

  if (!product) return null;

  const checks = product.checks.map((check) => ({
    id: check.id,
    inStock: check.inStock,
    price: check.price,
    currency: check.currency,
    availability: check.availability,
    checkedAt: check.checkedAt,
  }));

  const latestCheck = checks[0] ?? null;

  return {
    id: product.id,
    name: product.name,
    url: product.url,
    imageUrl: product.imageUrl,
    enabled: product.enabled,
    store: product.store,
    latestCheck: latestCheck
      ? {
          inStock: latestCheck.inStock,
          price: latestCheck.price,
          currency: latestCheck.currency,
          availability: latestCheck.availability,
          checkedAt: latestCheck.checkedAt,
        }
      : null,
    checks,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateProductFields(
  input: ProductPatch,
  { partial }: { partial: boolean },
): string[] {
  const problems: string[] = [];

  for (const field of ['storeId', 'name', 'url'] as const) {
    const value = input[field];
    if (value === undefined) {
      if (!partial) problems.push(`${field} is required`);
      continue;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${field} must be a non-empty string`);
    }
  }

  if (typeof input.url === 'string' && input.url.trim() !== '' && !isHttpUrl(input.url)) {
    problems.push('url must be a valid http(s) URL');
  }

  if (input.imageUrl !== undefined && input.imageUrl !== null && input.imageUrl !== '') {
    if (typeof input.imageUrl !== 'string' || !isHttpUrl(input.imageUrl)) {
      problems.push('imageUrl must be a valid http(s) URL');
    }
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string')) {
      problems.push('tags must be an array of strings');
    }
  }

  for (const field of ['enabled', 'trackPrice', 'notifyOnRestock', 'notifyOnDrop'] as const) {
    const value = input[field];
    if (value !== undefined && typeof value !== 'boolean') {
      problems.push(`${field} must be a boolean`);
    }
  }

  if (input.priceDrop !== undefined && input.priceDrop !== null) {
    if (typeof input.priceDrop !== 'number' || Number.isNaN(input.priceDrop) || input.priceDrop < 0) {
      problems.push('priceDrop must be a non-negative number');
    }
  }

  return problems;
}

/** Empty string from an optional form field means "unset", not "empty URL". */
function normalizeImageUrl(imageUrl: string | null | undefined): string | null | undefined {
  if (imageUrl === undefined) return undefined;
  return imageUrl === '' ? null : imageUrl;
}

export async function createProduct(input: ProductInput): Promise<ProductListItem> {
  const problems = validateProductFields(input, { partial: false });
  if (problems.length > 0) throw new InvalidProductError(problems);

  const store = await prisma.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new InvalidProductError([`Unknown store: ${input.storeId}`]);

  const clash = await prisma.product.findUnique({
    where: { storeId_url: { storeId: input.storeId, url: input.url } },
  });
  if (clash) throw new DuplicateProductUrlError(input.url);

  const product = await prisma.product.create({
    data: {
      storeId: input.storeId,
      name: input.name,
      url: input.url,
      imageUrl: normalizeImageUrl(input.imageUrl) ?? null,
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.trackPrice !== undefined && { trackPrice: input.trackPrice }),
      ...(input.notifyOnRestock !== undefined && { notifyOnRestock: input.notifyOnRestock }),
      ...(input.notifyOnDrop !== undefined && { notifyOnDrop: input.notifyOnDrop }),
      ...(input.priceDrop !== undefined && { priceDrop: input.priceDrop }),
    },
    include: {
      store: { select: { id: true, name: true } },
      checks: { orderBy: { checkedAt: 'desc' }, take: 1 },
    },
  });

  return {
    id: product.id,
    name: product.name,
    url: product.url,
    imageUrl: product.imageUrl,
    enabled: product.enabled,
    store: product.store,
    latestCheck: null,
  };
}

export async function updateProduct(
  productId: string,
  patch: ProductPatch,
): Promise<ProductListItem> {
  const problems = validateProductFields(patch, { partial: true });
  if (problems.length > 0) throw new InvalidProductError(problems);

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  // (storeId, url) is unique; moving a product onto a pair another row already
  // holds would hit the constraint, so check first and report it as a 409.
  const nextStoreId = patch.storeId ?? product.storeId;
  const nextUrl = patch.url ?? product.url;
  if (nextStoreId !== product.storeId || nextUrl !== product.url) {
    const clash = await prisma.product.findUnique({
      where: { storeId_url: { storeId: nextStoreId, url: nextUrl } },
    });
    if (clash && clash.id !== productId) throw new DuplicateProductUrlError(nextUrl);
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { ...patch, ...(patch.imageUrl !== undefined && { imageUrl: normalizeImageUrl(patch.imageUrl) }) },
    include: {
      store: { select: { id: true, name: true } },
      checks: { orderBy: { checkedAt: 'desc' }, take: 1 },
    },
  });

  const latestCheck = updated.checks[0] ?? null;
  return {
    id: updated.id,
    name: updated.name,
    url: updated.url,
    imageUrl: updated.imageUrl,
    enabled: updated.enabled,
    store: updated.store,
    latestCheck: latestCheck
      ? {
          inStock: latestCheck.inStock,
          price: latestCheck.price,
          currency: latestCheck.currency,
          availability: latestCheck.availability,
          checkedAt: latestCheck.checkedAt,
        }
      : null,
  };
}

export type DeleteProductResult = { deleted: 'hard' } | { deleted: 'soft'; relatedRows: number };

/**
 * StockCheck, StockEvent and Notification have no `onDelete: Cascade` back to
 * Product, so a product with history can't be hard-deleted without orphaning
 * its FKs. Those are disabled instead (enabled = false), which the worker
 * already treats as "stop polling"; only history-free products are removed
 * outright.
 */
export async function deleteProduct(productId: string): Promise<DeleteProductResult> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  const [checks, events, notifications] = await Promise.all([
    prisma.stockCheck.count({ where: { productId } }),
    prisma.stockEvent.count({ where: { productId } }),
    prisma.notification.count({ where: { productId } }),
  ]);

  const relatedRows = checks + events + notifications;
  if (relatedRows > 0) {
    await prisma.product.update({ where: { id: productId }, data: { enabled: false } });
    return { deleted: 'soft', relatedRows };
  }

  await prisma.product.delete({ where: { id: productId } });
  return { deleted: 'hard' };
}
