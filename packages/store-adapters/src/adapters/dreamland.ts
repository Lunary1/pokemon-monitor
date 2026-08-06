import * as cheerio from 'cheerio';
import got from 'got';
import { parseProductJsonLd } from '../jsonld';
import type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from '../types';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'];

/**
 * Adapter for the Dreamland storefront.
 *
 * Also serves ToyChamp: `toychamp.be` product URLs 301-redirect cross-host to
 * `dreamland.be` (the page reports channel `DREV`, "Web Shop Dreamland
 * Vlaanderen") — the chains have merged. This class is registered under both
 * the `dreamland` and `toychamp` keys so existing Store rows keep resolving.
 *
 * Stock and price come from the page's JSON-LD Product markup rather than CSS
 * selectors, per plan §5's data-source priority. See #86: the previous
 * selector-based implementation silently reported every product as out of
 * stock once the markup changed under it.
 */
export class DreamlandAdapter implements StoreAdapter {
  config: AdapterConfig = {
    storeKey: 'dreamland',
    storeName: 'Dreamland',
    baseUrl: 'https://www.dreamland.be',
    productUrlPattern: 'https://www.dreamland.be/{path}',
    minIntervalMs: 10_000,
    defaultTimeoutMs: 12_000,
    respectRobotsTxt: true,
    customHeaders: {
      'Accept-Language': 'nl-BE,nl;q=0.9',
    },
  };

  normalizeUrl(url: string): string {
    const u = new URL(url);
    TRACKING_PARAMS.forEach((param) => u.searchParams.delete(param));
    return u.toString();
  }

  async checkProduct(url: string, options?: CheckOptions): Promise<StockResult> {
    const checkedAt = new Date();

    try {
      const response = await got(url, {
        timeout: { request: options?.timeoutMs ?? this.config.defaultTimeoutMs },
        headers: {
          'User-Agent':
            options?.userAgent ?? 'Mozilla/5.0 (personal stock monitor)',
          ...this.config.customHeaders,
        },
        followRedirect: true,
      });

      const product = parseProductJsonLd(cheerio.load(response.body));

      return {
        inStock: product.inStock,
        price: product.price,
        currency: product.currency,
        title: product.name,
        availability: product.availability,
        checkedAt,
      };
    } catch (err) {
      // Includes JsonLdParseError: an unreadable page is reported as an error,
      // never as inStock: false. A silent false negative is indistinguishable
      // from a real out-of-stock, which is the bug this adapter had (#86).
      return {
        inStock: false,
        price: null,
        currency: 'EUR',
        availability: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await got(this.config.baseUrl, { timeout: { request: 5_000 } });
      return true;
    } catch {
      return false;
    }
  }

  getAddToCartUrl(_productUrl: string): string | null {
    return null;
  }
}
