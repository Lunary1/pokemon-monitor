import { prisma } from '@pokemon-monitor/db';

async function main() {
  const store = await prisma.store.upsert({
    where: { key: 'e2e-store' },
    update: {},
    create: {
      key: 'e2e-store',
      name: 'E2E Test Store',
      baseUrl: 'https://example.test',
      adapterKey: 'toychamp',
    },
  });

  const product = await prisma.product.upsert({
    where: { storeId_url: { storeId: store.id, url: 'https://example.test/e2e-product' } },
    update: {},
    create: {
      storeId: store.id,
      name: 'E2E Booster Box',
      url: 'https://example.test/e2e-product',
    },
  });

  await prisma.stockCheck.create({
    data: {
      productId: product.id,
      inStock: true,
      price: 49.99,
      currency: 'EUR',
      availability: 'In stock',
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
