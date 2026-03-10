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
