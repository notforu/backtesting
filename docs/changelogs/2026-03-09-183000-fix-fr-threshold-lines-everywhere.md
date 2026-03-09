# Fix FR Threshold Lines for Aggregation & Paper Trading

**Date**: 2026-03-09 18:30
**Author**: claude-dev

## Summary

Fixed FR (funding rate) threshold lines not showing for aggregation backtests and paper trading sessions. Previously, threshold lines (horizontal dashed reference lines on the funding rate histogram) only appeared for simple non-aggregation backtests. Now they correctly display for all backtest types by reading thresholds from the appropriate strategy configuration level.

## Changed

- **App.tsx**: Updated aggregation backtest chart rendering to read FR thresholds from the correct sub-strategy params
- **PaperTradingPage.tsx**: Updated paper trading session chart rendering to use strategy default FR thresholds as fallback

## Fixed

- FR threshold lines now appear in aggregation backtest results when viewing individual assets
- FR threshold lines now appear in paper trading sessions, even when using percentile-based configs (FR V2)
- Fallback mechanism ensures thresholds display using strategy defaults when not explicitly configured

## Files Modified

- `src/web/App.tsx` - Added `useStrategy` import, created `activeSubStrategyName` memoized hook, implemented strategy defaults fallback for FR threshold props passed to `FundingRateHistogram`
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` - Added `useStrategy` import, created `activeSubForFR` memoized hook, implemented strategy defaults fallback in `frThresholds` computation

## Context

The issue occurred because:

1. **Aggregation backtests**: FR thresholds are stored per sub-strategy in `config.params.subStrategies[i].params`, but the code was only looking at `config.params` (top level)
2. **Paper trading**: When using percentile-based params (`shortPct`/`longPct`), the fixed `fundingThresholdShort/Long` values were not persisted to the session config, so the chart had no reference to display

Solution: Use the `useStrategy` hook to fetch strategy defaults and use them as fallback values, ensuring threshold lines always have something to display based on the active strategy definition.

## Notes

- Investigated Issue 2 (trades not showing for simple backtests) but could not reproduce. API correctly returns trades for simple backtests (verified with SMA crossover strategy: 102 trades on production). Frontend correctly passes trades to chart and table. May require more specific reproduction steps from user.
