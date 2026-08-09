import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import got from 'got';
import { JsonLdParseError, parseProductJsonLd } from '../jsonld';
import type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from '../types';

const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref'];

const DEFAULT_CURRENCY = 'EUR';

/**
 * WooCommerce's default product template markup. These are theme-overridable,
 * which is exactly why they are the fallback rather than the primary source —
 * a retheme silently changes them, whereas JSON-LD is emitted by WooCommerce
 * core.
 */
const SELECTORS = {
  /** Wrapper carrying `product` plus the `outofstock`/`instock` class. */
  product: '.product',
  /** WooCommerce prints `<p class="stock in-stock">` / `out-of-stock`. */
  stock: 'p.stock',
  /** The purchase form is absent on a sold-out simple product. */
  addToCart: 'form.cart button[name="add-to-cart"], form.cart button.single_add_to_cart_button',
  /**
   * The rendered amount, e.g. `<bdi><span …currencySymbol>€</span> 24,99</bdi>`.
   * Not scoped to `.summary`: themes rename that wrapper (the captured store
   * uses `p.price.nasa-single-product-price`), so the first amount on the page
   * is the more robust target. Some themes also expose `<meta itemprop>` price
   * fields, but the captured store emits none — hence the text parse.
   */
  priceAmount: 'p.price .woocommerce-Price-amount, span.price .woocommerce-Price-amount',
  currencySymbol: '.woocommerce-Price-currencySymbol',
  title: 'h1.product_title',
} as const;

/** ISO codes for the currency symbols WooCommerce renders in this project's markets. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  '€': 'EUR',
  '$': 'USD',
  '£': 'GBP',
};

export class WooCommerceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WooCommerceParseError';
  }
}

/**
 * Read a price out of WooCommerce's rendered amount, e.g. `€184,95` or
 * `$1,234.56`. The last `.` or `,` is the decimal separator; every other
 * separator is a thousands grouping.
 */
export function parseWooPrice(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!digits) return null;

  const lastSeparator = Math.max(digits.lastIndexOf('.'), digits.lastIndexOf(','));
  const normalized =
    lastSeparator === -1
      ? digits
      : `${digits.slice(0, lastSeparator).replace(/[.,]/g, '')}.${digits.slice(lastSeparator + 1)}`;

  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCurrency($: CheerioAPI): string {
  const symbol = $(SELECTORS.priceAmount)
    .first()
    .find(SELECTORS.currencySymbol)
    .text()
    .trim();

  return CURRENCY_SYMBOLS[symbol] ?? DEFAULT_CURRENCY;
}

function parsePrice($: CheerioAPI): number | null {
  const amount = $(SELECTORS.priceAmount).first().text().trim();
  return amount ? parseWooPrice(amount) : null;
}

/**
 * Determine availability from WooCommerce's default template markup.
 *
 * Three independent signals, in descending order of reliability. Each is
 * either conclusive or absent — we never infer "out of stock" from a missing
 * signal, because a missing signal means the page didn't parse, and reporting
 * that as sold-out is the exact failure mode of #86 and #88.
 */
function parseAvailabilityFromHtml($: CheerioAPI): { inStock: boolean; availability: string } {
  const product = $(SELECTORS.product).first();
  const stock = $(SELECTORS.stock).first();

  // The store's own wording ("Uitverkocht", "Op voorraad") is more useful in a
  // notification than a generic label, so it is preferred whenever present —
  // but only for the text. The state itself comes from whichever signal is
  // most authoritative below.
  const stockText = stock.text().trim();

  // 1. The wrapper's stock class — set by WooCommerce core, not the theme.
  if (product.hasClass('outofstock')) {
    return { inStock: false, availability: stockText || 'Out of stock' };
  }
  if (product.hasClass('instock')) {
    return { inStock: true, availability: stockText || 'In stock' };
  }

  // 2. The stock paragraph, whose own class carries the state explicitly.
  if (stock.hasClass('out-of-stock')) {
    return { inStock: false, availability: stockText || 'Out of stock' };
  }
  if (stock.hasClass('in-stock')) {
    return { inStock: true, availability: stockText || 'In stock' };
  }

  // 3. Presence of the add-to-cart form. Weakest of the three — a variable
  // product renders it while every variation is sold out — so it can only
  // confirm availability, never deny it.
  if ($(SELECTORS.addToCart).length > 0) {
    return { inStock: true, availability: 'In stock' };
  }

  throw new WooCommerceParseError(
    'no WooCommerce stock signal found (no stock class, stock paragraph, or add-to-cart form)',
  );
}

/**
 * Adapter for WooCommerce storefronts.
 *
 * Data-source tier 3 (HTML scraping) per plan §5's priority order, and the
 * reason is specific rather than incidental: WooCommerce's REST API at
 * `/wp-json/wc/v3/` requires a consumer key/secret per store, which a
 * read-only monitor has no way to obtain, and there is no unauthenticated
 * JSON product endpoint equivalent to Shopify's `/products/{handle}.js`
 * (#88). Public product pages are what's actually available.
 *
 * Within the page, JSON-LD comes first: WooCommerce core emits a schema.org
 * `Product` block with an `availability` offer, and that markup survives
 * retheming in a way CSS selectors do not. `SELECTORS` is the fallback for
 * stores that have disabled structured data.
 *
 * Like every adapter here, an unparseable page yields an `ERROR:`-prefixed
 * result rather than `inStock: false` — a silent false negative is
 * indistinguishable from a genuine sell-out (#86).
 *
 * Multi-domain, like `shopify-generic`: `config.baseUrl` is documentation
 * only, and callers throttle on the product URL's host.
 */
export class WooCommerceAdapter implements StoreAdapter {
  config: AdapterConfig = {
    storeKey: 'woocommerce',
    storeName: 'WooCommerce (generic)',
    // Placeholder: this adapter serves many storefronts and always fetches
    // the product URL it is given.
    baseUrl: 'https://woocommerce.example',
    productUrlPattern: 'https://{domain}/product/{slug}',
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
      const response = await got(url, {
        timeout: { request: options?.timeoutMs ?? this.config.defaultTimeoutMs },
        headers: {
          'User-Agent': options?.userAgent ?? 'Mozilla/5.0 (personal stock monitor)',
          ...(options?.customHeaders ?? this.config.customHeaders),
        },
        followRedirect: true,
      });

      const $ = cheerio.load(response.body);

      try {
        const product = parseProductJsonLd($);
        return {
          inStock: product.inStock,
          price: product.price,
          currency: product.currency,
          title: product.name,
          availability: product.availability,
          checkedAt,
        };
      } catch (err) {
        // Only *absent* Product markup justifies dropping to selectors. If the
        // page carries JSON-LD we couldn't read, that is a definite unknown —
        // letting a weaker selector guess overwrite it is how a broken adapter
        // starts reporting confident wrong answers (#86, #88).
        if (!(err instanceof JsonLdParseError) || err.kind !== 'absent') throw err;
      }

      const { inStock, availability } = parseAvailabilityFromHtml($);

      return {
        inStock,
        price: parsePrice($),
        currency: parseCurrency($),
        title: $(SELECTORS.title).first().text().trim() || undefined,
        availability,
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
    // Multi-domain adapter: no single storefront to probe, so this reports the
    // adapter's own readiness rather than any store's reachability.
    return true;
  }

  getAddToCartUrl(_productUrl: string): string | null {
    return null;
  }
}
