# Fix Aggregate Engine Per-Asset Equity Bugs

**Date**: 2026-03-12 14:00
**Author**: docs-writer

## Summary

Fixed two critical bugs in the aggregate engine's per-asset equity tracking that caused per-asset max drawdown calculations to exceed 100% and per-asset performance metrics to be overstated. Added comprehensive test coverage and new analysis scripts for aggregation optimization.

## Changed

- `src/core/aggregate-engine.ts` - Fixed per-asset equity baseline and fee deduction logic
- Added tracking of actual capital allocated per symbol to prevent equity baseline errors
- Per-asset equity now correctly reflects the capital actually invested in each asset

## Added

- `src/core/__tests__/aggregate-engine-bugs.test.ts` - 10 new tests covering both equity bugs across single-asset, multi-asset with equal split, and capital-weighted allocation modes
- `scripts/analyze-aggregations.ts` - Analyzes all saved aggregation backtest runs, identifies poor performers, and ranks by Sharpe ratio
- `scripts/create-configs-from-standalone.ts` - Creates aggregation configs from best standalone strategy runs with configurable symbol count and auto-pruning
- `scripts/prune-aggregations.ts` - Runs saved aggregation configs, identifies and removes poor performers, and compares performance before/after pruning

## Fixed

### Bug 1: Per-Asset Max Drawdown >100% (Critical)
- **Issue**: Per-asset equity curves started at full portfolio `initialCapital` instead of the capital actually allocated to that specific asset
- **Impact**: Drawdown calculations could exceed 100%, which is mathematically impossible
- **Root Cause**: No tracking of actual capital allocation per symbol
- **Fix**: Added `perSymbolAllocatedCapital` map to track the capital allocated to each symbol on first trade, then use this as the baseline for per-asset equity curve calculations

### Bug 2: Entry Fee Not Deducted in Per-Asset Equity (Data Integrity)
- **Issue**: When opening positions, entry fees were not subtracted from per-asset `realizedEquity`
- **Impact**: Per-asset performance metrics were slightly overstated
- **Root Cause**: Fee handling was only done for portfolio-level equity, not per-asset
- **Fix**: Subtract `trade.fee` from per-asset `realizedEquity` when processing OPEN_LONG/OPEN_SHORT trades, mirroring the portfolio-level fee handling

## Files Modified

- `src/core/aggregate-engine.ts` - Per-asset equity tracking fixes
- `src/core/__tests__/aggregate-engine-bugs.test.ts` - New comprehensive test suite

## Files Added

- `scripts/analyze-aggregations.ts`
- `scripts/create-configs-from-standalone.ts`
- `scripts/prune-aggregations.ts`

## Context

These bugs were discovered during aggregation strategy optimization. The per-asset drawdown bug caused unrealistic (>100%) drawdown readings that made it impossible to compare per-asset performance accurately. The fee bug, while smaller in impact, meant per-asset returns in multi-asset portfolios were overstated by not accounting for entry costs.

The new scripts enable systematic analysis and optimization of aggregation configs by:
1. Finding which standalone strategies work best
2. Creating multi-asset aggregation configs from top performers
3. Testing aggregations and identifying which ones work vs. which underperform
4. Pruning poor-performing symbols from aggregation configs

This supports the broader goal of building optimal multi-asset portfolios from proven single-asset strategies.
