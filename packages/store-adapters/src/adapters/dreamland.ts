import * as cheerio from 'cheerio';
import got from 'got';
import type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from '../types';

const SELECTORS = {
  stock: '.product-availability, .stock-status, [data-stock]',
  price: '.product-price .price, [data-price]',
} as const;

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'];

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

  async checkProduct(
    url: string,
    options?: CheckOptions,
  ): Promise<StockResult> {
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

      const $ = cheerio.load(response.body);
      const stockText = $(SELECTORS.stock).first().text().trim();
      const priceText = $(SELECTORS.price).first().text().trim();

      const inStock =
        /op voorraad|in stock|beschikbaar/i.test(stockText) &&
        !/niet beschikbaar|uitverkocht|out of stock/i.test(stockText);

      const price =
        parseFloat(priceText.replace(/[^0-9,]/g, '').replace(',', '.')) ||
        null;

      return {
        inStock,
        price,
        currency: 'EUR',
        availability: stockText,
        checkedAt,
      };
    } catch (err) {
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
