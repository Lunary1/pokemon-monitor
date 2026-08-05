export interface StockResult {
  inStock: boolean;
  price: number | null;
  currency: string;
  title?: string; // product title as seen on page (for validation)
  availability?: string; // raw availability string (e.g. "Op voorraad")
  rawHtml?: string; // optional: raw snippet around the stock element
  checkedAt: Date;
}

export interface CheckOptions {
  timeoutMs?: number; // default: 10_000
  userAgent?: string; // default: set per adapter
}

export interface AdapterConfig {
  storeKey: string; // unique key, e.g. "toychamp"
  storeName: string; // "ToyChamp"
  baseUrl: string; // "https://www.toychamp.be"
  productUrlPattern: string; // "https://www.toychamp.be/products/{slug}"
  minIntervalMs: number; // minimum ms between requests to this domain
  defaultTimeoutMs: number;
  respectRobotsTxt: boolean;
  customHeaders?: Record<string, string>;
}

export interface StoreAdapter {
  config: AdapterConfig;

  /**
   * Normalize a raw product URL to the canonical form for this store.
   * Strips tracking params, ensures HTTPS, etc.
   */
  normalizeUrl(url: string): string;

  /**
   * Check stock and price for a single product URL.
   * Should NOT throw — return an error result instead.
   */
  checkProduct(url: string, options?: CheckOptions): Promise<StockResult>;

  /**
   * Optional: search the store for a product by keyword.
   * Returns candidate URLs.
   */
  searchProducts?(query: string): Promise<string[]>;

  /**
   * Return the add-to-cart URL or null if not supported / not allowed.
   */
  getAddToCartUrl?(productUrl: string): string | null;

  /**
   * Health check: fetch the store homepage and return true if reachable.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Self-test: check a known in-stock product and a known out-of-stock product.
   * Used in regression tests.
   */
  selfTest?(): Promise<{ pass: boolean; notes: string }>;
}
