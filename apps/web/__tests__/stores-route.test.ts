import { beforeEach, describe, expect, test, vi } from 'vitest';

const findManyStore = vi.fn();
const findUniqueStore = vi.fn();
const upsertAdapterConfig = vi.fn();
const deleteAdapterConfig = vi.fn();

vi.mock('@pokemon-monitor/db', () => ({
  prisma: {
    store: {
      findMany: (...args: unknown[]) => findManyStore(...args),
      findUnique: (...args: unknown[]) => findUniqueStore(...args),
    },
    adapterConfig: {
      upsert: (...args: unknown[]) => upsertAdapterConfig(...args),
      delete: (...args: unknown[]) => deleteAdapterConfig(...args),
    },
  },
}));

import { GET } from '../app/api/stores/route';
import { PATCH } from '../app/api/stores/[id]/route';

const store = {
  id: 'store-1',
  key: 'dreamland',
  name: 'Dreamland',
  baseUrl: 'https://www.dreamland.be',
  adapterKey: 'dreamland',
  enabled: true,
  adapterConfig: null as { config: unknown } | null,
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

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueStore.mockResolvedValue(store);
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

  test('rejects a body without an adapterConfig field', async () => {
    const response = await makePatch('store-1', { somethingElse: true });

    expect(response.status).toBe(400);
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
});
