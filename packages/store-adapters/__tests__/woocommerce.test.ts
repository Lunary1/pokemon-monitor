import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { WooCommerceAdapter, parseWooPrice } from '../src/adapters/woocommerce';
import { getAdapter } from '../src/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures');

const storeOrigin = 'https://tcgfanz.example';
const productPath = '/product/suicune-pokemon-center-fit-knuffel/';
const productUrl = `${storeOrigin}${productPath}`;

async function loadFixture(name: string): Promise<string> {
  return readFile(join(fixtureDir, name), 'utf8');
}

/** A minimal WooCommerce-shaped page carrying only the markup a test needs. */
function pageWithBody(body: string): string {
  return `<!doctype html><html><head></head><body>${body}</body></html>`;
}

describe('parseWooPrice', () => {
  test.each([
    ['€ 24,99', 24.99],
    ['€ 2,00', 2],
    ['$1,234.56', 1234.56],
    ['€ 1.234,56', 1234.56],
    ['£9.99', 9.99],
    ['24', 24],
  ])('parses %s', (raw, expected) => {
    expect(parseWooPrice(raw)).toBe(expected);
  });

  test('returns null when there is no number to read', () => {
    expect(parseWooPrice('Prijs op aanvraag')).toBeNull();
  });
});

describe('WooCommerceAdapter — JSON-LD path', () => {
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
    const html = await loadFixture('woocommerce-instock.html');
    nock(storeOrigin).get(productPath).reply(200, html);

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(2);
    expect(result.currency).toBe('EUR');
    expect(result.title).toBe('Eevee #135 (Twilight Masquerade)');
    expect(result.availability).toBe('http://schema.org/InStock');
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  test('detects out-of-stock product but still reports its price', async () => {
    const html = await loadFixture('woocommerce-outofstock.html');
    nock(storeOrigin).get(productPath).reply(200, html);

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(24.99);
    expect(result.availability).toBe('http://schema.org/OutOfStock');
  });

  test('reads the price from priceSpecification, where WooCommerce puts it', async () => {
    // WooCommerce nests price under offers[].priceSpecification[] rather than
    // on the offer itself. Before this was supported, every WooCommerce
    // product reported price: null while availability parsed fine.
    const html = await loadFixture('woocommerce-instock.html');
    nock(storeOrigin).get(productPath).reply(200, html);

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.price).toBe(2);
    expect(result.currency).toBe('EUR');
  });
});

describe('WooCommerceAdapter — selector fallback', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('reads in-stock from the wrapper class when the page has no JSON-LD', async () => {
    const html = await loadFixture('woocommerce-nojsonld-instock.html');
    nock(storeOrigin).get(productPath).reply(200, html);

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBe(2);
    expect(result.currency).toBe('EUR');
    expect(result.title).toBe('Eevee #135 (Twilight Masquerade)');
    expect(result.availability).toBe('In stock');
  });

  test('reads out-of-stock from the wrapper class when the page has no JSON-LD', async () => {
    const html = await loadFixture('woocommerce-nojsonld-outofstock.html');
    nock(storeOrigin).get(productPath).reply(200, html);

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBe(24.99);
    expect(result.title).toBe('Suicune Pokémon Center Fit Knuffel');
    expect(result.availability).toBe('Uitverkocht');
  });

  test('falls back to the stock paragraph when the wrapper carries no stock class', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        pageWithBody(
          '<div class="product"><p class="stock in-stock">Op voorraad</p></div>',
        ),
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.availability).toBe('Op voorraad');
  });

  test('falls back to the add-to-cart form as the last positive signal', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        pageWithBody(
          '<div class="product"><form class="cart"><button name="add-to-cart" value="123">In winkelwagen</button></form></div>',
        ),
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.availability).toBe('In stock');
  });

  test('prefers the wrapper stock class over a stale add-to-cart form', async () => {
    // A sold-out variable product still renders the purchase form, so the
    // form alone must never override an explicit outofstock class.
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        pageWithBody(
          '<div class="product outofstock"><form class="cart"><button name="add-to-cart" value="123">In winkelwagen</button></form></div>',
        ),
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.availability).toBe('Out of stock');
  });

  test('reports an unreadable price as null while availability still parses', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(200, pageWithBody('<div class="product instock"></div>'));

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
  });

  test('reads a non-EUR currency from the rendered symbol', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        pageWithBody(
          '<div class="product instock"><p class="price"><span class="woocommerce-Price-amount"><bdi><span class="woocommerce-Price-currencySymbol">£</span>9.99</bdi></span></p></div>',
        ),
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.currency).toBe('GBP');
    expect(result.price).toBe(9.99);
  });
});

