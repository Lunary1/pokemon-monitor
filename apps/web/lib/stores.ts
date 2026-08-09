import { prisma, type Prisma } from '@pokemon-monitor/db';
import { validateAdapterOverrides } from '@pokemon-monitor/store-adapters';

export interface StoreView {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
  /** Raw AdapterConfig.config JSON, or null when the store has no override row. */
  adapterConfig: unknown;
}

export class StoreNotFoundError extends Error {
  constructor(storeId: string) {
    super(`Store not found: ${storeId}`);
    this.name = 'StoreNotFoundError';
  }
}

export class InvalidAdapterConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid adapter config: ${problems.join('; ')}`);
    this.name = 'InvalidAdapterConfigError';
  }
}

function toView(store: {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
  adapterConfig: { config: unknown } | null;
}): StoreView {
  return {
    id: store.id,
    key: store.key,
    name: store.name,
    baseUrl: store.baseUrl,
    adapterKey: store.adapterKey,
    enabled: store.enabled,
    adapterConfig: store.adapterConfig?.config ?? null,
  };
}

export async function listStores(): Promise<StoreView[]> {
  const stores = await prisma.store.findMany({
    orderBy: { name: 'asc' },
    include: { adapterConfig: true },
  });
  return stores.map(toView);
}

/**
 * Replace a store's AdapterConfig JSON. `null` deletes the row, reverting the
 * store to the adapter's built-in defaults.
 */
export async function updateStoreAdapterConfig(
  storeId: string,
  config: unknown,
): Promise<StoreView> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { adapterConfig: true },
  });
  if (!store) throw new StoreNotFoundError(storeId);

  if (config === null) {
    if (store.adapterConfig) {
      await prisma.adapterConfig.delete({ where: { storeId } });
    }
    return toView({ ...store, adapterConfig: null });
  }

  const problems = validateAdapterOverrides(config);
  if (problems.length > 0) throw new InvalidAdapterConfigError(problems);

  const row = await prisma.adapterConfig.upsert({
    where: { storeId },
    create: { storeId, config: config as Prisma.InputJsonValue },
    update: { config: config as Prisma.InputJsonValue },
  });
  return toView({ ...store, adapterConfig: row });
}
