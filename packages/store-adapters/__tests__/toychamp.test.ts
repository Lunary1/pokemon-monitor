import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { ToyChampAdapter } from '../src/adapters/toychamp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');
const productUrl = 'https://www.toychamp.be/pokemon-booster';

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixtureDir, name), 'utf8');
}

describe('ToyChampAdapter', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  test('CI validation: deliberately failing test', () => {
    expect(true).toBe(false);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('detects in-stock product', async () => {
    const html = await loadFixture('toychamp-instock.html');
    nock('https://www.toychamp.be').get('/pokemon-booster').reply(200, html);

    const adapter = new ToyChampAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(54.99);
    expect(result.currency).toBe('EUR');
    expect(result.availability).toBe('Op voorraad');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  test('detects out-of-stock product', async () => {
    const html = await loadFixture('toychamp-outofstock.html');
    nock('https://www.toychamp.be').get('/pokemon-booster').reply(200, html);

    const adapter = new ToyChampAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(54.99);
    expect(result.availability).toBe('Uitverkocht');
  });

  test('returns error result on network failure without throwing', async () => {
    nock('https://www.toychamp.be')
      .get('/pokemon-booster')
      .replyWithError('Connection timeout');

    const adapter = new ToyChampAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Connection timeout');
  });
});
