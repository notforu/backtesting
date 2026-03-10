/**
 * Unit tests for content-hash utilities.
 *
 * Covers:
 *   - sortKeysDeep: recursive key sorting, array preservation, null/undefined handling
 *   - computeStrategyConfigHash: determinism, sensitivity to each field, key-order independence
 *   - computeAggregationConfigHash: determinism, order-independent strategy IDs, field sensitivity
 */

import { describe, it, expect } from 'vitest';
import {
  sortKeysDeep,
  computeStrategyConfigHash,
  computeAggregationConfigHash,
} from '../content-hash.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEX_SHA256_RE = /^[0-9a-f]{64}$/;

function baseStrategyConfig() {
  return {
    strategyName: 'funding-rate-v2',
    symbol: 'BTC/USDT',
    timeframe: '4h',
    params: { threshold: 0.01, lookback: 24 },
  };
}

function baseAggregationConfig() {
  return {
    allocationMode: 'top_n',
    maxPositions: 3,
    strategyConfigIds: ['abc123', 'def456', 'ghi789'],
  };
}

// ---------------------------------------------------------------------------
// sortKeysDeep
// ---------------------------------------------------------------------------

describe('sortKeysDeep', () => {
  it('sorts object keys alphabetically', () => {
    const result = sortKeysDeep({ b: 1, a: 2 });
    expect(result).toEqual({ a: 2, b: 1 });
    // Verify key order is actually sorted (JSON.stringify depends on insertion order)
    expect(Object.keys(result as object)).toEqual(['a', 'b']);
  });

  it('deeply sorts nested object keys', () => {
    const input = { z: { b: 1, a: 2 }, a: 1 };
    const result = sortKeysDeep(input);
    expect(result).toEqual({ a: 1, z: { a: 2, b: 1 } });
    expect(Object.keys(result as object)).toEqual(['a', 'z']);
    expect(Object.keys((result as Record<string, unknown>).z as object)).toEqual(['a', 'b']);
  });

  it('preserves array element order (arrays are NOT sorted)', () => {
    const result = sortKeysDeep([3, 1, 2]);
    expect(result).toEqual([3, 1, 2]);
  });

  it('sorts keys inside array elements', () => {
    const result = sortKeysDeep([{ b: 1, a: 2 }]);
    const arr = result as Record<string, unknown>[];
    expect(arr[0]).toEqual({ a: 2, b: 1 });
    expect(Object.keys(arr[0])).toEqual(['a', 'b']);
  });

  it('handles null at the top level by returning an empty object', () => {
    expect(sortKeysDeep(null)).toEqual({});
  });

  it('handles undefined at the top level by returning an empty object', () => {
    expect(sortKeysDeep(undefined)).toEqual({});
  });

  it('handles an empty object and returns an empty object', () => {
    expect(sortKeysDeep({})).toEqual({});
  });

  it('returns a number primitive as-is', () => {
    expect(sortKeysDeep(42)).toBe(42);
  });

  it('returns a string primitive as-is', () => {
    expect(sortKeysDeep('hello')).toBe('hello');
  });

  it('returns a boolean primitive as-is', () => {
    expect(sortKeysDeep(true)).toBe(true);
    expect(sortKeysDeep(false)).toBe(false);
  });

  it('handles deeply nested structures (3+ levels)', () => {
    const input = {
      z: { b: { delta: 3, alpha: 1 }, a: 99 },
      a: { y: 2, x: 1 },
    };
    const result = sortKeysDeep(input) as Record<string, unknown>;
    // Top-level keys
    expect(Object.keys(result)).toEqual(['a', 'z']);
    // Second level under 'a'
    expect(Object.keys(result.a as object)).toEqual(['x', 'y']);
    // Second level under 'z'
    expect(Object.keys(result.z as object)).toEqual(['a', 'b']);
    // Third level under 'z.b'
    const zb = (result.z as Record<string, unknown>).b as object;
    expect(Object.keys(zb)).toEqual(['alpha', 'delta']);
    expect(result).toEqual({
      a: { x: 1, y: 2 },
      z: { a: 99, b: { alpha: 1, delta: 3 } },
    });
  });
});

// ---------------------------------------------------------------------------
// computeStrategyConfigHash
// ---------------------------------------------------------------------------

