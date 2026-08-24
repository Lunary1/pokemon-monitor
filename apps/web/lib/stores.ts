import { prisma, type Prisma } from '@pokemon-monitor/db';
import { listAdapterKeys, validateAdapterOverrides } from '@pokemon-monitor/store-adapters';

export interface StoreView {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
  pollingInterval: number;
  minIntervalMs: number;
  ignoreRobotsTxt: boolean;
  /** Raw AdapterConfig.config JSON, or null when the store has no override row. */
  adapterConfig: unknown;
}

export interface StoreInput {
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled?: boolean;
  pollingInterval?: number;
  minIntervalMs?: number;
  ignoreRobotsTxt?: boolean;
}

export type StorePatch = Partial<StoreInput>;

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

export class InvalidStoreError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid store: ${problems.join('; ')}`);
    this.name = 'InvalidStoreError';
  }
}

export class DuplicateStoreKeyError extends Error {
  constructor(key: string) {
    super(`A store with key "${key}" already exists`);
    this.name = 'DuplicateStoreKeyError';
  }
}

export class StoreHasProductsError extends Error {
  constructor(
    storeId: string,
    public readonly productCount: number,
  ) {
    super(
      `Store ${storeId} still has ${productCount} product(s). Delete or move them to another store first.`,
    );
    this.name = 'StoreHasProductsError';
  }
}

function toView(store: {
  id: string;
  key: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
  pollingInterval: number;
  minIntervalMs: number;
  ignoreRobotsTxt: boolean;
  adapterConfig: { config: unknown } | null;
}): StoreView {
  return {
    id: store.id,
    key: store.key,
    name: store.name,
    baseUrl: store.baseUrl,
    adapterKey: store.adapterKey,
    enabled: store.enabled,
    pollingInterval: store.pollingInterval,
    minIntervalMs: store.minIntervalMs,
    ignoreRobotsTxt: store.ignoreRobotsTxt,
    adapterConfig: store.adapterConfig?.config ?? null,
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

/**
 * Shared field validation for create (all required fields must be present) and
 * patch (`partial`, so only the supplied fields are checked).
 */
function validateStoreFields(input: StorePatch, { partial }: { partial: boolean }): string[] {
  const problems: string[] = [];

  for (const field of ['key', 'name', 'baseUrl', 'adapterKey'] as const) {
    const value = input[field];
    if (value === undefined) {
      if (!partial) problems.push(`${field} is required`);
      continue;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${field} must be a non-empty string`);
    }
  }

  if (typeof input.baseUrl === 'string' && input.baseUrl.trim() !== '' && !isHttpUrl(input.baseUrl)) {
    problems.push('baseUrl must be a valid http(s) URL');
  }

  if (typeof input.adapterKey === 'string' && input.adapterKey.trim() !== '') {
    const known = listAdapterKeys();
    if (!known.includes(input.adapterKey)) {
      problems.push(`adapterKey must be one of: ${known.join(', ')}`);
    }
  }

  for (const field of ['pollingInterval', 'minIntervalMs'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      problems.push(`${field} must be a non-negative integer`);
    }
  }

  for (const field of ['enabled', 'ignoreRobotsTxt'] as const) {
    const value = input[field];
    if (value !== undefined && typeof value !== 'boolean') {
      problems.push(`${field} must be a boolean`);
    }
  }

  return problems;
}

export async function listStores(): Promise<StoreView[]> {
  const stores = await prisma.store.findMany({
    orderBy: { name: 'asc' },
    include: { adapterConfig: true },
  });
  return stores.map(toView);
}

export async function createStore(input: StoreInput): Promise<StoreView> {
  const problems = validateStoreFields(input, { partial: false });
  if (problems.length > 0) throw new InvalidStoreError(problems);

  const existing = await prisma.store.findUnique({ where: { key: input.key } });
  if (existing) throw new DuplicateStoreKeyError(input.key);

  const store = await prisma.store.create({
    data: {
      key: input.key,
      name: input.name,
      baseUrl: input.baseUrl,
      adapterKey: input.adapterKey,
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.pollingInterval !== undefined && { pollingInterval: input.pollingInterval }),
      ...(input.minIntervalMs !== undefined && { minIntervalMs: input.minIntervalMs }),
      ...(input.ignoreRobotsTxt !== undefined && { ignoreRobotsTxt: input.ignoreRobotsTxt }),
    },
    include: { adapterConfig: true },
  });

  return toView(store);
}

export async function updateStore(storeId: string, patch: StorePatch): Promise<StoreView> {
  const problems = validateStoreFields(patch, { partial: true });
  if (problems.length > 0) throw new InvalidStoreError(problems);

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new StoreNotFoundError(storeId);

  // `key` is unique; renaming onto another store's key would fail at the DB
  // level, so check first and surface it as a 409 rather than a 500.
  if (patch.key !== undefined && patch.key !== store.key) {
    const clash = await prisma.store.findUnique({ where: { key: patch.key } });
    if (clash) throw new DuplicateStoreKeyError(patch.key);
  }

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: patch,
    include: { adapterConfig: true },
  });

  return toView(updated);
}

/**
 * Hard-deletes a store. Product has no `onDelete: Cascade` back to Store, so a
 * store with products would fail on the FK constraint — that's reported as a
 * typed error (409 at the route) instead of surfacing as a 500.
 */
export async function deleteStore(storeId: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new StoreNotFoundError(storeId);

  const productCount = await prisma.product.count({ where: { storeId } });
  if (productCount > 0) throw new StoreHasProductsError(storeId, productCount);

  // AdapterConfig *does* cascade from Store, so it needs no explicit cleanup.
  await prisma.store.delete({ where: { id: storeId } });
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
