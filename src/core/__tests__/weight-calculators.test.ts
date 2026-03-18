/**
 * Tests for weight-calculators.ts
 */

import { describe, it, expect } from 'vitest';
import {
  defaultWeightCalculator,
  createFundingRateWeightCalculator,
  getWeightCalculator,
  registerWeightCalculator,
} from '../weight-calculators.js';
import type { WeightContext } from '../signal-types.js';
import type { FundingRate } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<WeightContext> = {}): WeightContext {
  return {
    currentPrice: 50000,
    barIndex: 0,
    symbol: 'BTC/USDT',
    ...overrides,
  };
}

function makeFundingRates(rates: number[]): FundingRate[] {
  return rates.map((r, i) => ({
    timestamp: 1_700_000_000_000 + i * 8 * 3600 * 1000,
    fundingRate: r,
  }));
}

// ---------------------------------------------------------------------------
// defaultWeightCalculator
// ---------------------------------------------------------------------------

describe('defaultWeightCalculator', () => {
  it('returns 1.0 for a basic context', () => {
    expect(defaultWeightCalculator.calculateWeight(makeContext())).toBe(1.0);
  });

  it('returns 1.0 regardless of funding rate data', () => {
    const ctx = makeContext({
      currentFundingRate: 0.001,
      fundingRates: makeFundingRates([0.001, 0.002, 0.0005]),
    });
    expect(defaultWeightCalculator.calculateWeight(ctx)).toBe(1.0);
  });

  it('returns 1.0 when there is no data at all', () => {
    expect(defaultWeightCalculator.calculateWeight(makeContext({}))).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// createFundingRateWeightCalculator
// ---------------------------------------------------------------------------

describe('createFundingRateWeightCalculator', () => {
  it('returns 0 when currentFundingRate is undefined', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      fundingRates: makeFundingRates([0.001, 0.002]),
    });
    expect(calc.calculateWeight(ctx)).toBe(0);
  });

  it('returns 0 when fundingRates array is missing', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({ currentFundingRate: 0.001 });
    expect(calc.calculateWeight(ctx)).toBe(0);
  });

  it('returns 0 when fundingRates array is empty', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: 0.001,
      fundingRates: [],
    });
    expect(calc.calculateWeight(ctx)).toBe(0);
  });

  it('returns 0 when all funding rates in the window are zero', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: 0,
      fundingRates: makeFundingRates([0, 0, 0]),
    });
    expect(calc.calculateWeight(ctx)).toBe(0);
  });

  it('returns 0 when currentFundingRate is 0 (even if window has non-zero rates)', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: 0,
      fundingRates: makeFundingRates([0.001, 0.002]),
    });
    expect(calc.calculateWeight(ctx)).toBe(0);
  });

  it('returns 0.5 when current rate is half the max in the window', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: 0.0005,
      fundingRates: makeFundingRates([0.001, 0.0005, 0.0008]),
    });
    // maxAbsFR = 0.001, abs(0.0005) / 0.001 = 0.5
    expect(calc.calculateWeight(ctx)).toBeCloseTo(0.5);
  });

  it('returns 1.0 when current rate equals the max in the window', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: 0.001,
      fundingRates: makeFundingRates([0.001, 0.0005]),
    });
    expect(calc.calculateWeight(ctx)).toBeCloseTo(1.0);
  });

  it('clamps to 1.0 when current rate exceeds all rates in the lookback window', () => {
    const calc = createFundingRateWeightCalculator(24);
    // Lookback only covers the last 2 bars (0.0002, 0.0003); current is 0.001
    const ctx = makeContext({
      currentFundingRate: 0.001,
      fundingRates: makeFundingRates([0.0001, 0.0002, 0.0002, 0.0003]),
    });
    // With lookback=24, all 4 bars are in the window. maxAbsFR = 0.0003
    // abs(0.001) / 0.0003 = 3.33... → clamped to 1.0
    expect(calc.calculateWeight(ctx)).toBe(1.0);
  });

  it('uses only the last N bars defined by lookbackBars', () => {
    const calc = createFundingRateWeightCalculator(2);
    // Only last 2 bars are considered: [0.0004, 0.0006]. maxAbsFR = 0.0006
    const rates = makeFundingRates([0.001, 0.002, 0.0004, 0.0006]);
    const ctx = makeContext({
      currentFundingRate: 0.0003,
      fundingRates: rates,
    });
    // abs(0.0003) / 0.0006 = 0.5
    expect(calc.calculateWeight(ctx)).toBeCloseTo(0.5);
  });

  it('handles negative funding rates correctly (uses absolute value)', () => {
    const calc = createFundingRateWeightCalculator(24);
    const ctx = makeContext({
      currentFundingRate: -0.0005,
      fundingRates: makeFundingRates([-0.001, 0.0008]),
    });
    // maxAbsFR = max(0.001, 0.0008) = 0.001
    // abs(-0.0005) / 0.001 = 0.5
    expect(calc.calculateWeight(ctx)).toBeCloseTo(0.5);
  });

  it('defaults to lookbackBars=24 when not specified', () => {
    const calc = createFundingRateWeightCalculator(); // default 24
    const rates = makeFundingRates(Array.from({ length: 30 }, (_, i) => (i + 1) * 0.0001));
    // Last 24 bars: indices 6..29, rates 0.0007..0.003. maxAbsFR = 0.003
    const ctx = makeContext({
      currentFundingRate: 0.0015,
      fundingRates: rates,
    });
    // abs(0.0015) / 0.003 = 0.5
    expect(calc.calculateWeight(ctx)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Registry — getWeightCalculator
// ---------------------------------------------------------------------------

describe('getWeightCalculator', () => {
  it('returns funding-rate calculator for "funding-rate-spike" (exact match)', () => {
    const calc = getWeightCalculator('funding-rate-spike');
    // Should behave like a funding-rate weight calculator (returns 0 with no data)
    expect(calc.calculateWeight(makeContext({ currentFundingRate: undefined }))).toBe(0);
  });

  it('returns funding-rate calculator for "funding-rate-spike-v2" via prefix match', () => {
    const calc = getWeightCalculator('funding-rate-spike-v2');
    // funding-rate-spike-v2 is NOT explicitly registered — it must match by prefix
    // The funding rate calculator returns 0 when there is no funding rate data
    expect(calc.calculateWeight(makeContext({ currentFundingRate: undefined }))).toBe(0);
  });

  it('returns funding-rate calculator for "funding-rate-spike-v3" via prefix match', () => {
    const calc = getWeightCalculator('funding-rate-spike-v3');
    expect(calc.calculateWeight(makeContext({ currentFundingRate: undefined }))).toBe(0);
  });

  it('exact match takes priority over prefix match', () => {
    // Register a custom calculator under the full "funding-rate-spike-v2" name
    registerWeightCalculator('funding-rate-spike-v2', () => ({
      calculateWeight: () => 0.77,
    }));
    const calc = getWeightCalculator('funding-rate-spike-v2');
    expect(calc.calculateWeight(makeContext())).toBe(0.77);

    // Clean up: re-register something benign so other tests are not affected
    // (tests are isolated by module state but let's keep it clean)
  });

  it('returns default (weight=1.0) for an unknown strategy via "*" wildcard', () => {
    // The '*' wildcard is registered at module init, so unknown strategies
    // get weight=1.0 instead of throwing.  This preserves backward-compatibility
    // for strategies that don't need custom weight logic.
    const calc = getWeightCalculator('some-completely-unknown-strategy-xyz');
    expect(calc.calculateWeight(makeContext())).toBe(1.0);
  });

  it('returns the default calculator when strategy is "default"', () => {
    const calc = getWeightCalculator('default');
    expect(calc.calculateWeight(makeContext())).toBe(1.0);
  });

  it('funding-rate-spike prefix match still returns functional funding-rate calculator', () => {
    const calc = getWeightCalculator('funding-rate-spike-v3');
    // A context with actual funding data — should give non-zero weight
    const ctx = makeContext({
      currentFundingRate: 0.001,
      fundingRates: makeFundingRates([0.001, 0.0005]),
    });
    expect(calc.calculateWeight(ctx)).toBeCloseTo(1.0);
  });
});

describe('registerWeightCalculator', () => {
  it('registers a custom calculator that is then returned by getWeightCalculator', () => {
    const customCalc = { calculateWeight: (_ctx: WeightContext) => 0.42 };
    registerWeightCalculator('my-custom-strategy', () => customCalc);

    const calc = getWeightCalculator('my-custom-strategy');
    expect(calc.calculateWeight(makeContext())).toBe(0.42);
  });

  it('overwrites a previously registered calculator', () => {
    registerWeightCalculator('overwrite-test', () => ({
      calculateWeight: () => 0.1,
    }));
    registerWeightCalculator('overwrite-test', () => ({
      calculateWeight: () => 0.9,
    }));

    const calc = getWeightCalculator('overwrite-test');
    expect(calc.calculateWeight(makeContext())).toBe(0.9);
  });
});
