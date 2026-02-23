# Fix: Per-asset Dashboard metrics showing wrong values

**Date**: 2026-02-22 04:15
**Author**: dev-team

## Summary
Fixed a bug where the Dashboard displayed incorrect metrics when selecting an asset tab in multi-asset or aggregate backtest results. Portfolio-level metrics were bleeding through to per-asset views, showing confusing mixed values like "Total Trades: 0, Profit Factor: 1.19 (from portfolio)".

## Problem
When switching asset tabs on the Dashboard after a multi-asset backtest:
- Some fields showed 0 (totalTrades, winRate) because they weren't computed for that asset
- Other fields showed portfolio-level values (profitFactor: 1.19, maxDrawdown: -20.30%) because the code spread all portfolio metrics as a base
- This created a confusing mix of per-asset and portfolio values in a single view

Root cause: Dashboard code spread portfolio-level metrics (`...currentResult.metrics`) as the base object, then selectively overrode a few fields with per-asset values. Non-overridden fields leaked through from the portfolio.

## Fixed
- Primary path (fresh aggregate runs): Now uses `currentResult.perAssetResults[symbol].metrics` directly when available, which contains complete properly-computed per-asset metrics
- Fallback path (loading from history): Builds clean per-asset metrics from `perAssetSummary` WITHOUT spreading portfolio-level metrics. Unknown fields default to 0 instead of leaking portfolio values
- Per-asset views now show consistent, correct metrics for each asset

## Changed
- Dashboard correctly isolates per-asset metrics from portfolio-level metrics
- No more cross-contamination between portfolio and per-asset views

## Files Modified
- `src/web/App.tsx` - Fixed `getDisplayMetrics()` function to properly isolate per-asset vs portfolio metrics

## Context
With the multi-asset portfolio feature, it's critical that per-asset views show accurate asset-specific metrics, not a mix of portfolio and per-asset values. This fix ensures the Dashboard accurately reflects what happened to each individual asset in the backtest.
