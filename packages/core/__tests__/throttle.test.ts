import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { resetThrottleState, throttleDomain } from '../src/throttle';

describe('throttleDomain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetThrottleState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resolves immediately on the first call for a domain', async () => {
    const promise = throttleDomain('example.com', 10_000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });

  test('waits out the remainder of minIntervalMs on a second call', async () => {
    await throttleDomain('example.com', 10_000);

    vi.advanceTimersByTime(4_000);

    let resolved = false;
    const promise = throttleDomain('example.com', 10_000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(5_999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(resolved).toBe(true);
  });

  test('does not wait if minIntervalMs has already elapsed', async () => {
    await throttleDomain('example.com', 10_000);

    vi.advanceTimersByTime(10_000);

    let resolved = false;
    const promise = throttleDomain('example.com', 10_000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    await promise;
  });

  test('tracks each domain independently', async () => {
    await throttleDomain('a.com', 10_000);

    let resolved = false;
    const promise = throttleDomain('b.com', 10_000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    await promise;
  });
});
