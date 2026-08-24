import { afterEach, describe, expect, test } from 'vitest';
import { assertRequiredEnv } from '../src/env';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('assertRequiredEnv', () => {
  test('does not throw when all required vars are set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
    expect(() => assertRequiredEnv(['DATABASE_URL'])).not.toThrow();
  });

  test('throws a single clear error naming the missing var and .env.example', () => {
    delete process.env.DATABASE_URL;
    expect(() => assertRequiredEnv(['DATABASE_URL'])).toThrow(
      /Missing required environment variable: DATABASE_URL.*\.env\.example/s,
    );
  });

  test('lists all missing vars when more than one is unset', () => {
    delete process.env.DATABASE_URL;
    delete process.env.SOME_OTHER_VAR;
    expect(() => assertRequiredEnv(['DATABASE_URL', 'SOME_OTHER_VAR'])).toThrow(
      /DATABASE_URL, SOME_OTHER_VAR/,
    );
  });

  test('treats an empty string as missing', () => {
    process.env.DATABASE_URL = '';
    expect(() => assertRequiredEnv(['DATABASE_URL'])).toThrow(/DATABASE_URL/);
  });
});
