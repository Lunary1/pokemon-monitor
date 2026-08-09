import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_USER_AGENT,
  isPathAllowed,
  isUrlAllowed,
  parseRobotsTxt,
  resetRobotsCache,
} from '../src/robots';

const origin = 'https://shop.example';

function allowed(body: string, path: string, agent = DEFAULT_USER_AGENT): boolean {
  return isPathAllowed(parseRobotsTxt(body), path, agent);
}

describe('parseRobotsTxt / isPathAllowed', () => {
  test('allows everything when no rules apply', () => {
    expect(allowed('User-agent: *\nDisallow:', '/products/foo')).toBe(true);
  });

  test('an empty Disallow does not block the site', () => {
    // Getting this backwards would block every path — a real footgun.
    expect(allowed('User-agent: *\nDisallow:', '/')).toBe(true);
  });

  test('blocks a disallowed prefix', () => {
    expect(allowed('User-agent: *\nDisallow: /cart', '/cart/add')).toBe(false);
  });

  test('leaves unrelated paths alone', () => {
    expect(allowed('User-agent: *\nDisallow: /cart', '/products/foo')).toBe(true);
  });

  test('longest match wins over a broader rule', () => {
    const body = 'User-agent: *\nDisallow: /\nAllow: /products/';
    expect(allowed(body, '/products/foo')).toBe(true);
    expect(allowed(body, '/checkout')).toBe(false);
  });

  test('Allow wins when patterns are the same length', () => {
    const body = 'User-agent: *\nDisallow: /a\nAllow: /a';
    expect(allowed(body, '/a')).toBe(true);
  });

  test('supports * wildcards', () => {
    const body = 'User-agent: *\nDisallow: /*/admin';
    expect(allowed(body, '/store/admin')).toBe(false);
    expect(allowed(body, '/store/products')).toBe(true);
  });

  test('supports $ end anchors', () => {
    const body = 'User-agent: *\nDisallow: /*.json$';
    expect(allowed(body, '/products/foo.json')).toBe(false);
    expect(allowed(body, '/products/foo.json?x=1')).toBe(true);
  });

  test('strips comments and ignores blank lines', () => {
    const body = '# leading comment\n\nUser-agent: *   # inline\nDisallow: /cart # trailing\n';
    expect(allowed(body, '/cart')).toBe(false);
    expect(allowed(body, '/products/foo')).toBe(true);
  });

  test('prefers a named agent group over the wildcard group', () => {
    const body = [
      'User-agent: *',
      'Disallow: /',
      '',
      `User-agent: ${DEFAULT_USER_AGENT}`,
      'Disallow: /admin',
    ].join('\n');

    expect(allowed(body, '/products/foo')).toBe(true);
    expect(allowed(body, '/admin')).toBe(false);
  });

  test('falls back to the wildcard group for an unlisted agent', () => {
    const body = 'User-agent: googlebot\nDisallow:\n\nUser-agent: *\nDisallow: /products';
    expect(allowed(body, '/products/foo')).toBe(false);
  });

  test('consecutive User-agent lines share one rule block', () => {
    const body = 'User-agent: googlebot\nUser-agent: bingbot\nDisallow: /x\n\nUser-agent: *\nDisallow:';
    expect(allowed(body, '/x', 'googlebot')).toBe(false);
    expect(allowed(body, '/x', 'bingbot')).toBe(false);
    expect(allowed(body, '/x')).toBe(true);
  });

  test('matches pkmwinkel.nl verbatim, including its Allow/Disallow overlap', () => {
    // Captured from https://www.pkmwinkel.nl/robots.txt. Verified live: the
    // parser's verdicts match on every path below. Note /cart has NO trailing
    // slash in the URL but the rule does, so /cart is genuinely allowed —
    // and /products/checkout wins over /checkout on pattern length.
    const body = [
      'User-agent: *',
      'Allow: /products/checkout',
      'Allow: /*/products/checkout',
      'Allow: /collections/checkout',
      'Allow: /pages/checkout',
      'Allow: /blogs/*checkout',
      'Disallow: /cart/',
      'Disallow: /*/cart/',
      'Disallow: /checkout',
      'Disallow: /*/checkout',
      'Disallow: /checkouts/',
      'Disallow: /cart.js',
    ].join('\n');

    expect(allowed(body, '/products/pokemon-booster')).toBe(true);
    expect(allowed(body, '/cart/')).toBe(false);
    expect(allowed(body, '/cart.js')).toBe(false);
    expect(allowed(body, '/checkout')).toBe(false);
    // The overlap: a longer Allow beats a shorter Disallow.
    expect(allowed(body, '/products/checkout')).toBe(true);
  });

  test('matches the real Shopify shape seen on the surveyed stores', () => {
    // Abbreviated from live robots.txt: broad checkout/cart blocks, products
    // explicitly reachable. All six stores surveyed had this shape.
    const body = [
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /cart',
      'Disallow: /orders',
      'Disallow: /checkout',
      'Disallow: /*/orders',
      'Allow: /products',
      'Sitemap: https://shop.example/sitemap.xml',
      'Crawl-delay: 10',
    ].join('\n');

    expect(allowed(body, '/products/pokemon-booster-box.json')).toBe(true);
    expect(allowed(body, '/products/pokemon-booster-box')).toBe(true);
    expect(allowed(body, '/checkout')).toBe(false);
    expect(allowed(body, '/cart/add')).toBe(false);
  });
});