describe('WooCommerceAdapter — failures must be loud, not silent (#86, #88)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('returns error result on network failure without throwing', async () => {
    nock(storeOrigin).get(productPath).replyWithError('Connection timeout');

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.currency).toBe('EUR');
    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('Connection timeout');
  });

  test('returns error result on a 404 without throwing', async () => {
    nock(storeOrigin).get(productPath).reply(404, 'Not Found');

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.price).toBeNull();
    expect(result.availability).toContain('ERROR');
  });

  test('returns error result on a 403 bot block without throwing', async () => {
    nock(storeOrigin).get(productPath).reply(403, 'Forbidden');

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(false);
    expect(result.availability).toContain('ERROR');
  });

  test('a page with no stock signal at all yields an ERROR, not a false out-of-stock', async () => {
    // The core invariant: an unparseable page must never be reported as
    // sold out, because that is indistinguishable from a real sell-out.
    nock(storeOrigin)
      .get(productPath)
      .reply(200, pageWithBody('<h1>Some page that is not a product</h1>'));

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no WooCommerce stock signal');
    expect(result.price).toBeNull();
  });

  test('a product wrapper with neither stock class nor form yields an ERROR', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        pageWithBody('<div class="product"><h1 class="product_title">No signal</h1></div>'),
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.inStock).toBe(false);
  });

  test('an unrecognised JSON-LD availability value yields an ERROR rather than falling back', async () => {
    // A JSON-LD block that parses but carries a value we cannot map is a
    // genuine unknown. Falling through to selectors here would let a
    // definite "unknown" be overwritten by a weaker guess.
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        `<!doctype html><html><head><script type="application/ld+json">{"@type":"Product","name":"Odd","offers":{"@type":"Offer","price":"9.99","availability":"https://schema.org/BackOrder"}}</script></head><body><div class="product instock"></div></body></html>`,
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('unrecognised availability');
  });

  test('a Product with no offers yields an ERROR rather than falling back to selectors', async () => {
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        `<!doctype html><html><head><script type="application/ld+json">{"@type":"Product","name":"No offers"}</script></head><body><div class="product instock"></div></body></html>`,
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.availability).toContain('ERROR');
    expect(result.availability).toContain('no offers');
  });

  test('a page whose JSON-LD has no Product node still uses the selector fallback', async () => {
    // The complement of the two tests above: markup that is *absent* rather
    // than unreadable is exactly the case the fallback exists to serve.
    nock(storeOrigin)
      .get(productPath)
      .reply(
        200,
        `<!doctype html><html><head><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></head><body><div class="product instock"></div></body></html>`,
      );

    const result = await new WooCommerceAdapter().checkProduct(productUrl);

    expect(result.inStock).toBe(true);
    expect(result.availability).toBe('In stock');
  });
});

describe('WooCommerceAdapter — configuration and registry', () => {
  test('is registered under the woocommerce key', () => {
    expect(getAdapter('woocommerce')).toBeInstanceOf(WooCommerceAdapter);
  });

  test('respects robots.txt and declares a per-domain throttle (SDLC §7)', () => {
    const { config } = new WooCommerceAdapter();

    expect(config.respectRobotsTxt).toBe(true);
    expect(config.minIntervalMs).toBeGreaterThanOrEqual(10_000);
  });

  test('normalizeUrl strips tracking params', () => {
    const adapter = new WooCommerceAdapter();

    expect(adapter.normalizeUrl(`${productUrl}?utm_source=discord&ref=x`)).toBe(productUrl);
  });

  test('getAddToCartUrl returns null — no checkout automation (plan §10)', () => {
    expect(new WooCommerceAdapter().getAddToCartUrl(productUrl)).toBeNull();
  });
});
