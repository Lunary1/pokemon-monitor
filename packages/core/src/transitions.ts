import type { StockEventType } from '@pokemon-monitor/db';

/**
 * An adapter error result is not a real stock-state change — its
 * `availability` string is prefixed `ERROR:` per the StoreAdapter contract.
 * Treating it as a transition would fire a false OUT_OF_STOCK.
 */
export function isErrorResult(availability: string | null | undefined): boolean {
  return typeof availability === 'string' && availability.startsWith('ERROR:');
}

/**
 * Determine the StockEvent to write (if any) given the previous and current
 * in-stock state. Returns null when there is no prior check (nothing to
 * transition from) or when state didn't change.
 */
export function detectTransition(
  previousInStock: boolean | null,
  currentInStock: boolean,
): StockEventType | null {
  if (previousInStock === null) return null;
  if (previousInStock === currentInStock) return null;
  return currentInStock ? 'RESTOCK' : 'OUT_OF_STOCK';
}
