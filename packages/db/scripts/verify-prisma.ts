import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.join(__dirname, '../../../.env') });

import { prisma } from '../src/index';

async function main() {
  const storeCount = await prisma.store.count();
  console.log(`OK: connected to database, found ${storeCount} store(s).`);
}

main()
  .catch((error) => {
    console.error('FAILED: could not read from the database.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
