import type { AdapterConfig } from './types';

/**
 * Per-store overrides stored in the `AdapterConfig` DB table's `config` JSON
 * column (#30). Only the keys callers can actually apply today are recognized;
 * anything else in the blob (selectors, API keys, ...) is stored untouched for
 * future adapter-specific use but has no effect yet.
 *
 * This module never touches the database — callers load the row and pass the
 * raw JSON in, keeping adapters free of `packages/db` imports.
 */
export interface AdapterOverrides {
  minIntervalMs?: number;
  defaultTimeoutMs?: number;
  customHeaders?: Record<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validate a candidate override blob before persisting it. Returns
 * human-readable problems; an empty list means valid. Unknown keys are
 * allowed on purpose — the blob doubles as storage for adapter-specific
 * config the recognized set doesn't cover yet.
 */
export function validateAdapterOverrides(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return ['config must be a JSON object'];
  }

  const problems: string[] = [];

  for (const key of ['minIntervalMs', 'defaultTimeoutMs'] as const) {
    if (value[key] !== undefined && !isNonNegativeNumber(value[key])) {
      problems.push(`${key} must be a non-negative number`);
    }
  }

  const headers = value.customHeaders;
  if (headers !== undefined) {
    if (!isPlainObject(headers)) {
      problems.push('customHeaders must be an object of string values');
    } else if (Object.values(headers).some((v) => typeof v !== 'string')) {
      problems.push('customHeaders values must all be strings');
    }
  }

  return problems;
}

/**
 * Extract the recognized overrides from a stored config blob. Lenient on
 * purpose: rows can predate validation or be edited directly in the DB, and a
 * malformed value must degrade to adapter defaults, never break a check cycle.
 */
export function parseAdapterOverrides(value: unknown): AdapterOverrides {
  if (!isPlainObject(value)) return {};

  const overrides: AdapterOverrides = {};

  if (isNonNegativeNumber(value.minIntervalMs)) {
    overrides.minIntervalMs = value.minIntervalMs;
  }
  if (isNonNegativeNumber(value.defaultTimeoutMs)) {
    overrides.defaultTimeoutMs = value.defaultTimeoutMs;
  }
  if (isPlainObject(value.customHeaders)) {
    const entries = Object.entries(value.customHeaders).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (entries.length > 0) {
      overrides.customHeaders = Object.fromEntries(entries);
    }
  }

  return overrides;
}

/**
 * Merge a store's overrides over an adapter's built-in config. Headers merge
 * per-key so a store can add one header without restating the adapter's
 * defaults.
 */
export function resolveAdapterConfig(base: AdapterConfig, overrides: unknown): AdapterConfig {
  const parsed = parseAdapterOverrides(overrides);

  const customHeaders =
    base.customHeaders || parsed.customHeaders
      ? { ...base.customHeaders, ...parsed.customHeaders }
      : undefined;

  return {
    ...base,
    minIntervalMs: parsed.minIntervalMs ?? base.minIntervalMs,
    defaultTimeoutMs: parsed.defaultTimeoutMs ?? base.defaultTimeoutMs,
    customHeaders,
  };
}