describe('computeStrategyConfigHash', () => {
  it('is deterministic: same input always produces the same hash', () => {
    const cfg = baseStrategyConfig();
    expect(computeStrategyConfigHash(cfg)).toBe(computeStrategyConfigHash(cfg));
    // Call a second time with a fresh object to rule out caching
    expect(computeStrategyConfigHash(baseStrategyConfig())).toBe(
      computeStrategyConfigHash(baseStrategyConfig()),
    );
  });

  it('produces different hashes for different params', () => {
    const h1 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { threshold: 0.01 },
    });
    const h2 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { threshold: 0.99 },
    });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different strategy names', () => {
    const h1 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      strategyName: 'strategy-a',
    });
    const h2 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      strategyName: 'strategy-b',
    });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different symbols', () => {
    const h1 = computeStrategyConfigHash({ ...baseStrategyConfig(), symbol: 'BTC/USDT' });
    const h2 = computeStrategyConfigHash({ ...baseStrategyConfig(), symbol: 'ETH/USDT' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different timeframes', () => {
    const h1 = computeStrategyConfigHash({ ...baseStrategyConfig(), timeframe: '4h' });
    const h2 = computeStrategyConfigHash({ ...baseStrategyConfig(), timeframe: '1d' });
    expect(h1).not.toBe(h2);
  });

  it('is key-order independent: {a:1, b:2} params == {b:2, a:1} params', () => {
    const h1 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { a: 1, b: 2 },
    });
    const h2 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { b: 2, a: 1 },
    });
    expect(h1).toBe(h2);
  });

  it('handles empty params {} and produces a valid hash', () => {
    const hash = computeStrategyConfigHash({ ...baseStrategyConfig(), params: {} });
    expect(hash).toMatch(HEX_SHA256_RE);
  });

  it('handles nested params and is order-independent at nested level', () => {
    const h1 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { nested: { b: 1, a: 2 } },
    });
    const h2 = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: { nested: { a: 2, b: 1 } },
    });
    expect(h1).toBe(h2);
  });

  it('returns a valid 64-character lowercase hex SHA256 string', () => {
    const hash = computeStrategyConfigHash(baseStrategyConfig());
    expect(hash).toMatch(HEX_SHA256_RE);
  });

  it('treats null params same as empty params {}', () => {
    const hashEmpty = computeStrategyConfigHash({ ...baseStrategyConfig(), params: {} });
    // Pass null cast to unknown to simulate callers that pass null
    const hashNull = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: null as unknown as Record<string, unknown>,
    });
    expect(hashNull).toBe(hashEmpty);
  });

  it('treats undefined params same as empty params {}', () => {
    const hashEmpty = computeStrategyConfigHash({ ...baseStrategyConfig(), params: {} });
    const hashUndefined = computeStrategyConfigHash({
      ...baseStrategyConfig(),
      params: undefined as unknown as Record<string, unknown>,
    });
    expect(hashUndefined).toBe(hashEmpty);
  });
});

// ---------------------------------------------------------------------------
// computeAggregationConfigHash
// ---------------------------------------------------------------------------

describe('computeAggregationConfigHash', () => {
  it('is deterministic: same input always produces the same hash', () => {
    const cfg = baseAggregationConfig();
    expect(computeAggregationConfigHash(cfg)).toBe(computeAggregationConfigHash(cfg));
    expect(computeAggregationConfigHash(baseAggregationConfig())).toBe(
      computeAggregationConfigHash(baseAggregationConfig()),
    );
  });

  it('strategy config IDs are order-independent: [a,b] == [b,a]', () => {
    const h1 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: ['a', 'b', 'c'],
    });
    const h2 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: ['c', 'a', 'b'],
    });
    const h3 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: ['b', 'c', 'a'],
    });
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
  });

  it('produces different hashes for different allocation modes', () => {
    const h1 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      allocationMode: 'top_n',
    });
    const h2 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      allocationMode: 'equal_weight',
    });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different maxPositions values', () => {
    const h1 = computeAggregationConfigHash({ ...baseAggregationConfig(), maxPositions: 1 });
    const h2 = computeAggregationConfigHash({ ...baseAggregationConfig(), maxPositions: 5 });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different strategy config IDs', () => {
    const h1 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: ['id-1', 'id-2'],
    });
    const h2 = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: ['id-1', 'id-3'],
    });
    expect(h1).not.toBe(h2);
  });

  it('handles empty strategyConfigIds and produces a valid hash', () => {
    const hash = computeAggregationConfigHash({
      ...baseAggregationConfig(),
      strategyConfigIds: [],
    });
    expect(hash).toMatch(HEX_SHA256_RE);
  });

  it('returns a valid 64-character lowercase hex SHA256 string', () => {
    const hash = computeAggregationConfigHash(baseAggregationConfig());
    expect(hash).toMatch(HEX_SHA256_RE);
  });
});