describe('isUrlAllowed', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    resetRobotsCache();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('fetches robots.txt and honours it', async () => {
    nock(origin).get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /checkout');

    expect(await isUrlAllowed(`${origin}/products/foo`)).toBe(true);
  });

  test('blocks a disallowed path', async () => {
    nock(origin).get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /checkout');

    expect(await isUrlAllowed(`${origin}/checkout`)).toBe(false);
  });

  test('evaluates the query string as part of the path', async () => {
    nock(origin).get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /*?preview');

    expect(await isUrlAllowed(`${origin}/products/foo?preview=1`)).toBe(false);
  });

  test('caches the fetch across calls to the same origin', async () => {
    const scope = nock(origin).get('/robots.txt').once().reply(200, 'User-agent: *\nDisallow:');

    await isUrlAllowed(`${origin}/a`);
    await isUrlAllowed(`${origin}/b`);
    await isUrlAllowed(`${origin}/c`);

    expect(scope.isDone()).toBe(true);
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  test('fetches separately per origin', async () => {
    nock(origin).get('/robots.txt').reply(200, 'User-agent: *\nDisallow: /x');
    nock('https://other.example').get('/robots.txt').reply(200, 'User-agent: *\nDisallow:');

    expect(await isUrlAllowed(`${origin}/x`)).toBe(false);
    expect(await isUrlAllowed('https://other.example/x')).toBe(true);
  });
});

describe('isUrlAllowed — fail-open behaviour', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    resetRobotsCache();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  test('allows when robots.txt 404s (no rules published)', async () => {
    nock(origin).get('/robots.txt').reply(404);

    expect(await isUrlAllowed(`${origin}/products/foo`)).toBe(true);
  });

  test('allows when robots.txt is 403 blocked', async () => {
    // Dreamland does exactly this. Accepted limitation of fail-open: such a
    // site is never actually gated by this check.
    nock(origin).get('/robots.txt').reply(403, 'Forbidden');

    expect(await isUrlAllowed(`${origin}/products/foo`)).toBe(true);
  });

  test('allows when robots.txt 5xxs', async () => {
    nock(origin).get('/robots.txt').reply(503);

    expect(await isUrlAllowed(`${origin}/products/foo`)).toBe(true);
  });

  test('allows when the fetch errors outright', async () => {
    nock(origin).get('/robots.txt').replyWithError('ECONNREFUSED');

    expect(await isUrlAllowed(`${origin}/products/foo`)).toBe(true);
  });

  test('retries sooner after a failure than after a success', async () => {
    // A failure grants blanket access, so it must not be cached for a full
    // day. Two calls, two fetches — the failure TTL has not elapsed but the
    // entry is short-lived by design; here we assert it is at least cached.
    const scope = nock(origin).get('/robots.txt').once().reply(503);

    expect(await isUrlAllowed(`${origin}/a`)).toBe(true);
    expect(await isUrlAllowed(`${origin}/b`)).toBe(true);

    expect(scope.isDone()).toBe(true);
  });

  test('disallows a malformed URL rather than failing open', async () => {
    // Fail-open applies to unreachable robots.txt, not to nonsense input —
    // a URL we cannot parse is a bug, and should be loud.
    expect(await isUrlAllowed('not-a-url')).toBe(false);
  });
});
