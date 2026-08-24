import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyStore = vi.fn();
const findUniqueStore = vi.fn();
const createStoreRow = vi.fn();
const updateStoreRow = vi.fn();
const deleteStoreRow = vi.fn();
const countProducts = vi.fn();
const upsertAdapterConfig = vi.fn();
const deleteAdapterConfig = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    store: {
      findMany: (...args: unknown[]) => findManyStore(...args),
      findUnique: (...args: unknown[]) => findUniqueStore(...args),
      create: (...args: unknown[]) => createStoreRow(...args),
      update: (...args: unknown[]) => updateStoreRow(...args),
      delete: (...args: unknown[]) => deleteStoreRow(...args),
    },
    product: {
      count: (...args: unknown[]) => countProducts(...args),
    },
    adapterConfig: {
      upsert: (...args: unknown[]) => upsertAdapterConfig(...args),
      delete: (...args: unknown[]) => deleteAdapterConfig(...args),
    },
  },
}));

import { GET, POST } from '../app/api/stores/route';
import { DELETE, PATCH } from '../app/api/stores/[id]/route';

const store = {
  id: 'store-1',
  key: 'dreamland',
  name: 'Dreamland',
  baseUrl: 'https://www.dreamland.be',
  adapterKey: 'dreamland',
  enabled: true,
  pollingInterval: 300,
  minIntervalMs: 10_000,
  ignoreRobotsTxt: false,
  adapterConfig: null as { config: unknown } | null,
};

const validStoreInput = {
  key: 'newstore',
  name: 'New Store',
  baseUrl: 'https://www.newstore.be',
  adapterKey: 'woocommerce',
};

