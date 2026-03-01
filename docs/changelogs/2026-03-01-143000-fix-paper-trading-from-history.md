# Fix: Paper trading session creation from aggregation history runs

**Date**: 2026-03-01 14:30
**Author**: team

## Summary

Fixed paper trading session creation from aggregation backtest history runs. Previously, ad-hoc aggregation runs (those without a saved aggregation config) would fail with a 400 error because the frontend couldn't determine which configuration to use. Now the system can reconstruct the full configuration from the stored backtest run data.

## Changed

- Enhanced paper trading session creation to accept `backtestRunId` as a valid option alongside `aggregationConfigId` and `strategyConfig`
- When creating a session from history, the system now reconstructs the full configuration from the stored backtest run

## Added

- `backtestRunId` field in `CreatePaperSessionRequest` interface
- Support for loading complete aggregation configuration from stored backtest runs
- Storage of full sub-strategy `params` and `exchange` in aggregation engine config (previously only stored `strategyName`, `symbol`, `timeframe`)

## Fixed

- Paper trading session creation from ad-hoc aggregation runs (400 error)
- Ad-hoc run warning message changed from amber (error) to neutral info tone since it's now supported

## Files Modified

- `src/api/routes/paper-trading.ts` - Added `backtestRunId` handling in CreateSessionSchema, loads and reconstructs AggregateBacktestConfig from database
- `src/core/aggregate-engine.ts` - Enhanced saved config to include full sub-strategy `params` and `exchange`
- `src/web/types.ts` - Added `backtestRunId` to CreatePaperSessionRequest
- `src/web/components/PaperTradingPanel/CreatePaperSessionModal.tsx` - Updated submission logic to send `backtestRunId` fallback and improved UI messaging

## Context

Previously, only two paths were supported for creating a paper trading session:
1. From a saved aggregation config (has `aggregationConfigId`)
2. From manual strategy selection (has `strategyConfig`)

Ad-hoc aggregation runs (backtest runs not tied to a saved config) fell through both paths, causing a validation error. By accepting `backtestRunId`, the system can now look up the original run and reconstruct its full configuration, enabling seamless session creation from any backtest history.

This improves the user experience for exploratory backtesting workflows where users quickly test aggregations without saving configs.
