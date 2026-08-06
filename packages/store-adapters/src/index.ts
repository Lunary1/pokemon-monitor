import { DreamlandAdapter } from './adapters/dreamland';
import { ShopifyGenericAdapter } from './adapters/shopify-generic';
import type { StoreAdapter } from './types';

export { DreamlandAdapter } from './adapters/dreamland';
export {
  ShopifyGenericAdapter,
  ShopifyProductUrlError,
  extractShopifyHandle,
} from './adapters/shopify-generic';
export { ToyChampAdapter } from './adapters/toychamp';
export { parseProductJsonLd, JsonLdParseError } from './jsonld';
export type { JsonLdProduct } from './jsonld';

export type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from './types';

// ToyChamp and Dreamland are one storefront now — toychamp.be redirects to
// dreamland.be (#86). Both keys resolve to the same instance so existing Store
// rows keep working without a migration.
const dreamland = new DreamlandAdapter();

const adapters: Record<string, StoreAdapter> = {
  dreamland,
  toychamp: dreamland,
  'shopify-generic': new ShopifyGenericAdapter(),
};

export function getAdapter(key: string): StoreAdapter | undefined {
  return adapters[key];
}
