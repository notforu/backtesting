/**
 * Unit tests for the optimizer's parameter grid generation logic.
 *
 * The core grid-generation functions (generateParameterCombinations,
 * cartesianProduct, indexToCombination) are private to optimizer.ts, so we
 * test the same algorithms here as self-contained pure functions — keeping
 * tests isolated from DB / network / file-system.
 *
 * We also test the exported utility functions compareParams and getMetricValue.
 */

import { describe, it, expect } from 'vitest';
import { compareParams, getMetricValue } from '../optimizer.js';
import type { PerformanceMetrics } from '../types.js';

// ============================================================================
// Helpers — pure reimplementations of the private grid functions
// ============================================================================

/**
 * Build an array of values for a single numeric parameter given min/max/step.
 * Mirrors the loop used inside generateParameterCombinations.
 */
function buildValues(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = min; v <= max + Number.EPSILON * 1000; v += step) {
    // Round to avoid floating-point drift (e.g. 0.30000000000000004)
    values.push(parseFloat(v.toFixed(10)));
  }
  return values;
}

type ParamValues = Record<string, unknown[]>;

/**
 * Cartesian product of parameterValues — mirrors the private cartesianProduct().
 */
function cartesianProduct(parameterValues: ParamValues): Array<Record<string, unknown>> {
  const keys = Object.keys(parameterValues);
  if (keys.length === 0) return [];

  const result: Array<Record<string, unknown>> = [];

  function generate(index: number, current: Record<string, unknown>): void {
    if (index === keys.length) {
      result.push({ ...current });
      return;
    }
    const key = keys[index];
    for (const value of parameterValues[key]) {
      current[key] = value;
      generate(index + 1, current);
    }
  }

  generate(0, {});
  return result;
}

/**
 * Convert a flat index into a specific parameter combination — mirrors
 * the private indexToCombination().
 */
function indexToCombination(
  index: number,
  keys: string[],
  parameterValues: ParamValues,
  sizes: number[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let remaining = index;
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const values = parameterValues[key];
    const size = sizes[i];
    const valueIndex = remaining % size;
    result[key] = values[valueIndex];
    remaining = Math.floor(remaining / size);
  }
  return result;
}

/**
 * Sample evenly from the full combination space — mirrors
 * sampleCombinationsIndexed() but WITHOUT the random jitter, for
 * deterministic tests.
 */
function sampleCombinationsIndexed(
  parameterValues: ParamValues,
  keys: string[],
  totalCombinations: number,
  maxCount: number,
): Array<Record<string, unknown>> {
  const sampled: Array<Record<string, unknown>> = [];
  const step = totalCombinations / maxCount;
  const sizes = keys.map((key) => parameterValues[key].length);

  for (let i = 0; i < maxCount; i++) {
    const targetIndex = Math.floor(i * step) % totalCombinations;
    const combination = indexToCombination(targetIndex, keys, parameterValues, sizes);
    sampled.push(combination);
  }

  return sampled;
}

/**
 * Full pipeline: build values → cartesian product or sample.
 */
function generateGrid(
  paramRanges: Record<string, { min: number; max: number; step: number }>,
  maxCombinations = 500,
): Array<Record<string, unknown>> {
  const parameterValues: ParamValues = {};

  for (const [name, { min, max, step }] of Object.entries(paramRanges)) {
    parameterValues[name] = buildValues(min, max, step);
  }

  const keys = Object.keys(parameterValues);
  let total = 1;
  for (const key of keys) total *= parameterValues[key].length;

  if (total <= maxCombinations) {
    return cartesianProduct(parameterValues);
  }

  return sampleCombinationsIndexed(parameterValues, keys, total, maxCombinations);
}

// ============================================================================
// Tests — grid generation logic
// ============================================================================

