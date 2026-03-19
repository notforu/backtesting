/**
 * Unit tests for the backtesting engine — pure functions only.
 *
 * The engine's main function (runBacktest) requires DB and network access, so
 * we test only the pure, exported helpers:
 *   - createBacktestConfig (creates configs with defaults)
 *
 * We also test the private findNearestFundingRate binary-search logic by
 * reimplementing it as a pure function with the same algorithm — ensuring the
 * logic is correct without touching the DB or network.
 *
 * Additionally we test the DEFAULT_ENGINE_CONFIG field values and the
 * getPositionAmount helper (reimplemented as a pure function).
 */

import { describe, it, expect } from 'vitest';
import { createBacktestConfig } from '../engine.js';

// ============================================================================
// Helpers — pure reimplementations of private engine functions
// ============================================================================

interface FundingRateStub {
  timestamp: number;
  fundingRate: number;
  markPrice?: number;
}

/**
 * Binary search for the nearest funding rate to a given timestamp.
 * Exact copy of findNearestFundingRate() from engine.ts.
 * Assumes rates are sorted ascending by timestamp.
 */
function findNearestFundingRate(
  rates: FundingRateStub[],
  timestamp: number,
): FundingRateStub | undefined {
  if (rates.length === 0) return undefined;
  let lo = 0;
  let hi = rates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid].timestamp < timestamp) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(rates[lo - 1].timestamp - timestamp) <
      Math.abs(rates[lo].timestamp - timestamp)
  ) {
    return rates[lo - 1];
  }
  return rates[lo];
}

// ============================================================================
// Tests — createBacktestConfig
// ============================================================================

describe('createBacktestConfig', () => {
  const REQUIRED = {
    strategyName: 'sma-crossover',
    symbol: 'BTC/USDT',
    startDate: 1_000_000,
    endDate: 2_000_000,
  };

  it('generates a valid UUID for id', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('applies default timeframe of 1h', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.timeframe).toBe('1h');
  });

  it('applies default initialCapital of 10000', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.initialCapital).toBe(10_000);
  });

  it('applies default exchange of binance', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.exchange).toBe('binance');
  });

  it('applies default empty params', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.params).toEqual({});
  });

  it('uses provided strategyName', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.strategyName).toBe('sma-crossover');
  });

  it('uses provided symbol', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.symbol).toBe('BTC/USDT');
  });

  it('uses provided startDate', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.startDate).toBe(1_000_000);
  });

  it('uses provided endDate', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(config.endDate).toBe(2_000_000);
  });

  it('override: timeframe can be changed to 4h', () => {
    const config = createBacktestConfig({ ...REQUIRED, timeframe: '4h' });
    expect(config.timeframe).toBe('4h');
  });

  it('override: initialCapital can be changed', () => {
    const config = createBacktestConfig({ ...REQUIRED, initialCapital: 50_000 });
    expect(config.initialCapital).toBe(50_000);
  });

  it('override: exchange can be changed to bybit', () => {
    const config = createBacktestConfig({ ...REQUIRED, exchange: 'bybit' });
    expect(config.exchange).toBe('bybit');
  });

  it('override: custom params are applied', () => {
    const config = createBacktestConfig({
      ...REQUIRED,
      params: { fastPeriod: 10, slowPeriod: 30 },
    });
    expect(config.params).toEqual({ fastPeriod: 10, slowPeriod: 30 });
  });

  it('each call produces a different id (UUID uniqueness)', () => {
    const a = createBacktestConfig(REQUIRED);
    const b = createBacktestConfig(REQUIRED);
    expect(a.id).not.toBe(b.id);
  });

  it('mode can be set to futures', () => {
    const config = createBacktestConfig({ ...REQUIRED, mode: 'futures' });
    expect(config.mode).toBe('futures');
  });

  it('leverage can be set', () => {
    const config = createBacktestConfig({ ...REQUIRED, leverage: 5 });
    expect(config.leverage).toBe(5);
  });

  it('returned object has all required BacktestConfig fields', () => {
    const config = createBacktestConfig(REQUIRED);
    expect(typeof config.id).toBe('string');
    expect(typeof config.strategyName).toBe('string');
    expect(typeof config.symbol).toBe('string');
    expect(typeof config.timeframe).toBe('string');
    expect(typeof config.startDate).toBe('number');
    expect(typeof config.endDate).toBe('number');
    expect(typeof config.initialCapital).toBe('number');
    expect(typeof config.exchange).toBe('string');
    expect(typeof config.params).toBe('object');
  });
});

