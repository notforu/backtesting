/**
 * Tests for funding rate validation utilities.
 *
 * Covers:
 * - expectedFundingRateCount: correct count for various date ranges
 * - validateFundingRateCoverage: throws when coverage < 80%, passes when >= 80%
 * - skipValidation: bypasses the check entirely
 * - Error message content: descriptive with symbol, exchange, cache command
 */

import { describe, it, expect } from 'vitest';
import {
  expectedFundingRateCount,
  validateFundingRateCoverage,
  MIN_FUNDING_RATE_COVERAGE,
  FUNDING_RATE_INTERVAL_MS,
  parseTimeframeToMs,
  expectedCandleCount,
  validateCandleCoverage,
} from '../funding-rate-validation.js';
import type { FundingRate } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Build N stub funding rate records. Timestamps do not matter for coverage checks. */
function makeFundingRates(count: number): FundingRate[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * FUNDING_RATE_INTERVAL_MS,
    fundingRate: 0.0001,
  }));
}

/** 30-day range in milliseconds */
const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const START = 1_700_000_000_000; // arbitrary fixed start
const END_30D = START + THIRTY_DAYS_MS;

// ============================================================================
// expectedFundingRateCount
// ============================================================================

describe('expectedFundingRateCount', () => {
  it('returns ~90 for a 30-day range (30 * 3 records/day = 90)', () => {
    const count = expectedFundingRateCount(START, END_30D);
    // 30 days * 24h / 8h = 90
    expect(count).toBe(90);
  });

  it('returns 3 for a 24-hour range (3 funding events per day)', () => {
    const oneDayMs = 24 * 3600 * 1000;
    const count = expectedFundingRateCount(0, oneDayMs);
    expect(count).toBe(3);
  });

  it('returns 1 for an 8-hour range (exactly one interval)', () => {
    const count = expectedFundingRateCount(0, FUNDING_RATE_INTERVAL_MS);
    expect(count).toBe(1);
  });

  it('returns 0 when range is shorter than one funding interval', () => {
    const count = expectedFundingRateCount(0, FUNDING_RATE_INTERVAL_MS - 1);
    expect(count).toBe(0);
  });

  it('returns 0 when start equals end', () => {
    expect(expectedFundingRateCount(START, START)).toBe(0);
  });
});

// ============================================================================
// validateFundingRateCoverage — happy paths
// ============================================================================

describe('validateFundingRateCoverage — passes', () => {
  it('does not throw when coverage is 100%', () => {
    const rates = makeFundingRates(90); // 100% of 90 expected
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D),
    ).not.toThrow();
  });

  it('does not throw when coverage is exactly 80% (boundary)', () => {
    const expected = expectedFundingRateCount(START, END_30D); // 90
    const rates = makeFundingRates(Math.ceil(expected * MIN_FUNDING_RATE_COVERAGE)); // 72
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D),
    ).not.toThrow();
  });

  it('does not throw for a very short range where expected count is 0', () => {
    // Range shorter than one funding interval — expected = 0, validation skipped
    const rates = makeFundingRates(0);
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, START + 1000),
    ).not.toThrow();
  });

  it('does not throw when coverage is above 80% (e.g. 85%)', () => {
    const rates = makeFundingRates(77); // 77/90 ≈ 85.6%
    expect(() =>
      validateFundingRateCoverage(rates, 'ETH/USDT', 'binance', START, END_30D),
    ).not.toThrow();
  });
});

// ============================================================================
// validateFundingRateCoverage — failures
// ============================================================================

