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
const jsonPath = '/products/pokemon-sv-booster-box.json';

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf8'));
}

describe('extractShopifyHandle', () => {
  test.each([
    [`${storeOrigin}/products/my-handle`, 'my-handle'],
    [`${storeOrigin}/products/my-handle.json`, 'my-handle'],
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

  test('detects in-stock product', async () => {
    const body = await loadFixture('shopify-instock.json');
    nock(storeOrigin).get(jsonPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(159.95);
    expect(result.currency).toBe('EUR');
    expect(result.title).toBe('Pokemon TCG Scarlet & Violet Booster Box');
    expect(result.availability).toBe('In stock');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  test('detects out-of-stock product but still reports its price', async () => {
    const body = await loadFixture('shopify-outofstock.json');
    nock(storeOrigin).get(jsonPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(49.95);
    expect(result.availability).toBe('Out of stock');
  });

  test('prefers an available variant when some variants are sold out', async () => {
    const body = await loadFixture('shopify-multivariant.json');
    nock(storeOrigin).get(jsonPath).reply(200, body);

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(29.95);
  });

  test('returns error result on network failure without throwing', async () => {
    nock(storeOrigin).get(jsonPath).replyWithError('Connection timeout');

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Connection timeout');
  });

  test('returns error result on 404 without throwing', async () => {
    nock(storeOrigin).get(jsonPath).reply(404, { errors: 'Not Found' });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.availability).toContain('ERROR');
  });

  test('returns error result when the product has no variants', async () => {
    nock(storeOrigin)
      .get(jsonPath)
      .reply(200, { product: { title: 'Handle exists but no variants', variants: [] } });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no variants');
  });

  test('returns error result when the response has no product object', async () => {
    nock(storeOrigin).get(jsonPath).reply(200, { unexpected: true });

    const adapter = new ShopifyGenericAdapter();
    const result = await adapter.checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('product object');
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
    nock(otherOrigin).get(jsonPath).reply(200, body);

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