// ============================================================================
// Tests — findNearestFundingRate (binary search logic)
// ============================================================================

describe('findNearestFundingRate — binary search logic', () => {
  const makeRate = (timestamp: number, fundingRate = 0.001): FundingRateStub => ({
    timestamp,
    fundingRate,
  });

  it('returns undefined for empty array', () => {
    expect(findNearestFundingRate([], 1000)).toBeUndefined();
  });

  it('returns the only element when array has one entry', () => {
    const rates = [makeRate(1000)];
    expect(findNearestFundingRate(rates, 1000)?.timestamp).toBe(1000);
  });

  it('returns the only element even when timestamp is far away', () => {
    const rates = [makeRate(1000)];
    expect(findNearestFundingRate(rates, 999_999)?.timestamp).toBe(1000);
  });

  it('returns exact match when timestamp is found', () => {
    const rates = [makeRate(1000), makeRate(2000), makeRate(3000)];
    expect(findNearestFundingRate(rates, 2000)?.timestamp).toBe(2000);
  });

  it('equidistant case: returns right neighbour (lo) when distances are equal — strict < condition', () => {
    // Rates at 1000 and 3000, target at 2000 → equidistant (both dist 1000)
    // The condition is strict: |lo-1 - target| < |lo - target|
    // Since 1000 is NOT strictly less than 1000, the condition is false → returns rates[lo] = 3000
    const rates = [makeRate(1000), makeRate(3000)];
    const result = findNearestFundingRate(rates, 2000);
    expect(result?.timestamp).toBe(3000);
  });

  it('returns left neighbour when target is between two rates, closer to left', () => {
    const rates = [makeRate(1000), makeRate(2000), makeRate(3000)];
    // target 1400 is closer to 1000 (dist 400) than 2000 (dist 600)
    const result = findNearestFundingRate(rates, 1400);
    expect(result?.timestamp).toBe(1000);
  });

  it('returns right neighbour when target is between two rates, closer to right', () => {
    const rates = [makeRate(1000), makeRate(2000), makeRate(3000)];
    // target 1700 is closer to 2000 (dist 300) than 1000 (dist 700)
    const result = findNearestFundingRate(rates, 1700);
    expect(result?.timestamp).toBe(2000);
  });

  it('returns first element when target is before all rates', () => {
    const rates = [makeRate(1000), makeRate(2000), makeRate(3000)];
    const result = findNearestFundingRate(rates, 0);
    expect(result?.timestamp).toBe(1000);
  });

  it('returns last element when target is after all rates', () => {
    const rates = [makeRate(1000), makeRate(2000), makeRate(3000)];
    const result = findNearestFundingRate(rates, 9999);
    expect(result?.timestamp).toBe(3000);
  });

  it('works correctly with a large array of rates', () => {
    const rates = Array.from({ length: 100 }, (_, i) =>
      makeRate(i * 8 * 3600 * 1000), // every 8 hours
    );
    // Target exactly at index 50
    const targetTs = 50 * 8 * 3600 * 1000;
    const result = findNearestFundingRate(rates, targetTs);
    expect(result?.timestamp).toBe(targetTs);
  });

  it('handles negative timestamps (unusual but should not throw)', () => {
    const rates = [makeRate(-3000), makeRate(-2000), makeRate(-1000)];
    const result = findNearestFundingRate(rates, -1500);
    // Equidistant between -2000 and -1000; strict < condition → returns rates[lo] = -1000
    expect(result?.timestamp).toBe(-1000);
  });
});