describe('validateFundingRateCoverage — throws', () => {
  it('throws when coverage is 79% (just below threshold)', () => {
    const expected = expectedFundingRateCount(START, END_30D); // 90
    const rates = makeFundingRates(Math.floor(expected * 0.79)); // 71
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D),
    ).toThrow(/Insufficient funding rate data/);
  });

  it('throws when there are 0 records', () => {
    expect(() =>
      validateFundingRateCoverage([], 'BTC/USDT', 'bybit', START, END_30D),
    ).toThrow(/Insufficient funding rate data/);
  });

  it('throws with the symbol in the error message', () => {
    expect(() =>
      validateFundingRateCoverage([], 'ETH/USDT', 'bybit', START, END_30D),
    ).toThrow(/ETH\/USDT/);
  });

  it('throws with actual and expected counts in the error message', () => {
    const rates = makeFundingRates(10); // way below 80% of 90
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D),
    ).toThrow(/got 10 records, expected ~90/);
  });

  it('throws with the coverage percentage in the error message', () => {
    const rates = makeFundingRates(45); // 50% of 90
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D),
    ).toThrow(/50\.0% coverage/);
  });

  it('throws with the cache command including exchange and symbol', () => {
    expect(() =>
      validateFundingRateCoverage([], 'SOL/USDT', 'bybit', START, END_30D),
    ).toThrow(/--exchange=bybit.*--symbols=SOL\/USDT/);
  });

  it('throws with from/to dates in the cache command', () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    const end = new Date('2024-03-31T00:00:00Z').getTime();
    expect(() =>
      validateFundingRateCoverage([], 'BTC/USDT', 'bybit', start, end),
    ).toThrow(/--from=2024-01-01.*--to=2024-03-31/);
  });
});

// ============================================================================
// validateFundingRateCoverage — skipValidation flag
// ============================================================================

describe('validateFundingRateCoverage — skipValidation', () => {
  it('does not throw when skipValidation is true and there are 0 records', () => {
    expect(() =>
      validateFundingRateCoverage([], 'BTC/USDT', 'bybit', START, END_30D, true),
    ).not.toThrow();
  });

  it('does not throw when skipValidation is true even with 1% coverage', () => {
    const rates = makeFundingRates(1); // 1/90 ≈ 1.1%
    expect(() =>
      validateFundingRateCoverage(rates, 'BTC/USDT', 'bybit', START, END_30D, true),
    ).not.toThrow();
  });

  it('still validates when skipValidation is false (explicit false)', () => {
    expect(() =>
      validateFundingRateCoverage([], 'BTC/USDT', 'bybit', START, END_30D, false),
    ).toThrow(/Insufficient funding rate data/);
  });

  it('still validates when skipValidation is undefined (default)', () => {
    expect(() =>
      validateFundingRateCoverage([], 'BTC/USDT', 'bybit', START, END_30D, undefined),
    ).toThrow(/Insufficient funding rate data/);
  });
});

// ============================================================================
// parseTimeframeToMs
// ============================================================================

describe('parseTimeframeToMs', () => {
  it('returns 60000 for 1m', () => {
    expect(parseTimeframeToMs('1m')).toBe(60_000);
  });

  it('returns 300000 for 5m', () => {
    expect(parseTimeframeToMs('5m')).toBe(300_000);
  });

  it('returns 900000 for 15m', () => {
    expect(parseTimeframeToMs('15m')).toBe(900_000);
  });

  it('returns 3600000 for 1h', () => {
    expect(parseTimeframeToMs('1h')).toBe(3_600_000);
  });

  it('returns 14400000 for 4h', () => {
    expect(parseTimeframeToMs('4h')).toBe(14_400_000);
  });

  it('returns 86400000 for 1d', () => {
    expect(parseTimeframeToMs('1d')).toBe(86_400_000);
  });

  it('returns 604800000 for 1w', () => {
    expect(parseTimeframeToMs('1w')).toBe(7 * 86_400_000);
  });

  it('returns undefined for unknown timeframe', () => {
    expect(parseTimeframeToMs('2y')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseTimeframeToMs('')).toBeUndefined();
  });

  it('returns undefined for malformed string', () => {
    expect(parseTimeframeToMs('4hours')).toBeUndefined();
  });
});

// ============================================================================
// expectedCandleCount
// ============================================================================

describe('expectedCandleCount', () => {
  it('returns ~4380 for 4h timeframe over 2 years', () => {
    const twoYearsMs = 2 * 365 * 24 * 3600 * 1000;
    const count = expectedCandleCount('4h', 0, twoYearsMs);
    // 2 * 365 * 24 / 4 = 4380
    expect(count).toBe(4380);
  });

  it('returns 6 for 4h timeframe over 24 hours', () => {
    const oneDayMs = 24 * 3600 * 1000;
    expect(expectedCandleCount('4h', 0, oneDayMs)).toBe(6);
  });

  it('returns 1 for 1d timeframe over exactly one day', () => {
    const oneDayMs = 24 * 3600 * 1000;
    expect(expectedCandleCount('1d', 0, oneDayMs)).toBe(1);
  });

  it('returns 0 for unknown timeframe', () => {
    expect(expectedCandleCount('2y', 0, 86_400_000)).toBe(0);
  });

  it('returns 0 when range is shorter than one candle interval', () => {
    expect(expectedCandleCount('4h', 0, 14_400_000 - 1)).toBe(0);
  });

  it('returns 0 when start equals end', () => {
    expect(expectedCandleCount('1h', START, START)).toBe(0);
  });
});

