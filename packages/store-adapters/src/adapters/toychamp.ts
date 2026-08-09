import { DreamlandAdapter } from './dreamland';

/**
 * @deprecated ToyChamp and Dreamland have merged — `toychamp.be` product URLs
 * 301-redirect cross-host to `dreamland.be`, which serves the page (channel
 * `DREV`, "Web Shop Dreamland Vlaanderen"). There is no longer a distinct
 * ToyChamp storefront to adapt.
 *
 * Retained as an alias so existing imports and any `Store` row with
 * `adapterKey: 'toychamp'` keep working. Prefer `DreamlandAdapter` directly.
 * See #86.
 */
export const ToyChampAdapter = DreamlandAdapter;
export type ToyChampAdapter = DreamlandAdapter;
