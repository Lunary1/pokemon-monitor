import { describe, expect, test } from 'vitest';
import { detectTransition, isErrorResult } from '../src/transitions';

describe('isErrorResult', () => {
  test('detects ERROR:-prefixed availability strings', () => {
    expect(isErrorResult('ERROR: Connection timeout')).toBe(true);
  });

  test('treats normal availability strings as non-error', () => {
    expect(isErrorResult('Op voorraad')).toBe(false);
  });

  test('treats missing availability as non-error', () => {
    expect(isErrorResult(null)).toBe(false);
    expect(isErrorResult(undefined)).toBe(false);
  });
});

describe('detectTransition', () => {
  test('returns null when there is no prior check', () => {
    expect(detectTransition(null, true)).toBeNull();
    expect(detectTransition(null, false)).toBeNull();
  });

  test('returns null when state did not change', () => {
    expect(detectTransition(true, true)).toBeNull();
    expect(detectTransition(false, false)).toBeNull();
  });

  test('returns RESTOCK on false -> true', () => {
    expect(detectTransition(false, true)).toBe('RESTOCK');
  });

  test('returns OUT_OF_STOCK on true -> false', () => {
    expect(detectTransition(true, false)).toBe('OUT_OF_STOCK');
  });
});
