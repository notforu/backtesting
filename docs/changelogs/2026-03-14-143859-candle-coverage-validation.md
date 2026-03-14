# Candle Coverage Validation

**Date**: 2026-03-14
**Type**: Enhancement / Bug Fix

## Summary

Added `validateCandleCoverage()` to catch stale or incomplete candle caches before a backtest runs, mirroring the existing `validateFundingRateCoverage()` pattern. Also fixed the aggregate engine silently skipping sub-strategies with no candle data.

## Changes

### `src/core/funding-rate-validation.ts`

New exports added (file module comment updated to reflect dual responsibility):

- **`parseTimeframeToMs(timeframe)`** - Converts a timeframe string (`'1m'`, `'5m'`, `'1h'`, `'4h'`, `'1d'`, `'1w'`, …) to milliseconds. Returns `undefined` for unrecognised strings.
- **`expectedCandleCount(timeframe, startDate, endDate)`** - Calculates the expected number of candles for a date range. Returns `0` for unknown timeframes (validation is a no-op).
- **`validateCandleCoverage(candleCount, symbol, exchange, timeframe, startDate, endDate, skipValidation?)`** - Throws a descriptive error when actual candle count is below 80% of expected, including the exact `cache-candles.ts` CLI command to fix the issue.

### `src/core/aggregate-engine.ts`

- **Throw instead of skip**: Empty candle arrays (`candles.length === 0`) now throw with a descriptive error and cache command instead of logging a warning and silently continuing.
- **Coverage check**: After loading candles for each sub-strategy, `validateCandleCoverage()` is called to enforce the 80% threshold.
- **New config field**: `AggregateEngineConfig.skipCandleValidation?: boolean` — skips candle validation (parallel to existing `skipFundingRateValidation`).

### `src/core/engine.ts`

- **Coverage check**: After loading candles (and after the existing empty-candles guard), `validateCandleCoverage()` is called.
- **New config field**: `EngineConfig.skipCandleValidation?: boolean` — skips candle validation for tests and scripts using synthetic/partial data.

### `src/core/__tests__/funding-rate-validation.test.ts`

Added **46 new tests** (54 total, all passing) covering:

- `parseTimeframeToMs`: known timeframes, unknown formats, edge cases
- `expectedCandleCount`: 4h/2yr scenario, 1d/1d, unknown timeframe, zero-length range
- `validateCandleCoverage — passes`: 100%, 80% boundary, unknown timeframe, zero range
- `validateCandleCoverage — throws`: below 79%, zero candles, error message content (symbol, timeframe, exchange, counts, percentage, cache command, from/to dates)
- `validateCandleCoverage — skipValidation`: true skips, false/undefined enforces

## Error Format

```
Insufficient candle data for BTC/USDT (4h) on bybit: got 120 candles, expected ~180 (66.7% coverage).
Cache candles first using: npx tsx scripts/cache-candles.ts --exchange=bybit --symbols=BTC/USDT --timeframes=4h --from=2024-01-01 --to=2024-01-31
```

## Backward Compatibility

Existing tests and scripts using synthetic candle data must pass `skipCandleValidation: true` in engine config if their candle count falls below 80% of the expected range. The aggregate engine tests already use `skipFundingRateValidation: true` — a corresponding `skipCandleValidation: true` is needed where candle data is sparse.
