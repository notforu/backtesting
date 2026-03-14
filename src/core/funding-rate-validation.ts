/**
 * Funding Rate and Candle Data Validation
 *
 * Utilities for validating that sufficient funding rate and candle data exists
 * before running a backtest. Missing or sparse data leads to misleading
 * backtest results because bars and funding payments are silently skipped.
 */

import type { FundingRate } from './types.js';

/**
 * Minimum fraction of expected funding rate records that must be present.
 * Below this threshold, the validation throws an error.
 * 0.8 = 80% coverage required.
 */
export const MIN_FUNDING_RATE_COVERAGE = 0.8;

/**
 * Standard funding rate interval in milliseconds (8 hours).
 * Most perpetual futures exchanges (Binance, Bybit, OKX) settle funding every 8h.
 */
export const FUNDING_RATE_INTERVAL_MS = 8 * 3600 * 1000;

/**
 * Calculate the expected number of funding rate records for a given date range.
 * Uses the standard 8-hour funding interval.
 *
 * @param startDate - Start of the range in Unix ms
 * @param endDate - End of the range in Unix ms
 * @returns Expected number of funding rate records
 */
export function expectedFundingRateCount(startDate: number, endDate: number): number {
  return Math.floor((endDate - startDate) / FUNDING_RATE_INTERVAL_MS);
}

/**
 * Validate that funding rate data has sufficient coverage for a backtest.
 *
 * Compares the actual number of funding rate records against the expected count
 * for the date range. Throws a descriptive error if coverage is below
 * MIN_FUNDING_RATE_COVERAGE (80%), with instructions on how to cache the data.
 *
 * No-op if skipValidation is true (useful for tests and scripts that operate
 * on synthetic or partial data).
 *
 * @param fundingRates - Array of funding rate records that were loaded
 * @param symbol - Trading symbol (e.g. "BTC/USDT")
 * @param exchange - Exchange name (e.g. "bybit")
 * @param startDate - Backtest start date in Unix ms
 * @param endDate - Backtest end date in Unix ms
 * @param skipValidation - When true, skip the validation entirely (default: false)
 * @throws Error if coverage is below MIN_FUNDING_RATE_COVERAGE
 */
export function validateFundingRateCoverage(
  fundingRates: FundingRate[],
  symbol: string,
  exchange: string,
  startDate: number,
  endDate: number,
  skipValidation?: boolean,
): void {
  if (skipValidation) return;

  const actual = fundingRates.length;
  const expected = expectedFundingRateCount(startDate, endDate);

  // Avoid division by zero for very short date ranges
  if (expected === 0) return;

  const coverage = actual / expected;

  if (coverage < MIN_FUNDING_RATE_COVERAGE) {
    const pct = (coverage * 100).toFixed(1);
    const fromDate = new Date(startDate).toISOString().split('T')[0];
    const toDate = new Date(endDate).toISOString().split('T')[0];

    throw new Error(
      `Insufficient funding rate data for ${symbol}: got ${actual} records, expected ~${expected} (${pct}% coverage). ` +
      `Cache funding rates first using: npx tsx scripts/cache-funding-rates.ts --exchange=${exchange} --symbols=${symbol} --from=${fromDate} --to=${toDate}`,
    );
  }
}

// ============================================================================
// Candle Coverage Validation
// ============================================================================

/**
 * Parse a timeframe string into milliseconds.
 * Returns undefined for unrecognised timeframes.
 *
 * Supported: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w
 */
export function parseTimeframeToMs(timeframe: string): number | undefined {
  const match = timeframe.match(/^(\d+)([mhdw])$/);
  if (!match) return undefined;

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'm': return amount * 60 * 1000;
    case 'h': return amount * 3600 * 1000;
    case 'd': return amount * 86400 * 1000;
    case 'w': return amount * 7 * 86400 * 1000;
    default:  return undefined;
  }
}

/**
 * Calculate the expected number of candles for a given date range and timeframe.
 *
 * @param timeframe - Timeframe string (e.g. '4h', '1d')
 * @param startDate - Start of the range in Unix ms
 * @param endDate - End of the range in Unix ms
 * @returns Expected candle count, or 0 if timeframe is unrecognised
 */
export function expectedCandleCount(
  timeframe: string,
  startDate: number,
  endDate: number,
): number {
  const tfMs = parseTimeframeToMs(timeframe);
  if (!tfMs) return 0;
  return Math.floor((endDate - startDate) / tfMs);
}

/**
 * Validate that candle data has sufficient coverage for a backtest.
 *
 * Compares the actual number of candles against the expected count for the
 * date range and timeframe. Throws a descriptive error if coverage is below
 * MIN_FUNDING_RATE_COVERAGE (80%), with instructions on how to cache the data.
 *
 * No-op if:
 * - skipValidation is true (useful for tests and scripts on synthetic data)
 * - expected candle count is 0 (unrecognised timeframe or zero-length range)
 *
 * @param candleCount - Number of candles that were loaded
 * @param symbol - Trading symbol (e.g. "BTC/USDT")
 * @param exchange - Exchange name (e.g. "bybit")
 * @param timeframe - Candle timeframe (e.g. "4h")
 * @param startDate - Backtest start date in Unix ms
 * @param endDate - Backtest end date in Unix ms
 * @param skipValidation - When true, skip the validation entirely (default: false)
 * @throws Error if coverage is below MIN_FUNDING_RATE_COVERAGE
 */
export function validateCandleCoverage(
  candleCount: number,
  symbol: string,
  exchange: string,
  timeframe: string,
  startDate: number,
  endDate: number,
  skipValidation?: boolean,
): void {
  if (skipValidation) return;

  const expected = expectedCandleCount(timeframe, startDate, endDate);

  // Avoid division by zero for very short date ranges or unknown timeframes
  if (expected === 0) return;

  const coverage = candleCount / expected;

  if (coverage < MIN_FUNDING_RATE_COVERAGE) {
    const pct = (coverage * 100).toFixed(1);
    const fromDate = new Date(startDate).toISOString().split('T')[0];
    const toDate = new Date(endDate).toISOString().split('T')[0];

    throw new Error(
      `Insufficient candle data for ${symbol} (${timeframe}) on ${exchange}: ` +
      `got ${candleCount} candles, expected ~${expected} (${pct}% coverage). ` +
      `Cache candles first using: npx tsx scripts/cache-candles.ts --exchange=${exchange} --symbols=${symbol} --timeframes=${timeframe} --from=${fromDate} --to=${toDate}`,
    );
  }
}
