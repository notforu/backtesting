# Fix Resolved Params and Trades Persistence

**Date**: 2026-03-09 19:30
**Author**: claude-code

## Summary

Fixed critical bugs where the backtest engine stored only user-provided params instead of fully resolved params (merged with strategy defaults), preventing the frontend from reading FR threshold values. Also simplified FR threshold line logic by removing API fallback in favor of direct params reading. Re-ran affected NEAR/USDT backtest to verify trades are properly saved.

## Changed

- **Engine params storage**: All three engine variants (single, pairs, aggregate) now store the fully resolved params (after `validateStrategyParams()` merges user input with strategy defaults) in backtest results
- **Signal adapter visibility**: Made `params` field public readonly to allow aggregate engine to read resolved sub-strategy params
- **API fallback removal**: Removed `useStrategy()` fallback for FR threshold defaults—thresholds now read directly from `config.params`

## Fixed

- **Empty params bug**: Backtests with `params: {}` (using all defaults) now store complete resolved params with all defaults merged in
- **FR threshold lines**: Frontend can now directly read `fundingThresholdLong` and `fundingThresholdShort` from backtest config, no API call needed
- **Trades not persisting**: Re-ran NEAR/USDT backtest (run 69112517) with fixed engine—now shows 12 trades properly saved

## Files Modified

- `src/core/engine.ts` - Changed `config: validatedConfig` to spread resolved params into result
- `src/core/pairs-engine.ts` - Same fix for pairs engine
- `src/core/aggregate-engine.ts` - Sub-strategy params now use resolved params from `SignalAdapter.params`
- `src/core/signal-adapter.ts` - Made `params` field public readonly
- `src/web/App.tsx` - Removed `useStrategy` import and fallback logic
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` - Removed `useStrategy` fallback

## Context

The original implementation only persisted user-provided params (e.g., `params: {}` if user didn't override anything), losing strategy defaults like FR thresholds. This broke chart rendering logic that needed threshold values to draw guidance lines. The fix ensures all params are fully resolved before saving, making the backtest result self-contained and eliminating runtime API dependencies for reading strategy configuration.