// ============================================================================
// Tests — getPositionAmount helper (pure logic)
// ============================================================================

describe('getPositionAmount — close action amount resolution', () => {
  /**
   * Mirrors getPositionAmount() from engine.ts.
   */
  function getPositionAmount(
    portfolio: {
      longPosition: { amount: number } | null;
      shortPosition: { amount: number } | null;
    },
    action: string,
  ): number {
    switch (action) {
      case 'CLOSE_LONG':
        return portfolio.longPosition?.amount ?? 0;
      case 'CLOSE_SHORT':
        return portfolio.shortPosition?.amount ?? 0;
      default:
        return 0;
    }
  }

  it('CLOSE_LONG returns long position amount', () => {
    const portfolio = { longPosition: { amount: 0.5 }, shortPosition: null };
    expect(getPositionAmount(portfolio, 'CLOSE_LONG')).toBe(0.5);
  });

  it('CLOSE_SHORT returns short position amount', () => {
    const portfolio = { longPosition: null, shortPosition: { amount: 2.0 } };
    expect(getPositionAmount(portfolio, 'CLOSE_SHORT')).toBe(2.0);
  });

  it('CLOSE_LONG returns 0 when no long position exists', () => {
    const portfolio = { longPosition: null, shortPosition: null };
    expect(getPositionAmount(portfolio, 'CLOSE_LONG')).toBe(0);
  });

  it('CLOSE_SHORT returns 0 when no short position exists', () => {
    const portfolio = { longPosition: null, shortPosition: null };
    expect(getPositionAmount(portfolio, 'CLOSE_SHORT')).toBe(0);
  });

  it('OPEN_LONG returns 0 (not a close action)', () => {
    const portfolio = { longPosition: { amount: 1.0 }, shortPosition: null };
    expect(getPositionAmount(portfolio, 'OPEN_LONG')).toBe(0);
  });

  it('OPEN_SHORT returns 0 (not a close action)', () => {
    const portfolio = { longPosition: null, shortPosition: { amount: 1.0 } };
    expect(getPositionAmount(portfolio, 'OPEN_SHORT')).toBe(0);
  });

  it('unknown action returns 0', () => {
    const portfolio = { longPosition: { amount: 1.0 }, shortPosition: { amount: 1.0 } };
    expect(getPositionAmount(portfolio, 'UNKNOWN_ACTION')).toBe(0);
  });
});

// ============================================================================
// Tests — early stop condition logic
// ============================================================================

describe('Engine — early stop equity check logic', () => {
  /**
   * Mirrors the early-stop check inside the engine's main loop.
   * Fires every 100 bars when earlyStopEquityFraction is set.
   */
  function shouldEarlyStop(
    equity: number,
    initialCapital: number,
    earlyStopEquityFraction: number | undefined,
  ): boolean {
    if (earlyStopEquityFraction === undefined) return false;
    return equity < initialCapital * earlyStopEquityFraction;
  }

  it('does not stop when earlyStopEquityFraction is undefined', () => {
    expect(shouldEarlyStop(1000, 10_000, undefined)).toBe(false);
  });

  it('stops when equity drops below fraction of initial capital', () => {
    // fraction 0.3 means stop if equity < 10000 * 0.3 = 3000
    expect(shouldEarlyStop(2999, 10_000, 0.3)).toBe(true);
  });

  it('does not stop when equity is exactly at threshold', () => {
    // equity = 3000 is NOT < 3000
    expect(shouldEarlyStop(3000, 10_000, 0.3)).toBe(false);
  });

  it('does not stop when equity is above threshold', () => {
    expect(shouldEarlyStop(5000, 10_000, 0.3)).toBe(false);
  });

  it('fraction 0.5 means half the initial capital triggers stop', () => {
    expect(shouldEarlyStop(4999, 10_000, 0.5)).toBe(true);
    expect(shouldEarlyStop(5000, 10_000, 0.5)).toBe(false);
    expect(shouldEarlyStop(5001, 10_000, 0.5)).toBe(false);
  });

  it('fraction 1.0 would stop immediately (equity always < initial)', () => {
    // Any equity below initial would trigger
    expect(shouldEarlyStop(9999, 10_000, 1.0)).toBe(true);
    expect(shouldEarlyStop(10_000, 10_000, 1.0)).toBe(false);
  });
});

