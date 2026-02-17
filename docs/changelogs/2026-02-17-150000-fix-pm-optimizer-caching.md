# Fix PM Optimizer Caching (Critical)

**Date**: 2026-02-17 15:00
**Type**: Bug Fix

## Summary

Fixed critical bug in PM optimizer that caused re-fetching candle data from the Polymarket API for every parameter combination instead of using cached data. Optimization times reduced from 40+ minutes (failing at 20-40% progress) to ~2 minutes (completing successfully).

## Root Cause

The `fetchOrLoadCandles()` function checked cache validity using:
- `cachedRange.start <= startDate`
- `cachedRange.end >= endDate`

For Polymarket markets, this always failed because:
- `startDate` was set wide (e.g., 2025-01-01) but PM data starts at market creation (e.g., 2025-11-24)
- `endDate` was set to far future (e.g., 2026-12-31) but data only exists through today (2026-02-17)
- Both checks failed → API re-fetch on every combination

## Fix

Added PM-aware cache logic that checks `cachedRange.end >= Date.now() - 7 days` (data is recent) instead of checking against impossible future dates. Applied to both:
- `src/core/engine.ts`
- `src/core/optimizer.ts`

## Impact

- Optimization time per market: 40+ minutes → ~2 minutes
- All 4 walk-forward survivor optimizations now complete successfully
- Grid search now respects candle cache across parameter iterations

## Results: 4 WF Survivors

- **CBOE Sports**: Sharpe 15.70, 151 trades, 78% WR, 1.4% max DD
- **Fields Medal**: Sharpe 14.73, 39 trades, 100% WR, 6.6% max DD
- **Petr Yan**: Sharpe 7.57, 13 trades, 100% WR, 4.1% max DD
- **Zcash $600**: Sharpe 5.41, 36 trades, 81% WR, 30.5% max DD

## Removed: Paper Trading Module

Deleted `/workspace/src/paper-trading/` and `/workspace/scripts/pm-paper-trade.ts`. Will be redesigned as a generic modular solution (datasource → signal → executor pattern) applicable to all strategy types, not limited to PM.

## Files Modified

- `src/core/engine.ts` - PM-aware cache validation logic
- `src/core/optimizer.ts` - PM-aware cache validation logic

## Context

The PM optimizer was unusable due to API rate limits and long fetch times. This fix enables practical PM strategy optimization by leveraging cached data within a reasonable time window (7 days), which covers all relevant historical data since PM markets only produce data from their creation date forward.
