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
  store: { id: string; name: string };
  latestCheck: {
    inStock: boolean;
    price: number | null;
    currency: string;
    availability: string | null;
    checkedAt: Date;
  } | null;
}

export interface ProductDetail extends ProductListItem {
  checks: ProductCheckItem[];
}

/** Cap on the check history embedded in the product detail response. */
export const PRODUCT_DETAIL_CHECK_LIMIT = 50;

export async function listProducts(): Promise<ProductListItem[]> {
  const products = await prisma.product.findMany({
    where: { enabled: true },
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