function makePatch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/stores/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function makePost(body: unknown) {
  return POST(
    new Request('http://localhost/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function makeDelete(id: string) {
  return DELETE(new Request(`http://localhost/api/stores/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueStore.mockResolvedValue(store);
  countProducts.mockResolvedValue(0);
});

describe('GET /api/stores', () => {
  test('lists stores with their adapter config JSON', async () => {
    findManyStore.mockResolvedValue([
      { ...store, adapterConfig: { id: 'ac-1', storeId: 'store-1', config: { minIntervalMs: 30_000 } } },
      { ...store, id: 'store-2', key: 'other', name: 'Other', adapterConfig: null },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: 'store-1',
      key: 'dreamland',
      adapterKey: 'dreamland',
      adapterConfig: { minIntervalMs: 30_000 },
    });
    expect(body[1].adapterConfig).toBeNull();
  });
});

describe('PATCH /api/stores/:id', () => {
  test('upserts a valid adapter config', async () => {
    const config = { minIntervalMs: 30_000, customHeaders: { 'X-Api-Key': 'secret' } };
    upsertAdapterConfig.mockResolvedValue({ id: 'ac-1', storeId: 'store-1', config });

    const response = await makePatch('store-1', { adapterConfig: config });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(upsertAdapterConfig).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      create: { storeId: 'store-1', config },
      update: { config },
    });
    expect(body.adapterConfig).toEqual(config);
  });

  test('accepts unrecognized adapter-specific keys', async () => {
    const config = { selectors: { price: '.price' }, apiKey: 'abc' };
    upsertAdapterConfig.mockResolvedValue({ id: 'ac-1', storeId: 'store-1', config });

    const response = await makePatch('store-1', { adapterConfig: config });

    expect(response.status).toBe(200);
    expect(upsertAdapterConfig).toHaveBeenCalled();
  });

  test('null deletes the config row, reverting to adapter defaults', async () => {
    findUniqueStore.mockResolvedValue({
      ...store,
      adapterConfig: { id: 'ac-1', storeId: 'store-1', config: { minIntervalMs: 1 } },
    });

    const response = await makePatch('store-1', { adapterConfig: null });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteAdapterConfig).toHaveBeenCalledWith({ where: { storeId: 'store-1' } });
    expect(upsertAdapterConfig).not.toHaveBeenCalled();
    expect(body.adapterConfig).toBeNull();
  });

  test('null is a no-op when the store has no config row', async () => {
    const response = await makePatch('store-1', { adapterConfig: null });

    expect(response.status).toBe(200);
    expect(deleteAdapterConfig).not.toHaveBeenCalled();
  });

  test('rejects an invalid config with 400 and the list of problems', async () => {
    const response = await makePatch('store-1', {
      adapterConfig: { minIntervalMs: 'fast', customHeaders: { a: 1 } },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('minIntervalMs must be a non-negative number');
    expect(body.problems).toContain('customHeaders values must all be strings');
    expect(upsertAdapterConfig).not.toHaveBeenCalled();
  });

  test('rejects a non-object config with 400', async () => {
    const response = await makePatch('store-1', { adapterConfig: [1, 2, 3] });

    expect(response.status).toBe(400);
    expect(upsertAdapterConfig).not.toHaveBeenCalled();
  });

  test('rejects a body with neither adapterConfig nor a store field', async () => {
    const response = await makePatch('store-1', { somethingElse: true });

    expect(response.status).toBe(400);
    expect(upsertAdapterConfig).not.toHaveBeenCalled();
    expect(updateStoreRow).not.toHaveBeenCalled();
  });

  test('rejects a malformed JSON body', async () => {
    const response = await makePatch('store-1', '{not json');

    expect(response.status).toBe(400);
  });

  test('returns 404 for an unknown store', async () => {
    findUniqueStore.mockResolvedValue(null);

    const response = await makePatch('missing', { adapterConfig: {} });

    expect(response.status).toBe(404);
    expect(upsertAdapterConfig).not.toHaveBeenCalled();
  });

  test('updates the store’s own columns', async () => {
    updateStoreRow.mockResolvedValue({ ...store, name: 'Renamed', pollingInterval: 600 });

    const response = await makePatch('store-1', { name: 'Renamed', pollingInterval: 600 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateStoreRow).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { name: 'Renamed', pollingInterval: 600 },
      include: { adapterConfig: true },
    });
    expect(body).toMatchObject({ name: 'Renamed', pollingInterval: 600 });
  });

  test('rejects an unknown adapterKey with 400', async () => {
    const response = await makePatch('store-1', { adapterKey: 'not-a-real-adapter' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems[0]).toContain('adapterKey must be one of');
    expect(updateStoreRow).not.toHaveBeenCalled();
  });

  test('rejects renaming key onto an existing store with 409', async () => {
    findUniqueStore.mockImplementation((args: { where: { id?: string; key?: string } }) =>
      Promise.resolve(args.where.key === 'taken' ? { ...store, id: 'store-2' } : store),
    );

    const response = await makePatch('store-1', { key: 'taken' });

    expect(response.status).toBe(409);
    expect(updateStoreRow).not.toHaveBeenCalled();
  });
});

describe('POST /api/stores', () => {
  beforeEach(() => {
    findUniqueStore.mockResolvedValue(null);
  });

  test('creates a store and returns 201', async () => {
    createStoreRow.mockResolvedValue({ ...store, ...validStoreInput, id: 'store-9' });

    const response = await makePost(validStoreInput);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createStoreRow).toHaveBeenCalledWith({
      data: validStoreInput,
      include: { adapterConfig: true },
    });
    expect(body).toMatchObject({ id: 'store-9', key: 'newstore' });
  });

  test('passes through optional fields when supplied', async () => {
    createStoreRow.mockResolvedValue(store);

    await makePost({ ...validStoreInput, pollingInterval: 900, ignoreRobotsTxt: true });

    expect(createStoreRow).toHaveBeenCalledWith({
      data: { ...validStoreInput, pollingInterval: 900, ignoreRobotsTxt: true },
      include: { adapterConfig: true },
    });
  });

  test('rejects an unknown adapterKey with 400', async () => {
    const response = await makePost({ ...validStoreInput, adapterKey: 'nope' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems[0]).toContain('adapterKey must be one of');
    expect(createStoreRow).not.toHaveBeenCalled();
  });

  test('rejects a missing required field with 400', async () => {
    const response = await makePost({ name: 'Only a name' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('key is required');
    expect(createStoreRow).not.toHaveBeenCalled();
  });

  test('rejects a non-http baseUrl with 400', async () => {
    const response = await makePost({ ...validStoreInput, baseUrl: 'ftp://example.be' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.problems).toContain('baseUrl must be a valid http(s) URL');
    expect(createStoreRow).not.toHaveBeenCalled();
  });

  test('rejects a duplicate key with 409', async () => {
    findUniqueStore.mockResolvedValue(store);

    const response = await makePost(validStoreInput);

    expect(response.status).toBe(409);
    expect(createStoreRow).not.toHaveBeenCalled();
  });

  test('rejects a malformed JSON body with 400', async () => {
    const response = await makePost('{not json');

    expect(response.status).toBe(400);
    expect(createStoreRow).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/stores/:id', () => {
  test('deletes a store with no products', async () => {
    const response = await makeDelete('store-1');

    expect(response.status).toBe(204);
    expect(deleteStoreRow).toHaveBeenCalledWith({ where: { id: 'store-1' } });
  });

  test('refuses to delete a store that still has products', async () => {
    countProducts.mockResolvedValue(3);

    const response = await makeDelete('store-1');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.productCount).toBe(3);
    expect(deleteStoreRow).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown store', async () => {
    findUniqueStore.mockResolvedValue(null);

    const response = await makeDelete('missing');

    expect(response.status).toBe(404);
    expect(deleteStoreRow).not.toHaveBeenCalled();
  });
});
