import { DreamlandAdapter } from './adapters/dreamland';
import { ShopifyGenericAdapter } from './adapters/shopify-generic';
import { ToyChampAdapter } from './adapters/toychamp';
import type { StoreAdapter } from './types';

export { DreamlandAdapter } from './adapters/dreamland';
export {
  ShopifyGenericAdapter,
  ShopifyProductUrlError,
  extractShopifyHandle,
} from './adapters/shopify-generic';
export { ToyChampAdapter } from './adapters/toychamp';

export type {
  AdapterConfig,
  CheckOptions,
  StockResult,
  StoreAdapter,
} from './types';

const adapters: Record<string, StoreAdapter> = {
  toychamp: new ToyChampAdapter(),
  dreamland: new DreamlandAdapter(),
  'shopify-generic': new ShopifyGenericAdapter(),
};

export function getAdapter(key: string): StoreAdapter | undefined {
  return adapters[key];
}
