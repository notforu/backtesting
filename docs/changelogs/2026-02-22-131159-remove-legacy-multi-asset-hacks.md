# Phase 8: Remove Legacy Multi-Asset Hacks

**Date:** 2026-02-22 13:11
**Type:** Cleanup / Refactor

## Summary

Removed all legacy hack code that used fake strategies (`signal-aggr`, `fr-spike-aggr`) to handle multi-asset backtesting. The Aggregation entity is now a first-class concept with proper CRUD API, frontend store, and dedicated UI panel — so this temporary scaffolding is no longer needed.

## Files Deleted

- `/workspace/strategies/signal-aggr.ts` — legacy aggregate strategy hack
- `/workspace/strategies/fr-spike-aggr.ts` — legacy multi-asset FR strategy hack

## Files Modified

### `/workspace/src/api/routes/backtest.ts`
- Removed `POST /api/backtest/multi/run` endpoint (316 lines of ad-hoc orchestration)
- Removed `POST /api/backtest/aggregate/run` endpoint
- Removed `RunMultiBacktestRequestSchema`, `RunMultiBacktestRequest` type
- Removed `AssetConfig` and `AssetResult` interfaces
- Removed unused imports: `createBacktestConfig`, `calculateMetrics`, `generateEquityCurve`, `calculateRollingMetrics`, `saveBacktestRun`
- Removed unused type imports: `Timeframe`, `Trade`, `EquityPoint`, `BacktestResult`
- File reduced from 776 to 460 lines

### `/workspace/src/web/hooks/useBacktest.ts`
- Removed `useRunMultiAssetBacktest()` hook
- Removed `useRunAggregateBacktest()` hook
- Removed `runMultiAssetBacktest` and `runAggregateBacktest` from imports
- Removed `RunMultiAssetBacktestRequest` and `RunAggregateBacktestRequest` from type imports

### `/workspace/src/web/api/client.ts`
- Removed `runMultiAssetBacktest()` function
- Removed `runAggregateBacktest()` function
- Removed `RunMultiAssetBacktestRequest` and `RunAggregateBacktestRequest` from type imports

### `/workspace/src/web/types.ts`
- Removed `RunMultiAssetBacktestRequest` interface
- Removed `RunAggregateBacktestRequest` interface
- Removed `isMultiAsset?: boolean` from `StrategyInfo` interface
- Removed `isAggregate?: boolean` from `StrategyInfo` interface
- Removed `isMultiAsset?: boolean` from `StrategyDetails` interface
- Removed `isAggregate?: boolean` from `StrategyDetails` interface

### `/workspace/src/strategy/loader.ts`
- Removed `isMultiAsset?: boolean` from `StrategyInfo` interface
- Removed `isAggregate?: boolean` from `StrategyInfo` interface
- Removed `isMultiAsset` and `isAggregate` lines from `getStrategyDetails()` function

### `/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx`
- Removed `ASSET_PRESETS` constant
- Removed `useRunMultiAssetBacktest` and `useRunAggregateBacktest` hook imports
- Removed `runMultiAssetBacktestMutation` and `runAggregateBacktestMutation` declarations
- Removed `isAggregateStrategy` and `isMultiAssetStrategy` branches from `handleRunBacktest()`
- Removed `isMultiAssetStrategy` and `isAggregateStrategy` variable declarations
- Simplified `canRun` condition (removed multi-asset/aggregate special cases)
- Removed multi-asset info banner
- Removed conditional wrapping of Symbol & Timeframe inputs (now always shown)
- Removed `useEffect` that auto-set exchange/mode for multi-asset strategies

### `/workspace/src/web/components/AggregationsPanel/CreateAggregationModal.tsx`
- Removed `isMultiAsset` and `isAggregate` filter checks (properties no longer exist on `StrategyInfo`)

## Quality Gates

- TypeScript: passes with no errors (`npm run typecheck`)