// ============================================================================
// validateCandleCoverage — happy paths
// ============================================================================

describe('validateCandleCoverage — passes', () => {
  // 30 days / 4h = 180 expected candles
  const THIRTY_DAYS_4H_EXPECTED = (30 * 24) / 4; // 180

  it('does not throw when coverage is 100%', () => {
    expect(() =>
      validateCandleCoverage(180, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).not.toThrow();
  });

  it('does not throw when coverage is exactly 80% (boundary)', () => {
    const minCount = Math.ceil(THIRTY_DAYS_4H_EXPECTED * MIN_FUNDING_RATE_COVERAGE); // 144
    expect(() =>
      validateCandleCoverage(minCount, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).not.toThrow();
  });

  it('does not throw for unknown timeframe (expected = 0)', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '2y', START, END_30D),
    ).not.toThrow();
  });

  it('does not throw for zero-length range (expected = 0)', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, START),
    ).not.toThrow();
  });

  it('does not throw when coverage is above 80% (e.g. 90%)', () => {
    const count = Math.ceil(THIRTY_DAYS_4H_EXPECTED * 0.9); // 162
    expect(() =>
      validateCandleCoverage(count, 'ETH/USDT', 'bybit', '4h', START, END_30D),
    ).not.toThrow();
  });
});

// ============================================================================
// validateCandleCoverage — failures
// ============================================================================

describe('validateCandleCoverage — throws', () => {
  it('throws when coverage is 79% (just below threshold)', () => {
    const expected = expectedCandleCount('4h', START, END_30D); // 180
    const count = Math.floor(expected * 0.79); // 142
    expect(() =>
      validateCandleCoverage(count, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/Insufficient candle data/);
  });

  it('throws when there are 0 candles for a real range', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/Insufficient candle data/);
  });

  it('throws with symbol in the error message', () => {
    expect(() =>
      validateCandleCoverage(0, 'ETH/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/ETH\/USDT/);
  });

  it('throws with timeframe in the error message', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/4h/);
  });

  it('throws with exchange in the error message', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'binance', '4h', START, END_30D),
    ).toThrow(/binance/);
  });

  it('throws with actual and expected counts in the error message', () => {
    expect(() =>
      validateCandleCoverage(10, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/got 10 candles, expected ~180/);
  });

  it('throws with the coverage percentage in the error message', () => {
    // 90/180 = 50%
    expect(() =>
      validateCandleCoverage(90, 'BTC/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/50\.0% coverage/);
  });

  it('throws with the cache command including exchange, symbol, and timeframe', () => {
    expect(() =>
      validateCandleCoverage(0, 'SOL/USDT', 'bybit', '4h', START, END_30D),
    ).toThrow(/--exchange=bybit.*--symbols=SOL\/USDT.*--timeframes=4h/);
  });

  it('throws with from/to dates in the cache command', () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    const end = new Date('2024-03-31T00:00:00Z').getTime();
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', start, end),
    ).toThrow(/--from=2024-01-01.*--to=2024-03-31/);
  });
});

// ============================================================================
// validateCandleCoverage — skipValidation flag
// ============================================================================

describe('validateCandleCoverage — skipValidation', () => {
  it('does not throw when skipValidation is true and there are 0 candles', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, END_30D, true),
    ).not.toThrow();
  });

  it('does not throw when skipValidation is true even with 1% coverage', () => {
    expect(() =>
      validateCandleCoverage(2, 'BTC/USDT', 'bybit', '4h', START, END_30D, true),
    ).not.toThrow();
  });

  it('still validates when skipValidation is false (explicit false)', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, END_30D, false),
    ).toThrow(/Insufficient candle data/);
  });

  it('still validates when skipValidation is undefined (default)', () => {
    expect(() =>
      validateCandleCoverage(0, 'BTC/USDT', 'bybit', '4h', START, END_30D, undefined),
    ).toThrow(/Insufficient candle data/);
  });
});
