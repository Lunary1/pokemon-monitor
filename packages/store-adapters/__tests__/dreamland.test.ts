import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { DreamlandAdapter } from '../src/adapters/dreamland';
import { ToyChampAdapter } from '../src/adapters/toychamp';
import { getAdapter } from '../src/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');
const productPath = '/nl/producten/pokemon-test/01841701';
const productUrl = `https://www.dreamland.be${productPath}`;

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixtureDir, name), 'utf8');
}

/** A minimal page carrying whatever JSON-LD body the test needs. */
function pageWithJsonLd(json: string): string {
  return `<!doctype html><html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;
}

describe('DreamlandAdapter', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('detects in-stock product from JSON-LD', async () => {
    const html = await loadFixture('dreamland-instock.html');
    nock('https://www.dreamland.be').get(productPath).reply(200, html);

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(19.99);
    expect(result.currency).toBe('EUR');
    expect(result.title).toBe('Pokemon Scarlet & Violet 09 - Blister 3 boosters');
    expect(result.availability).toBe('https://schema.org/InStock');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  test('detects out-of-stock product but still reports its price', async () => {
    const html = await loadFixture('dreamland-outofstock.html');
    nock('https://www.dreamland.be').get(productPath).reply(200, html);

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(69.99);
    expect(result.availability).toBe('https://schema.org/OutOfStock');
  });

  test('returns error result on network failure without throwing', async () => {
    nock('https://www.dreamland.be').get(productPath).replyWithError('Connection timeout');

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Connection timeout');
  });

  test('sends caller-provided customHeaders instead of its defaults (#30)', async () => {
    const html = await loadFixture('dreamland-instock.html');
    const scope = nock('https://www.dreamland.be', {
      reqheaders: {
        'x-api-key': 'store-secret',
        'accept-language': 'fr-BE',
      },
    })
      .get(productPath)
      .reply(200, html);

    const result = await new DreamlandAdapter().checkProduct(productUrl, {
      customHeaders: { 'X-Api-Key': 'store-secret', 'Accept-Language': 'fr-BE' },
    });

    expect(scope.isDone()).toBe(true);
    expect(result.inStock).toBe(true);
  });

  test('falls back to its own default headers when no customHeaders are given', async () => {
    const html = await loadFixture('dreamland-instock.html');
    const scope = nock('https://www.dreamland.be', {
      reqheaders: { 'accept-language': 'nl-BE,nl;q=0.9' },
    })
      .get(productPath)
      .reply(200, html);

    await new DreamlandAdapter().checkProduct(productUrl);

    expect(scope.isDone()).toBe(true);
  });

  test('returns error result on a 403 bot block without throwing', async () => {
    // The live site 403s aggressively; this must never look like out-of-stock.
    nock('https://www.dreamland.be').get(productPath).reply(403, 'Forbidden');

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.price).toBeNull();
  });
});

describe('DreamlandAdapter — parse failures must be loud, not silent (#86)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('the legacy selector-era markup now yields an ERROR, not a false out-of-stock', async () => {
    // This is the exact regression: the old page shape used to parse as
    // inStock: false, indistinguishable from a genuinely sold-out product.
    const html = await loadFixture('legacy/dreamland-instock.html');
    nock('https://www.dreamland.be').get(productPath).reply(200, html);

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no application/ld+json');
  });

  test('a page with no JSON-LD at all yields an ERROR', async () => {
    nock('https://www.dreamland.be')
      .get(productPath)
      .reply(200, '<!doctype html><html><body><h1>Some product</h1></body></html>');

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
  });

  test('JSON-LD without a Product node yields an ERROR', async () => {
    nock('https://www.dreamland.be')
      .get(productPath)
      .reply(200, pageWithJsonLd('{"@context":"https://schema.org","@type":"BreadcrumbList"}'));

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('@type Product');
  });

  test('a Product with no offers yields an ERROR', async () => {
    nock('https://www.dreamland.be')
      .get(productPath)
      .reply(200, pageWithJsonLd('{"@type":"Product","name":"No offers here"}'));

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no offers');
  });

  test('an offer with no availability yields an ERROR', async () => {
    nock('https://www.dreamland.be')
      .get(productPath)
      .reply(
        200,
        pageWithJsonLd('{"@type":"Product","offers":{"@type":"Offer","price":"9.99"}}'),
      );

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no availability');
  });

  test('an unrecognised availability value yields an ERROR rather than a guess', async () => {
    nock('https://www.dreamland.be')
      .get(productPath)
      .reply(
        200,
        pageWithJsonLd(
          '{"@type":"Product","offers":{"@type":"Offer","price":"9.99","availability":"https://schema.org/BackOrder"}}',
        ),
      );

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('unrecognised availability');
  });

  test('malformed JSON in the ld+json block yields an ERROR', async () => {
    nock('https://www.dreamland.be').get(productPath).reply(200, pageWithJsonLd('{not json'));

    const result = await new DreamlandAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
  });
});

describe('ToyChamp/Dreamland merge (#86)', () => {
  test('the toychamp registry key resolves to the same instance as dreamland', () => {
    // toychamp.be 301s to dreamland.be — one storefront, so one adapter.
    // Existing Store rows with either adapterKey must keep working.
    expect(getAdapter('toychamp')).toBe(getAdapter('dreamland'));
    expect(getAdapter('toychamp')).toBeDefined();
  });

  test('ToyChampAdapter is retained as an alias of DreamlandAdapter', () => {
    expect(ToyChampAdapter).toBe(DreamlandAdapter);
  });
});