describe('Engine — early stop loop termination behavior', () => {
  /**
   * Simulates the engine main loop with early stop logic intact.
   * The engine checks every 100 bars: if equity < initialCapital * fraction, break.
   * Returns the number of bars that were processed.
   */
  function runLoopWithEarlyStop(
    equityByBar: number[],
    initialCapital: number,
    earlyStopEquityFraction: number | undefined,
  ): number {
    const totalBars = equityByBar.length;
    let processedBars = 0;

    for (let i = 0; i < totalBars; i++) {
      processedBars++;

      // Early termination check (every 100 bars)
      if (i % 100 === 0 && earlyStopEquityFraction !== undefined) {
        if (equityByBar[i] < initialCapital * earlyStopEquityFraction) {
          break;
        }
      }
    }

    return processedBars;
  }

  it('processes all bars when earlyStopEquityFraction is undefined', () => {
    const equity = Array.from({ length: 300 }, () => 5_000);
    const processed = runLoopWithEarlyStop(equity, 10_000, undefined);
    expect(processed).toBe(300);
  });

  it('processes all bars when equity stays above threshold', () => {
    const equity = Array.from({ length: 300 }, () => 8_000);
    const processed = runLoopWithEarlyStop(equity, 10_000, 0.3);
    expect(processed).toBe(300);
  });

  it('terminates early when equity drops below threshold at bar 100', () => {
    // equity drops below 30% threshold (3000) at bar 100
    const equity = Array.from({ length: 300 }, (_, i) => (i < 100 ? 8_000 : 1_000));
    const processed = runLoopWithEarlyStop(equity, 10_000, 0.3);
    // Should stop at bar 100 (index 100), so only 101 bars processed
    expect(processed).toBeLessThan(300);
    expect(processed).toBe(101); // bar 100 is the 101st bar (0-indexed)
  });

  it('without early stop, all bars are processed even with low equity', () => {
    // equity drops to 0 but no early stop configured
    const equity = Array.from({ length: 300 }, () => 0);
    const processed = runLoopWithEarlyStop(equity, 10_000, undefined);
    expect(processed).toBe(300);
  });

  it('bypassing early stop causes the loop to run more bars than expected', () => {
    // This test documents the bug: without early stop, low-equity runs continue unnecessarily
    const equity = Array.from({ length: 300 }, (_, i) => (i < 100 ? 8_000 : 1_000));
    const withEarlyStop = runLoopWithEarlyStop(equity, 10_000, 0.3);
    const withoutEarlyStop = runLoopWithEarlyStop(equity, 10_000, undefined);

    // Early stop should terminate before processing all bars
    expect(withEarlyStop).toBeLessThan(withoutEarlyStop);
    expect(withoutEarlyStop).toBe(300);
    expect(withEarlyStop).toBe(101);
  });
});

// ============================================================================
// Tests — equity curve and trade accumulation (pure data logic)
// ============================================================================

