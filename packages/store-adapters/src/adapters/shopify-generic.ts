import got from 'got';
import type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from '../types';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'variant'];

const DEFAULT_CURRENCY = 'EUR';

interface ShopifyVariant {
  available?: boolean;
  price?: number;
}

/**
 * Shape of `/products/{handle}.js`. Unlike the `.json` detail endpoint, this
 * one carries `available` — see the class doc and #88.
 */
interface ShopifyJsProduct {
  title?: string;
  variants?: ShopifyVariant[];
}

/**
 * `.js` reports prices as integer minor units (18495 = €184.95). A price we
 * cannot read is reported as null rather than guessed — unlike availability it
 * isn't load-bearing for restock detection, so it doesn't warrant an error
 * result.
 */
function parsePrice(price: number | undefined): number | null {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  return price / 100;
}

export class ShopifyProductUrlError extends Error {
  constructor(url: string) {
    super(`Not a Shopify product URL (no /products/{handle} segment): ${url}`);
    this.name = 'ShopifyProductUrlError';
  }
}

/**
 * Pull the product handle out of a Shopify storefront URL.
 *
 * Handles the shapes Shopify actually serves: a bare product URL, one nested
 * under a collection, one with a trailing segment or query string, and one
 * that already points at an endpoint suffix (`.json` or `.js`).
 */
export function extractShopifyHandle(url: string): string {
  const { pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  const productsIndex = segments.lastIndexOf('products');

  const handle = productsIndex === -1 ? undefined : segments[productsIndex + 1];
  if (!handle) throw new ShopifyProductUrlError(url);

  return handle.replace(/\.(json|js)$/, '');
}

/**
 * Generic adapter for any Shopify storefront, using the public
 * `/products/{handle}.js` endpoint (plan §5: always prefer a JSON endpoint
 * over HTML scraping).
 *
 * `.js` rather than the more obvious `.json`: the `.json` detail endpoint
 * omits `available` entirely (verified on three independent storefronts),
 * which made every product read as out of stock (#88). Two consequences of
 * that endpoint choice, both handled below:
 *
 * - prices are integer minor units (18495 = €184.95), not decimal strings;
 * - there is no currency field, so `DEFAULT_CURRENCY` stands.
 *
 * Unlike the single-store adapters, this one serves many domains, so the
 * request origin comes from the product URL rather than `config.baseUrl` —
 * that field is documentation-only here.
 */
export class ShopifyGenericAdapter implements StoreAdapter {
  config: AdapterConfig = {
    storeKey: 'shopify-generic',
    storeName: 'Shopify (generic)',
    // Placeholder: this adapter is multi-domain and always derives the real
    // origin from the product URL. Callers throttle on the product URL's
    // host, not on this value.
    baseUrl: 'https://shopify.example',
    productUrlPattern: 'https://{domain}/products/{handle}',
    minIntervalMs: 10_000,
    defaultTimeoutMs: 12_000,
    respectRobotsTxt: true,
  };

  normalizeUrl(url: string): string {
    const u = new URL(url);
    TRACKING_PARAMS.forEach((param) => u.searchParams.delete(param));
    return u.toString();
  }

  async checkProduct(url: string, options?: CheckOptions): Promise<StockResult> {
    const checkedAt = new Date();

    try {
      const { origin } = new URL(url);
      const handle = extractShopifyHandle(url);

      const product = await got(`${origin}/products/${handle}.js`, {
        timeout: { request: options?.timeoutMs ?? this.config.defaultTimeoutMs },
        headers: {
          'User-Agent': options?.userAgent ?? 'Mozilla/5.0 (personal stock monitor)',
          ...(options?.customHeaders ?? this.config.customHeaders),
        },
        followRedirect: true,
      }).json<ShopifyJsProduct>();

      const variants = product?.variants ?? [];
      if (variants.length === 0) {
        throw new Error('product has no variants');
      }

      // Prefer an available variant so a product with any purchasable variant
      // reads as in stock; fall back to the first so price still reports when
      // everything is sold out.
      const variant = variants.find((candidate) => candidate.available === true) ?? variants[0];

      // The invariant from #86, applied here: availability we cannot read is an
      // error, never a silent `inStock: false`. Reporting a missing field as
      // out-of-stock is indistinguishable from a genuine sell-out, which is the
      // exact bug this adapter shipped with (#88).
      if (typeof variant.available !== 'boolean') {
        throw new Error(
          'variant has no boolean availability field (is this the .json detail endpoint?)',
        );
      }

      return {
        inStock: variant.available,
        price: parsePrice(variant.price),
        currency: DEFAULT_CURRENCY,
        title: product.title,
        availability: variant.available ? 'In stock' : 'Out of stock',
        checkedAt,
      };
    } catch (err) {
      return {
        inStock: false,
        price: null,
        currency: DEFAULT_CURRENCY,
        availability: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    // Multi-domain adapter: there is no single storefront to probe, so this
    // reports reachability of the adapter itself rather than of any store.
    return true;
  }

  getAddToCartUrl(_productUrl: string): string | null {
    return null;
  }
}
