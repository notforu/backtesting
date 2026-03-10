# Remove Polymarket, Pairs Trading, and Dead Code

**Date**: 2026-03-10 12:00
**Author**: system-refactor

## Summary

Major cleanup removing unsupported prediction market stack (Polymarket), pairs trading engine, and dead code. Polymarket provider was fully integrated but never used due to low market liquidity and prediction market regulatory concerns. Pairs trading engine (correlation spreads, etc.) was experimental but incomplete. These modules contributed maintenance burden with zero usage. Results are now persisted only to the database, eliminating legacy file-based storage.

## Removed

### Polymarket & Prediction Markets (Completely Removed)
- `src/data/providers/polymarket.ts` — Polymarket REST API wrapper
- `src/data/polymarket-types.ts` — Market, order, and position types
- `src/data/gecko-terminal.ts` — Market data aggregator
- `src/data/manifold.ts` — Manifold prediction market provider
- `src/data/polymarket-cache.ts` — Cache layer for PM data
- `src/data/pm-market-selector.ts` — Market scoring and selection logic
- `src/strategy/pm-utils.ts` — PM-specific utility functions
- `src/api/routes/polymarket.ts` — API endpoints for PM exploration
- `src/web/components/PolymarketBrowser/` — React UI for market browsing (5 components)
- 6 PM strategies: `pm-mean-reversion.ts`, `pm-cross-platform-arb.ts`, `pm-information-edge.ts`, `pm-correlation-pairs.ts`, and 2 others
- 11 PM-related CLI scripts

### Pairs Trading Stack (Completely Removed)
- `src/core/pairs-engine.ts` — Pairs backtest execution engine
- `src/core/pairs-portfolio.ts` — Portfolio with spread tracking
- `src/strategy/pairs-base.ts` — Base class for pairs strategies
- `src/web/components/PairsChart/` — Spread visualization (2 components)
- `src/web/components/SpreadChart/` — Legacy spread charting
- 5 pairs strategies: `pairs-zscore.ts`, `pairs-correlation.ts`, `pairs-cointegration.ts`, and 2 others

### Result File Storage (Legacy)
- `src/core/result-storage.ts` — File-based result persistence
- All `data/opt-*.json` and `data/opt-*.log` files

### Deprecated Strategy
- `strategies/funding-rate-spike.ts` — v1, superseded by `funding-rate-spike-v2.ts`

## Changed

### References Cleaned

**Data providers:**
- `src/data/providers/index.ts` — Removed 'polymarket' and 'manifold' exchange types from SupportedExchange

**Core engine:**
- `src/core/engine.ts` — Removed isPredictionMarket checks, saveResultToFile() calls
- `src/core/aggregate-engine.ts` — Removed saveResultToFile() calls
- `src/core/optimizer.ts` — Removed PM cache checks
- `src/core/__tests__/aggregate-persistence.test.ts` — Removed BUG 3 test block

**Types:**
- `src/core/types.ts` — Removed PairsBacktestConfig, SpreadDataPoint, PairsBacktestResult
- `src/strategy/loader.ts` — Removed isPairs field from StrategyLoadResult

**API routes:**
- `src/api/routes/index.ts` — Removed polymarket route export
- `src/api/routes/backtest.ts` — Removed /api/backtest/pairs/run endpoint
- `src/api/routes/optimize.ts` — Removed pairs strategy type handling
- `src/api/routes/config-export.ts` — Removed pairs config export logic
- `src/api/routes/scan.ts` — Removed saveScanResultsToFile() call
- `src/api/server.ts` — Unregistered polymarket router

**CLI tools:**
- `src/cli/quant-backtest.ts` — Removed pairs backtest command
- `src/cli/quant-optimize.ts` — Removed pairs optimizer
- `src/cli/quant-walk-forward.ts` — Removed pairs walk-forward

**Frontend:**
- `src/web/App.tsx` — Removed PolymarketBrowser route
- `src/web/components/StrategyConfig.tsx` — Removed PM strategy type handling
- `src/web/client.ts` — Removed polymarket API client methods
- `src/web/ScannerResults.tsx` — Removed PM result rendering
- `src/web/Chart.tsx` — Removed PM charting logic
- `src/web/types.ts` — Removed PM and pairs types
- `src/web/hooks/useBacktest.ts` — Removed pairs backtest support
- `src/web/stores/backtestStore.ts` — Removed pairs result handling
- `src/web/components/CreatePaperSessionModal.tsx` — Removed pairs session type
- `src/web/components/CreateAggregationModal.tsx` — Removed pairs symbol selection

**Core exports:**
- `src/core/index.ts` — Removed pairs engine exports

## Impact

### Type System
- `SupportedExchange` now strictly `'binance' | 'bybit'`
- 3 type definitions removed entirely (PairsBacktestConfig, SpreadDataPoint, PairsBacktestResult)
- StrategyLoadResult simplified (no isPairs field)

### Backtesting
- All results now persist only to database via `saveBacktestRun()`
- No legacy file scatter (data/opt-*.json files)
- Optimizer, walk-forward, and backtest commands fully unified on single-asset crypto futures

### Strategies
- 14 active strategies remain (all crypto futures on Binance/Bybit)
- Removed: 6 PM strategies + 5 pairs strategies + 1 deprecated FRS v1 = 12 total
- All remaining strategies are spot/futures arbitrage and technical analysis focused

### API Surface
- 1 route completely removed: `/api/polymarket/*`
- 1 endpoint removed: `/api/backtest/pairs/run`
- 1 provider type removed: 'manifold'
- UI now 100% focused on single-asset crypto backtesting

## Files Modified

- `src/data/providers/index.ts` — Exchange type narrowing
- `src/core/engine.ts` — Engine simplification
- `src/core/aggregate-engine.ts` — Remove file storage
- `src/core/optimizer.ts` — Remove PM cache check
- `src/core/types.ts` — Type simplification
- `src/api/routes/backtest.ts` — Remove pairs endpoint
- `src/api/routes/scan.ts` — Remove file storage
- `src/api/server.ts` — Unregister polymarket router
- `src/web/App.tsx` — Remove PM route
- `src/web/client.ts` — Remove PM API methods
- `src/web/components/StrategyConfig.tsx` — Remove PM handling
- `src/strategy/loader.ts` — Remove isPairs field
- 8 additional files with reference cleanup

## Context

**Why:** Polymarket stack was fully implemented but never used in practice. Prediction markets have low liquidity, long settlement times, and regulatory uncertainty. Pairs trading was experimental but never completed (correlation analysis, cointegration tests not fully integrated). Both modules added ~15-20% codebase size with zero usage and high maintenance burden. File-based result storage was legacy; all backtest results now go to the database for proper tracking and comparison in the dashboard.

**Migration path:** All active development now focuses on single-asset crypto futures strategies with proven execution infrastructure (Binance/Bybit). Users wanting correlation analysis can implement it via multi-asset aggregations with manual signal weighting. Prediction market research can be revisited if demand emerges.

**Quality gates:** TypeScript compilation verified, ESLint passing, API server starts cleanly, database persistence intact, 14 strategies load and validate successfully.
