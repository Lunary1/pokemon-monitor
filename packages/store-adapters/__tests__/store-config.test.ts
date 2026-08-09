import { describe, expect, test } from 'vitest';
import {
  parseAdapterOverrides,
  resolveAdapterConfig,
  validateAdapterOverrides,
} from '../src/store-config';
import type { AdapterConfig } from '../src/types';

const base: AdapterConfig = {
  storeKey: 'dreamland',
  storeName: 'Dreamland',
  baseUrl: 'https://www.dreamland.be',
  productUrlPattern: 'https://www.dreamland.be/{path}',
  minIntervalMs: 10_000,
  defaultTimeoutMs: 12_000,
  respectRobotsTxt: true,
  customHeaders: { 'Accept-Language': 'nl-BE,nl;q=0.9' },
};

describe('resolveAdapterConfig', () => {
  test('returns adapter defaults when the store has no overrides', () => {
    expect(resolveAdapterConfig(base, undefined)).toEqual(base);
    expect(resolveAdapterConfig(base, null)).toEqual(base);
    expect(resolveAdapterConfig(base, {})).toEqual(base);
  });

  test('applies recognized numeric overrides', () => {
    const resolved = resolveAdapterConfig(base, {
      minIntervalMs: 30_000,
      defaultTimeoutMs: 5_000,
    });

    expect(resolved.minIntervalMs).toBe(30_000);
    expect(resolved.defaultTimeoutMs).toBe(5_000);
    // Everything else stays the adapter's own.
    expect(resolved.storeKey).toBe('dreamland');
    expect(resolved.baseUrl).toBe(base.baseUrl);
  });

  test('merges customHeaders per-key over the adapter defaults', () => {
    const resolved = resolveAdapterConfig(base, {
      customHeaders: { 'X-Api-Key': 'secret', 'Accept-Language': 'fr-BE' },
    });

    expect(resolved.customHeaders).toEqual({
      'Accept-Language': 'fr-BE',
      'X-Api-Key': 'secret',
    });
  });

  test('a malformed blob degrades to adapter defaults instead of breaking', () => {
    expect(resolveAdapterConfig(base, 'not an object')).toEqual(base);
    expect(resolveAdapterConfig(base, [1, 2, 3])).toEqual(base);
    expect(
      resolveAdapterConfig(base, { minIntervalMs: 'fast', customHeaders: 42 }),
    ).toEqual(base);
  });

  test('does not mutate the adapter base config', () => {
    resolveAdapterConfig(base, { minIntervalMs: 1, customHeaders: { A: 'b' } });

    expect(base.minIntervalMs).toBe(10_000);
    expect(base.customHeaders).toEqual({ 'Accept-Language': 'nl-BE,nl;q=0.9' });
  });
});

describe('parseAdapterOverrides', () => {
  test('extracts only validly-typed recognized keys', () => {
    expect(
      parseAdapterOverrides({
        minIntervalMs: 15_000,
        defaultTimeoutMs: -1, // invalid: negative
        customHeaders: { good: 'yes', bad: 7 },
        selectors: { price: '.price' }, // unrecognized: ignored here, kept in storage
      }),
    ).toEqual({
      minIntervalMs: 15_000,
      customHeaders: { good: 'yes' },
    });
  });

  test('returns empty overrides for non-object input', () => {
    expect(parseAdapterOverrides(null)).toEqual({});
    expect(parseAdapterOverrides('{}')).toEqual({});
  });
});

describe('validateAdapterOverrides', () => {
  test('accepts a valid blob, including unrecognized adapter-specific keys', () => {
    expect(
      validateAdapterOverrides({
        minIntervalMs: 30_000,
        customHeaders: { 'X-Api-Key': 'secret' },
        selectors: { price: '.price' },
        apiKey: 'abc',
      }),
    ).toEqual([]);
  });

  test('rejects non-object blobs', () => {
    expect(validateAdapterOverrides([1])).toEqual(['config must be a JSON object']);
    expect(validateAdapterOverrides('x')).toEqual(['config must be a JSON object']);
    expect(validateAdapterOverrides(null)).toEqual(['config must be a JSON object']);
  });

  test('names every invalid recognized key', () => {
    const problems = validateAdapterOverrides({
      minIntervalMs: 'fast',
      defaultTimeoutMs: -5,
      customHeaders: { ok: 'yes', broken: 1 },
    });

    expect(problems).toContain('minIntervalMs must be a non-negative number');
    expect(problems).toContain('defaultTimeoutMs must be a non-negative number');
    expect(problems).toContain('customHeaders values must all be strings');
  });

  test('rejects a non-object customHeaders', () => {
    expect(validateAdapterOverrides({ customHeaders: ['a'] })).toEqual([
      'customHeaders must be an object of string values',
    ]);
  });
});
