# Funding Rate Validation for Backtesting Engine

**Date**: 2026-03-14
**Type**: Feature / Bug prevention

## Summary

Added validation that fails fast with a descriptive error when funding rate data is missing or insufficient before running a futures-mode backtest. Previously the engine silently ran with incomplete data, producing misleading results because funding payments were simply skipped for uncached intervals.

## Changes

### New file: `src/core/funding-rate-validation.ts`

Standalone validation utility with exported functions and constants:

- `MIN_FUNDING_RATE_COVERAGE = 0.8` — minimum required coverage (80%)
- `FUNDING_RATE_INTERVAL_MS` — standard 8-hour funding interval in ms
- `expectedFundingRateCount(startDate, endDate)` — calculates expected record count
- `validateFundingRateCoverage(rates, symbol, exchange, startDate, endDate, skipValidation?)` — throws if coverage < 80%

Error message format includes the exact cache command to resolve the issue:
```
Insufficient funding rate data for BTC/USDT: got 10 records, expected ~90 (11.1% coverage). Cache funding rates first using: npx tsx scripts/cache-funding-rates.ts --exchange=bybit --symbols=BTC/USDT --from=2024-01-01 --to=2024-03-31
```

### `src/core/engine.ts`

- Added `skipFundingRateValidation?: boolean` to `EngineConfig` interface
- Added validation call after funding rates are loaded in futures mode

### `src/core/aggregate-engine.ts`

- Added `skipFundingRateValidation?: boolean` to `AggregateEngineConfig` interface
- Added validation call per sub-strategy after funding rates are loaded in futures mode
- If ANY sub-strategy has insufficient data, throws immediately with the specific symbol

### New test file: `src/core/__tests__/funding-rate-validation.test.ts`

20 tests covering:
- `expectedFundingRateCount` for various date ranges
- Passing cases: 100% coverage, exactly 80%, just above 80%, short date range (expected = 0)
- Failing cases: 79% coverage, 0 records, correct symbol/exchange in error, correct counts, correct dates
- `skipValidation` flag: bypasses check when true, enforces when false or undefined

## Behavior

- Only applies when `mode === 'futures'` — spot backtests are unaffected
- Pre-loaded funding rates (optimizer path) are validated the same way
- `skipFundingRateValidation: true` bypasses the check — for tests and one-time scripts on synthetic data
- Threshold is 80%: allows up to 20% gaps (newly listed symbols, exchange maintenance windows)
