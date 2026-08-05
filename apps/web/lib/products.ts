import { prisma } from '@pokemon-monitor/db';

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
