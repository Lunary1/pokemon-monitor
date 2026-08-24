import { prisma } from '../src/index';

async function main() {
  const store = await prisma.store.upsert({
    where: { key: 'demo-store' },
    update: {},
    create: {
      key: 'demo-store',
      name: 'Demo Store',
      baseUrl: 'https://example.com',
      adapterKey: 'demo',
    },
  });

  await prisma.product.upsert({
    where: { storeId_url: { storeId: store.id, url: 'https://example.com/products/demo-product' } },
    update: {},
    create: {
      storeId: store.id,
      name: 'Demo Product',
      url: 'https://example.com/products/demo-product',
    },
  });

  const existingSetting = await prisma.setting.findFirst();
  if (!existingSetting) {
    await prisma.setting.create({ data: {} });
  }

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
