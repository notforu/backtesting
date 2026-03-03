# Fix: Paper Trading Session Creation for Ad-hoc Aggregation Runs

**Date:** 2026-03-01
**Type:** Bug Fix

## Problem

Paper trading session creation failed when launching from a history run that was an ad-hoc aggregation backtest (no saved aggregation config). The error was:

```
Either aggregationConfigId or strategyConfig is required
```

The frontend sent `aggregationConfigId: selectedHistoryRun.aggregationId`, but ad-hoc aggregation runs have no `aggregationId`, leaving both `aggregationConfigId` and `strategyConfig` undefined.

## Changes

### `src/core/aggregate-engine.ts`

The result config's `subStrategies` array now stores the full sub-strategy configuration including `params` and `exchange` fields (previously only `strategyName`, `symbol`, `timeframe` were saved). This allows the paper trading endpoint to fully reconstruct the strategy configuration from a saved backtest run.

### `src/api/routes/paper-trading.ts`

- Added `backtestRunId` as a third accepted option in `CreateSessionSchema` (alongside `aggregationConfigId` and `strategyConfig`)
- Updated the `.refine()` validation to accept any one of the three fields
- Added a `backtestRunId` handling branch in the POST `/api/paper-trading/sessions` handler:
  - Loads the backtest run from DB via `getBacktestRun()`
  - Returns 404 if the run does not exist
  - If `config.params.subStrategies` is present (aggregation run), reconstructs `AggregateBacktestConfig` from stored sub-strategies including `params`, `exchange`, `allocationMode`, `maxPositions`
  - If no sub-strategies (single strategy run), wraps as a single-sub-strategy aggregation
- Added `getBacktestRun` to the import from `../../data/db.js`

## How to Use

The frontend should now send `backtestRunId` instead of `aggregationConfigId` when the history run has no `aggregationId`:

```typescript
// Before (broken for ad-hoc runs):
{ name, aggregationConfigId: run.aggregationId }

// After (works for all runs):
{ name, backtestRunId: run.id }
// or for saved aggregation configs:
{ name, aggregationConfigId: run.aggregationId }
```
