# Long/Short PnL Breakdown in Performance Metrics

**Date**: 2026-03-16 06:50

## Summary

Added 6 new optional fields to `PerformanceMetrics` that break down trade performance by direction (long vs. short). These fields are computed in `calculateMetrics()` and apply to both single-strategy and aggregation backtests.

## New Fields

Added to `PerformanceMetricsSchema` in `src/core/types.ts`:

| Field | Type | Description |
|---|---|---|
| `longPnl` | `number?` | Sum of PnL from all `CLOSE_LONG` trades |
| `shortPnl` | `number?` | Sum of PnL from all `CLOSE_SHORT` trades |
| `longTrades` | `number?` | Count of `CLOSE_LONG` trades |
| `shortTrades` | `number?` | Count of `CLOSE_SHORT` trades |
| `longWinRate` | `number?` | Win rate % for long trades only |
| `shortWinRate` | `number?` | Win rate % for short trades only |

## Files Changed

- `src/core/types.ts` — added 6 fields to `PerformanceMetricsSchema`
- `src/analysis/metrics.ts` — compute breakdown after main calculations; include in return object and zero-trade early return
- `src/analysis/__tests__/metrics.test.ts` — 6 new test cases covering: no trades, only longs, only shorts, mixed, all-win-long/all-loss-short, partial win rates on both sides

## Tests

All 80 tests pass (`npm run vitest run`). TypeScript compiles without errors.
