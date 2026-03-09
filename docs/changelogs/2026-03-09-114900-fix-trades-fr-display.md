# fix: trades display, FR threshold lines, and last FR value line

**Date**: 2026-03-09 11:49
**Author**: agent

## Summary
Fixed three display bugs in the backtesting dashboard: walk-forward trades not being saved to the database, FR threshold lines not showing in the backtesting view, and an unwanted horizontal line appearing at the last FR value.

## Fixed

1. **Walk-forward trades not saved to DB**
   - `WalkForwardResult` now includes optional `testTrades`, `testEquity`, and `testRollingMetrics` from the test period backtest
   - The walk-forward script's `buildBacktestResultFromWF()` now uses actual test trades/equity instead of empty arrays
   - Previously all walk-forward results were saved with `trades: []`, making them appear empty in the dashboard
   - Note: only affects future runs; existing DB entries need re-running to get trades

2. **FR threshold lines not showing in backtesting view**
   - Added `frShortThreshold` and `frLongThreshold` props to Chart component in both single-asset and multi-asset views
   - Values extracted from `currentResult.config.params.fundingThresholdShort` / `fundingThresholdLong`
   - Previously these were only wired up in the Paper Trading page

3. **Last FR value horizontal line removed**
   - Added `priceLineVisible: false` to FR histogram series options
   - This removes the unwanted horizontal line at the last funding rate value
   - `lastValueVisible: false` was already set but only hid the label, not the line

## Files Modified

- `src/core/walk-forward.ts` - Added test period data to WalkForwardResult
- `scripts/walk-forward-fr-v2.ts` - Updated buildBacktestResultFromWF() to include actual test trades/equity
- `src/web/App.tsx` - Added frShortThreshold and frLongThreshold props to Chart components
- `src/web/components/Chart/Chart.tsx` - Added priceLineVisible: false to FR histogram series

## Context

These bugs prevented users from seeing:
- Trade history in walk-forward test results
- FR threshold level lines in the main backtesting view (even though they were visible in paper trading)
- A spurious horizontal line at the last FR value that cluttered the chart

All three are now fixed and consistent across the dashboard views.