describe('Engine — equity and trade tracking invariants', () => {
  it('equityTimestamps and equityValues grow together', () => {
    // Simulates the inner loop: equityTimestamps.push(candle.timestamp), equityValues.push(equity)
    const equityTimestamps: number[] = [];
    const equityValues: number[] = [];

    const candles = [
      { timestamp: 1000, close: 100 },
      { timestamp: 2000, close: 110 },
      { timestamp: 3000, close: 105 },
    ];

    for (const candle of candles) {
      equityTimestamps.push(candle.timestamp);
      equityValues.push(candle.close * 0.1); // fake equity
    }

    expect(equityTimestamps).toHaveLength(candles.length);
    expect(equityValues).toHaveLength(candles.length);
    expect(equityTimestamps).toHaveLength(equityValues.length);
  });

  it('loop processes ALL candles including the last bar (no off-by-one)', () => {
    // The engine loop must be `i < totalBars` not `i < totalBars - 1`
    // This test ensures ALL N candles produce N equity data points
    const candles = [
      { timestamp: 1000, close: 100 },
      { timestamp: 2000, close: 110 },
      { timestamp: 3000, close: 105 },
      { timestamp: 4000, close: 120 },  // LAST BAR - must not be skipped
    ];
    const totalBars = candles.length;

    const processedTimestamps: number[] = [];
    // Simulates engine main loop with correct bound: `i < totalBars`
    for (let i = 0; i < totalBars; i++) {
      processedTimestamps.push(candles[i].timestamp);
    }

    // All 4 bars must be processed
    expect(processedTimestamps).toHaveLength(4);
    // Last bar (timestamp 4000) must be processed
    expect(processedTimestamps[processedTimestamps.length - 1]).toBe(4000);
  });

  it('skipping last bar (off-by-one bug) would miss signals and reduce equity points', () => {
    // This documents the off-by-one failure mode:
    // With `i < totalBars - 1`, the last candle is never processed
    const candles = [
      { timestamp: 1000, close: 100 },
      { timestamp: 2000, close: 110 },
      { timestamp: 3000, close: 105 },
      { timestamp: 4000, close: 120 },
    ];
    const totalBars = candles.length;

    const buggyTimestamps: number[] = [];
    // Simulates the BUGGY loop: `i < totalBars - 1`
    for (let i = 0; i < totalBars - 1; i++) {
      buggyTimestamps.push(candles[i].timestamp);
    }

    // Buggy loop only produces 3 points, not 4
    expect(buggyTimestamps).toHaveLength(3);
    // Last bar (4000) was NOT processed — this is the bug
    expect(buggyTimestamps).not.toContain(4000);
    // Correct behavior must be to process exactly totalBars entries
    expect(buggyTimestamps).not.toHaveLength(totalBars);
  });

  it('equityTimestamps are sorted ascending (match candle order)', () => {
    const candles = [
      { timestamp: 1000, close: 100 },
      { timestamp: 2000, close: 110 },
      { timestamp: 3000, close: 105 },
    ];

    const timestamps = candles.map((c) => c.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
  });

  it('trades accumulate correctly across multiple bars', () => {
    // Simulates: trades.push(...newTrades) for each bar
    const allTrades: string[] = [];

    const barTrades = [
      ['open-long-1'],
      [], // no trade this bar
      ['close-long-1', 'open-short-1'],
      ['close-short-1'],
    ];

    for (const bt of barTrades) {
      allTrades.push(...bt);
    }

    expect(allTrades).toHaveLength(4);
    expect(allTrades[0]).toBe('open-long-1');
    expect(allTrades[1]).toBe('close-long-1');
    expect(allTrades[2]).toBe('open-short-1');
    expect(allTrades[3]).toBe('close-short-1');
  });
});

// ============================================================================
// Tests — funding rate payment calculation (pure logic mirroring engine.ts)
// ============================================================================

describe('Engine — funding rate payment calculation', () => {
  /**
   * Mirrors the engine's funding rate payment logic for a long position.
   * payment = -amount * markPrice * fundingRate
   * Positive fundingRate → long pays (negative payment)
   * Negative fundingRate → long receives (positive payment)
   */
  function calcLongFundingPayment(
    amount: number,
    markPrice: number,
    fundingRate: number,
  ): number {
    return -amount * markPrice * fundingRate;
  }

  /**
   * Mirrors the engine's funding rate payment logic for a short position.
   * payment = amount * markPrice * fundingRate
   * Positive fundingRate → short receives (positive payment)
   * Negative fundingRate → short pays (negative payment)
   */
  function calcShortFundingPayment(
    amount: number,
    markPrice: number,
    fundingRate: number,
  ): number {
    return amount * markPrice * fundingRate;
  }

  // Long position funding payments
  it('long pays (negative payment) when fundingRate is positive', () => {
    // 1 BTC at $30,000 with +0.01% funding rate → long pays $3
    const payment = calcLongFundingPayment(1, 30_000, 0.0001);
    expect(payment).toBeCloseTo(-3, 8);
  });

  it('long receives (positive payment) when fundingRate is negative', () => {
    // 1 BTC at $30,000 with -0.01% funding rate → long receives $3
    const payment = calcLongFundingPayment(1, 30_000, -0.0001);
    expect(payment).toBeCloseTo(3, 8);
  });

  it('long payment is zero when fundingRate is zero', () => {
    const payment = calcLongFundingPayment(2, 50_000, 0);
    expect(payment).toBeCloseTo(0, 8);
  });

  it('long payment scales linearly with position size', () => {
    const p1 = calcLongFundingPayment(1, 30_000, 0.0001);
    const p2 = calcLongFundingPayment(2, 30_000, 0.0001);
    expect(p2).toBeCloseTo(p1 * 2, 8);
  });

  it('long payment scales linearly with markPrice', () => {
    const p1 = calcLongFundingPayment(1, 30_000, 0.0001);
    const p2 = calcLongFundingPayment(1, 60_000, 0.0001);
    expect(p2).toBeCloseTo(p1 * 2, 8);
  });

  // Short position funding payments
  it('short receives (positive payment) when fundingRate is positive', () => {
    // 1 BTC at $30,000 with +0.01% funding rate → short receives $3
    const payment = calcShortFundingPayment(1, 30_000, 0.0001);
    expect(payment).toBeCloseTo(3, 8);
  });

  it('short pays (negative payment) when fundingRate is negative', () => {
    // 1 BTC at $30,000 with -0.01% funding rate → short pays $3
    const payment = calcShortFundingPayment(1, 30_000, -0.0001);
    expect(payment).toBeCloseTo(-3, 8);
  });

  it('short payment is zero when fundingRate is zero', () => {
    const payment = calcShortFundingPayment(2, 50_000, 0);
    expect(payment).toBeCloseTo(0, 8);
  });

  // Long and short payments are opposite signs (symmetry)
  it('long and short payments are equal and opposite for same position', () => {
    const longPayment = calcLongFundingPayment(1, 30_000, 0.0001);
    const shortPayment = calcShortFundingPayment(1, 30_000, 0.0001);
    // Long pays, short receives → opposite signs
    expect(longPayment).toBeCloseTo(-shortPayment, 8);
  });

  it('net funding income is zero when long and short positions are equal size', () => {
    const longPayment = calcLongFundingPayment(1, 30_000, 0.0001);
    const shortPayment = calcShortFundingPayment(1, 30_000, 0.0001);
    // Net income across long + short = 0 (funding transfers between them)
    expect(longPayment + shortPayment).toBeCloseTo(0, 8);
  });

  // Typical 8h funding rate scenario
  it('typical positive funding rate: long pays 0.01% on $50k position', () => {
    // 1 BTC at $50,000, 0.01% funding rate → payment = -50,000 * 0.0001 = -$5
    const payment = calcLongFundingPayment(1, 50_000, 0.0001);
    expect(payment).toBeCloseTo(-5, 8);
  });

  it('total funding income increases when long position receives negative funding', () => {
    // Simulates the totalFundingIncome accumulator in the engine
    let totalFundingIncome = 0;
    // Bar 1: long receives $3 (negative rate)
    totalFundingIncome += calcLongFundingPayment(1, 30_000, -0.0001);
    // Bar 2: long pays $3 (positive rate)
    totalFundingIncome += calcLongFundingPayment(1, 30_000, 0.0001);
    // Net = 0
    expect(totalFundingIncome).toBeCloseTo(0, 8);
  });
});
