import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  ShopifyGenericAdapter,
  extractShopifyHandle,
} from '../src/adapters/shopify-generic';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');

const storeOrigin = 'https://pokeshop.example';
const productUrl = `${storeOrigin}/products/pokemon-sv-booster-box`;
// The adapter reads `.js`, not `.json` — the detail endpoint omits
// `available` entirely, which is what #88 was.
const jsPath = '/products/pokemon-sv-booster-box.js';

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf8'));
}

describe('extractShopifyHandle', () => {
  test.each([
    [`${storeOrigin}/products/my-handle`, 'my-handle'],
    [`${storeOrigin}/products/my-handle.json`, 'my-handle'],
    [`${storeOrigin}/products/my-handle.js`, 'my-handle'],
    [`${storeOrigin}/collections/tcg/products/my-handle`, 'my-handle'],
    [`${storeOrigin}/products/my-handle?variant=123`, 'my-handle'],
    [`${storeOrigin}/en/products/my-handle`, 'my-handle'],
  ])('extracts the handle from %s', (url, expected) => {
    expect(extractShopifyHandle(url)).toBe(expected);
  });

  test('throws for a URL with no /products/ segment', () => {
    expect(() => extractShopifyHandle(`${storeOrigin}/collections/tcg`)).toThrow(
      /Not a Shopify product URL/,
    );
  });

  test('throws when /products/ has no handle after it', () => {
    expect(() => extractShopifyHandle(`${storeOrigin}/products/`)).toThrow(
      /Not a Shopify product URL/,
    );
  });
});

describe('ShopifyGenericAdapter', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('requests the .js endpoint, not the .json one (#88)', async () => {
    // Guards the endpoint choice itself: `.json` omits `available`, so a
    // regression back to it would silently report everything out of stock.
    const body = await loadFixture('shopify-instock.json');
    const scope = nock(storeOrigin).get(jsPath).reply(200, body);

    await new ShopifyGenericAdapter().checkProduct(productUrl);

    expect(scope.isDone()).toBe(true);
  });

  test('sends caller-provided customHeaders on the request (#30)', async () => {
    const body = await loadFixture('shopify-instock.json');
    const scope = nock(storeOrigin, {
      reqheaders: { 'x-api-key': 'store-secret' },
    })
      .get(jsPath)
      .reply(200, body);

    const result = await new ShopifyGenericAdapter().checkProduct(productUrl, {
      customHeaders: { 'X-Api-Key': 'store-secret' },
    });

    expect(scope.isDone()).toBe(true);
    expect(result.inStock).toBe(true);
  });

  test('detects in-stock product', async () => {
    const body = await loadFixture('shopify-instock.json');
    nock(storeOrigin).get(jsPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    // Fixture carries 18495 minor units.
    expect(result.price).toBe(184.95);
    expect(result.currency).toBe('EUR');
    expect(result.title).toBe('Pokémon TCG - Storm Emeralda Japanse Booster Box');
    expect(result.availability).toBe('In stock');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  test('detects out-of-stock product but still reports its price', async () => {
    const body = await loadFixture('shopify-outofstock.json');
    nock(storeOrigin).get(jsPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(14.95);
    expect(result.availability).toBe('Out of stock');
  });

  test('prefers an available variant when some variants are sold out', async () => {
    // Real capture with genuinely mixed availability: [true, true, true, false].
    const body = await loadFixture('shopify-multivariant.json');
    nock(storeOrigin).get(jsPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(189.99);
  });

  test('reports out of stock only when every variant is sold out', async () => {
    const body = (await loadFixture('shopify-multivariant.json')) as {
      variants: { available: boolean }[];
    };
    body.variants.forEach((variant) => {
      variant.available = false;
    });
    nock(storeOrigin).get(jsPath).reply(200, body);

    const result = await new ShopifyGenericAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(189.99);
  });

  test('returns error result on network failure without throwing', async () => {
    nock(storeOrigin).get(jsPath).replyWithError('Connection timeout');

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Connection timeout');
  });

  test('returns error result on 404 without throwing', async () => {
    nock(storeOrigin).get(jsPath).reply(404, { errors: 'Not Found' });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.availability).toContain('ERROR');
  });

  test('returns error result when the product has no variants', async () => {
    nock(storeOrigin)
      .get(jsPath)
      .reply(200, { title: 'Handle exists but no variants', variants: [] });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no variants');
  });

  test('returns error result when the response is not a product object', async () => {
    nock(storeOrigin).get(jsPath).reply(200, { unexpected: true });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no variants');
  });

  test('returns error result for a non-Shopify product URL without throwing', async () => {
    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(`${storeOrigin}/collections/tcg`);

    expect(result.inStock).toBe(false);
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Not a Shopify product URL');
  });

  test('requests the origin of the product URL, not the configured baseUrl', async () => {
    const otherOrigin = 'https://another-shop.example';
    const body = await loadFixture('shopify-instock.json');
    nock(otherOrigin).get(jsPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(`${otherOrigin}/products/pokemon-sv-booster-box`);

    expect(result.inStock).toBe(true);
    expect(nock.isDone()).toBe(true);
  });

  test('normalizeUrl strips tracking and variant params', () => {
    const adapter = new ShopifyGenericAdapter();

    expect(adapter.normalizeUrl(`${productUrl}?utm_source=discord&variant=42`)).toBe(productUrl);
  });
});

describe('ShopifyGenericAdapter — missing availability must be loud, not silent (#88)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('a .json-shaped response (no `available` field) yields an ERROR, not a false out-of-stock', async () => {
    // This is the exact regression. The `/products/{handle}.json` detail
    // endpoint returns variants with no `available` key at all — verified on
    // tcgreus.nl, pkmwinkel.nl and cardstore.nl. The old adapter read that as
    // `inStock: false` for every product on every store.
    nock(storeOrigin)
      .get(jsPath)
      .reply(200, {
        title: 'Detail-endpoint shaped payload',
        variants: [
          {
            id: 41234567890123,
            title: 'Default Title',
            price: '184.95',
            sku: 'PKM-SV-BB-01',
            inventory_management: 'shopify',
          },
        ],
      });

    const result = await new ShopifyGenericAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('availability');
    expect(result.price).toBeNull();
  });

  test('a non-boolean availability value yields an ERROR rather than a guess', async () => {
    nock(storeOrigin)
      .get(jsPath)
      .reply(200, {
        title: 'Odd payload',
        variants: [{ available: 'yes', price: 1495 }],
      });

    const result = await new ShopifyGenericAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.inStock).toBe(false);
  });

  test('an unreadable price is reported as null while availability still parses', async () => {
    // Price is not load-bearing for restock detection, so unlike availability
    // it degrades to null rather than failing the whole check.
    nock(storeOrigin)
      .get(jsPath)
      .reply(200, {
        title: 'No price',
        variants: [{ available: true }],
      });

    const result = await new ShopifyGenericAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBeNull();
    expect(result.availability).toBe('In stock');
  });
});