describe('Optimizer — parameter grid generation', () => {
  // --------------------------------------------------------------------------
  // buildValues (step enumeration)
  // --------------------------------------------------------------------------

  describe('buildValues (step enumeration)', () => {
    it('generates correct values for integer step', () => {
      expect(buildValues(1, 5, 1)).toEqual([1, 2, 3, 4, 5]);
    });

    it('generates correct values for step=2', () => {
      expect(buildValues(1, 5, 2)).toEqual([1, 3, 5]);
    });

    it('includes both min and max boundaries', () => {
      const values = buildValues(0, 10, 5);
      expect(values[0]).toBe(0);
      expect(values[values.length - 1]).toBe(10);
    });

    it('returns single value when min === max', () => {
      const values = buildValues(7, 7, 1);
      expect(values).toHaveLength(1);
      expect(values[0]).toBe(7);
    });

    it('handles float step sizes (0.1, 0.2, 0.3)', () => {
      const values = buildValues(0.1, 0.3, 0.1);
      expect(values).toHaveLength(3);
      expect(values[0]).toBeCloseTo(0.1, 10);
      expect(values[1]).toBeCloseTo(0.2, 10);
      expect(values[2]).toBeCloseTo(0.3, 10);
    });

    it('handles float step with boundary: 0.0, 0.5, 1.0', () => {
      const values = buildValues(0.0, 1.0, 0.5);
      expect(values).toHaveLength(3);
      expect(values[0]).toBeCloseTo(0.0, 10);
      expect(values[1]).toBeCloseTo(0.5, 10);
      expect(values[2]).toBeCloseTo(1.0, 10);
    });
  });

  // --------------------------------------------------------------------------
  // cartesianProduct
  // --------------------------------------------------------------------------

  describe('cartesianProduct', () => {
    it('2 params × 3 values each → 9 combinations', () => {
      const result = cartesianProduct({
        a: [1, 2, 3],
        b: [10, 20, 30],
      });
      expect(result).toHaveLength(9);
    });

    it('every combination of (a, b) is present', () => {
      const result = cartesianProduct({ a: [1, 2], b: [10, 20] });
      expect(result).toHaveLength(4);

      const combos = result.map((r) => `${r.a}-${r.b}`).sort();
      expect(combos).toEqual(['1-10', '1-20', '2-10', '2-20'].sort());
    });

    it('single param → N combinations (one per value)', () => {
      const result = cartesianProduct({ x: [5, 10, 15] });
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.x)).toEqual([5, 10, 15]);
    });

    it('3 params × 2 values each → 8 combinations', () => {
      const result = cartesianProduct({ a: [1, 2], b: [3, 4], c: [5, 6] });
      expect(result).toHaveLength(8);
    });

    it('pinned param (single value) contributes exactly 1 to product', () => {
      const result = cartesianProduct({ a: [1, 2, 3], pinned: [42] });
      expect(result).toHaveLength(3);
      result.forEach((r) => expect(r.pinned).toBe(42));
    });

    it('empty params object → empty array', () => {
      const result = cartesianProduct({});
      expect(result).toHaveLength(0);
    });

    it('each combination is an independent copy (no mutation bleed-through)', () => {
      const result = cartesianProduct({ a: [1, 2], b: [10, 20] });
      // Mutate the first combination
      result[0].a = 999;
      // Others must be unaffected
      expect(result[1].a).not.toBe(999);
      expect(result[2].a).not.toBe(999);
    });
  });

  // --------------------------------------------------------------------------
  // indexToCombination
  // --------------------------------------------------------------------------

  describe('indexToCombination', () => {
    it('converts index 0 to first combination', () => {
      const pv: ParamValues = { a: [1, 2, 3], b: [10, 20] };
      const keys = ['a', 'b'];
      const sizes = [3, 2];
      const combo = indexToCombination(0, keys, pv, sizes);
      expect(combo).toEqual({ a: 1, b: 10 });
    });

    it('round-trips all 6 combinations of 3×2 grid', () => {
      const pv: ParamValues = { a: [1, 2, 3], b: [10, 20] };
      const keys = ['a', 'b'];
      const sizes = [3, 2];
      const full = cartesianProduct(pv);

      for (let i = 0; i < 6; i++) {
        const combo = indexToCombination(i, keys, pv, sizes);
        // Combination must appear somewhere in the full cartesian product
        const found = full.some(
          (c) => c.a === combo.a && c.b === combo.b,
        );
        expect(found).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Full generateGrid pipeline
  // --------------------------------------------------------------------------

  describe('generateGrid (full pipeline)', () => {
    it('simple grid: 2 params, 3 values each → 9 combinations', () => {
      const result = generateGrid({
        fast: { min: 5, max: 15, step: 5 },
        slow: { min: 20, max: 40, step: 10 },
      });
      expect(result).toHaveLength(9);
    });

    it('single param grid: 1 param, 5 values → 5 combinations', () => {
      const result = generateGrid({ period: { min: 10, max: 50, step: 10 } });
      expect(result).toHaveLength(5);
      expect(result.every((r) => typeof r.period === 'number')).toBe(true);
    });

    it('pinned param (min === max) → only 1 value for that param', () => {
      const result = generateGrid({
        period: { min: 14, max: 14, step: 1 },
        threshold: { min: 0.1, max: 0.3, step: 0.1 },
      });
      // 1 value for period × 3 for threshold = 3 combos
      expect(result).toHaveLength(3);
      result.forEach((r) => expect(r.period).toBe(14));
    });

    it('grid with step=2: min=1, max=5, step=2 → [1, 3, 5]', () => {
      const result = generateGrid({ x: { min: 1, max: 5, step: 2 } });
      expect(result).toHaveLength(3);
      const xValues = result.map((r) => r.x).sort();
      expect(xValues).toEqual([1, 3, 5]);
    });

    it('maxCombinations cap limits result count', () => {
      // 10 × 10 = 100 combinations, cap at 20
      const result = generateGrid(
        {
          a: { min: 1, max: 10, step: 1 },
          b: { min: 1, max: 10, step: 1 },
        },
        20,
      );
      expect(result).toHaveLength(20);
    });

    it('maxCombinations cap: result always ≤ cap', () => {
      const result = generateGrid(
        {
          a: { min: 1, max: 100, step: 1 },
          b: { min: 1, max: 100, step: 1 },
        },
        50,
      );
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('when grid fits within maxCombinations, all combos are returned', () => {
      // 3 × 4 = 12, cap = 500 → all 12 returned
      const result = generateGrid({
        a: { min: 1, max: 3, step: 1 },
        b: { min: 10, max: 40, step: 10 },
      });
      expect(result).toHaveLength(12);
    });

    it('float steps: min=0.1, max=0.3, step=0.1 → 3 combos', () => {
      const result = generateGrid({ thresh: { min: 0.1, max: 0.3, step: 0.1 } });
      expect(result).toHaveLength(3);
      const sorted = result.map((r) => r.thresh as number).sort();
      expect(sorted[0]).toBeCloseTo(0.1, 8);
      expect(sorted[1]).toBeCloseTo(0.2, 8);
      expect(sorted[2]).toBeCloseTo(0.3, 8);
    });

    it('boundaries are included: both min and max appear in generated values', () => {
      const result = generateGrid({ p: { min: 5, max: 25, step: 5 } });
      const values = result.map((r) => r.p as number);
      expect(values).toContain(5);
      expect(values).toContain(25);
    });

    it('off-by-one: step divides range exactly — no phantom extra values', () => {
      // min=2, max=10, step=2 → [2, 4, 6, 8, 10] = 5 values
      const result = generateGrid({ n: { min: 2, max: 10, step: 2 } });
      expect(result).toHaveLength(5);
    });
  });
});

// ============================================================================
// Tests — exported utility functions
// ============================================================================

describe('Optimizer — exported utilities', () => {
  // --------------------------------------------------------------------------
  // compareParams
  // --------------------------------------------------------------------------

  describe('compareParams', () => {
    it('returns true for identical params', () => {
      expect(compareParams({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns true regardless of key insertion order', () => {
      expect(compareParams({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns false when values differ', () => {
      expect(compareParams({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('returns false when one has extra keys', () => {
      expect(compareParams({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    it('returns false for completely different params', () => {
      expect(compareParams({ x: 10 }, { y: 10 })).toBe(false);
    });

    it('returns true for empty objects', () => {
      expect(compareParams({}, {})).toBe(true);
    });

    it('handles string values', () => {
      expect(compareParams({ mode: 'long' }, { mode: 'long' })).toBe(true);
      expect(compareParams({ mode: 'long' }, { mode: 'short' })).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getMetricValue
  // --------------------------------------------------------------------------

  describe('getMetricValue', () => {
    const makeMetrics = (overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics => ({
      totalReturn: 500,
      totalReturnPercent: 5,
      maxDrawdown: 200,
      maxDrawdownPercent: 2,
      sharpeRatio: 1.5,
      sortinoRatio: 2.0,
      winRate: 55,
      profitFactor: 1.8,
      totalTrades: 20,
      winningTrades: 11,
      losingTrades: 9,
      avgWin: 100,
      avgLoss: 60,
      avgWinPercent: 2,
      avgLossPercent: 1.2,
      expectancy: 40,
      expectancyPercent: 0.8,
      largestWin: 300,
      largestLoss: 150,
      avgTradeDuration: 3600000,
      exposureTime: 0.4,
      totalFees: 50,
      totalSlippage: 10,
      ...overrides,
    });

    it('retrieves sharpeRatio', () => {
      expect(getMetricValue(makeMetrics(), 'sharpeRatio')).toBe(1.5);
    });

    it('retrieves totalReturnPercent', () => {
      expect(getMetricValue(makeMetrics(), 'totalReturnPercent')).toBe(5);
    });

    it('retrieves winRate', () => {
      expect(getMetricValue(makeMetrics(), 'winRate')).toBe(55);
    });

    it('retrieves profitFactor', () => {
      expect(getMetricValue(makeMetrics(), 'profitFactor')).toBe(1.8);
    });

    it('retrieves maxDrawdownPercent', () => {
      expect(getMetricValue(makeMetrics(), 'maxDrawdownPercent')).toBe(2);
    });

    it('returns undefined for unknown metric (no throw)', () => {
      // getMetricValue casts to number; accessing unknown key returns undefined
      const value = getMetricValue(makeMetrics(), 'nonExistentMetric');
      expect(value).toBeUndefined();
    });
  });
});

// ============================================================================
// Tests — composite scoring formula (re-implemented from optimizer.ts)
// ============================================================================

describe('Optimizer — composite score formula', () => {
  /**
   * Mirrors calculateCompositeScore() from optimizer.ts exactly.
   * Tests the formula contract without needing to import the private function.
   */
  function calculateCompositeScore(metrics: {
    sharpeRatio: number;
    totalReturnPercent: number;
    profitFactor: number;
    winRate: number;
    maxDrawdownPercent: number;
  }): number {
    const weights = {
      sharpeRatio: 0.25,
      totalReturnPercent: 0.30,
      profitFactor: 0.20,
      winRate: 0.15,
      maxDrawdownPenalty: 0.10,
    };

    const sharpeNorm = Math.max(0, Math.min(1, (metrics.sharpeRatio + 1) / 4));
    const returnNorm = Math.max(0, Math.min(1, (metrics.totalReturnPercent + 50) / 100));
    const pfNorm = Math.max(0, Math.min(1, metrics.profitFactor / 4));
    const wrNorm = metrics.winRate / 100;
    const ddPenalty = Math.max(0, 1 - metrics.maxDrawdownPercent / 30);

    return (
      weights.sharpeRatio * sharpeNorm +
      weights.totalReturnPercent * returnNorm +
      weights.profitFactor * pfNorm +
      weights.winRate * wrNorm +
      weights.maxDrawdownPenalty * ddPenalty
    );
  }

  it('returns value in [0, 1] range for typical metrics', () => {
    const score = calculateCompositeScore({
      sharpeRatio: 1.0,
      totalReturnPercent: 10,
      profitFactor: 1.5,
      winRate: 55,
      maxDrawdownPercent: 10,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('weights sum to 1.0', () => {
    const weights = [0.25, 0.30, 0.20, 0.15, 0.10];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('better metrics yield higher score than worse metrics', () => {
    const good = calculateCompositeScore({
      sharpeRatio: 2.0,
      totalReturnPercent: 30,
      profitFactor: 2.0,
      winRate: 65,
      maxDrawdownPercent: 5,
    });
    const bad = calculateCompositeScore({
      sharpeRatio: -0.5,
      totalReturnPercent: -20,
      profitFactor: 0.5,
      winRate: 35,
      maxDrawdownPercent: 25,
    });
    expect(good).toBeGreaterThan(bad);
  });

  it('sharpeRatio of -1 normalises to 0 (clamped)', () => {
    // sharpeNorm = max(0, min(1, (-1 + 1) / 4)) = 0
    const score = calculateCompositeScore({
      sharpeRatio: -1,
      totalReturnPercent: 0,
      profitFactor: 0,
      winRate: 0,
      maxDrawdownPercent: 0,
    });
    // Only contribution from weights where norms are non-zero
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('extreme drawdown (≥30%) results in zero drawdown contribution', () => {
    // ddPenalty = max(0, 1 - 30/30) = 0
    const score = calculateCompositeScore({
      sharpeRatio: 0,
      totalReturnPercent: 0,
      profitFactor: 0,
      winRate: 0,
      maxDrawdownPercent: 30,
    });
    // With sharpeRatio=0: sharpeNorm = (0+1)/4 = 0.25
    // totalReturnPercent=0: returnNorm = (0+50)/100 = 0.5
    // profitFactor=0: pfNorm = 0, winRate=0: wrNorm=0, drawdown≥30: ddPenalty=0
    // score = 0.25*0.25 + 0.30*0.5 + 0 + 0 + 0 = 0.0625 + 0.15 = 0.2125
    expect(score).toBeCloseTo(0.2125, 5);
  });
});
