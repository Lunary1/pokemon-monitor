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
  price?: string | number;
}

interface ShopifyProductResponse {
  product?: {
    title?: string;
    variants?: ShopifyVariant[];
  };
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
 * that already points at the .json endpoint.
 */
export function extractShopifyHandle(url: string): string {
  const { pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  const productsIndex = segments.lastIndexOf('products');

  const handle = productsIndex === -1 ? undefined : segments[productsIndex + 1];
  if (!handle) throw new ShopifyProductUrlError(url);

  return handle.replace(/\.json$/, '');
}

/**
 * Generic adapter for any Shopify storefront, using the public
 * `/products/{handle}.json` endpoint (plan §5: always prefer this over HTML
 * scraping).
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

      const body = await got(`${origin}/products/${handle}.json`, {
        timeout: { request: options?.timeoutMs ?? this.config.defaultTimeoutMs },
        headers: {
          'User-Agent': options?.userAgent ?? 'Mozilla/5.0 (personal stock monitor)',
          ...(options?.customHeaders ?? this.config.customHeaders),
        },
        followRedirect: true,
      }).json<ShopifyProductResponse>();

      const product = body?.product;
      if (!product) {
        throw new Error('response did not contain a product object');
      }

      const variants = product.variants ?? [];
      if (variants.length === 0) {
        throw new Error('product has no variants');
      }

      // Prefer an available variant so a product with any purchasable variant
      // reads as in stock; fall back to the first so price still reports when
      // everything is sold out.
      const variant = variants.find((candidate) => candidate.available) ?? variants[0];

      const parsedPrice =
        variant.price === undefined ? NaN : parseFloat(String(variant.price));

      return {
        inStock: variant.available === true,
        price: Number.isNaN(parsedPrice) ? null : parsedPrice,
        currency: DEFAULT_CURRENCY,
        title: product.title,
        availability: variant.available === true ? 'In stock' : 'Out of stock',
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
