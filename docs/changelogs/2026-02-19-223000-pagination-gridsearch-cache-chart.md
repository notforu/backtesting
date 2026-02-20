# Pagination, Grid Search Multi-Symbol, Candle Cache, and Multi-Resolution Chart

**Date**: 2026-02-19 22:30
**Author**: dev-team

## Summary

Four major features shipped to improve usability, performance, and analysis capabilities. History now paginates to handle large backtesting runs. Grid search supports multi-symbol and multi-timeframe optimization with caching. New candle cache script enables efficient data population. Chart gains dynamic timeframe switching for detailed analysis.

## Added

### Feature 1: History Pagination
- Backend `getBacktestSummaries()` now accepts `limit` and `offset` parameters, returns `{ summaries, total }`
- REST API `GET /api/backtest/history` accepts query params `?limit=10&offset=0`, returns paginated results with `hasMore` flag
- Frontend `getHistory()` client method supports pagination options
- `useHistory()` hook converted from `useQuery` to `useInfiniteQuery` for seamless "Load More" UX
- History UI displays "X of Y runs" and shows loading spinner during page loads
- New type `PaginatedHistory` for type safety

### Feature 2: Multi-Symbol Grid Search
- `OptimizationConfig` extended with `saveAllRuns` boolean and `mode` field (e.g., 'spot', 'futures')
- New `runMultiOptimization()` function iterates over symbols and timeframes for batch optimization
- REST API `POST /api/optimize` now supports:
  - `saveAllRuns` to persist intermediate results to DB
  - `mode` for futures/spot targeting
  - `symbols[]` array for multi-symbol optimization
  - `timeframes[]` array for multi-timeframe optimization
- OptimizerModal gains:
  - Mode selector (spot/futures)
  - "Save all runs to history" checkbox
  - Multi-symbol text input
  - Multi-timeframe checkboxes
- `OptimizationRequest` type updated with new fields

### Feature 3: Candle Cache Script
- New script: `scripts/cache-candles.ts`
- Supports `--symbols=ALL` to auto-discover available symbols, or comma-separated list (e.g., `BTC/USDT,ETH/USDT`)
- Supports `--timeframes` parameter (default: `1m,5m,15m,1h,4h,1d`)
- Incremental caching via `getCandleDateRange()` — only fetches missing date gaps
- Per-symbol/timeframe progress output
- Final summary with cache stats
- npm script: `npm run quant:cache-candles -- --symbols=ALL --timeframes=1h,4h,1d`

### Feature 4: Multi-Resolution Chart
- New hook: `useResolutionCandles()` for fetching candles at different resolutions on-demand
- Chart component gains resolution selector buttons (1m / 5m / 15m / 1h / 4h / 1d)
- Clicking a timeframe button fetches candles and re-renders chart at that resolution
- Trade markers remain overlaid at correct positions across timeframe changes
- Loading spinner shown during fetch
- Chart resets to backtest timeframe when new backtest result loads
- `App.tsx` passes `backtestTimeframe`, `exchange`, `symbol`, `startDate`, `endDate` to Chart

## Changed

- `src/data/db.ts`: `getBacktestSummaries()` signature changed to support pagination
- `src/api/routes/backtest.ts`: `GET /api/backtest/history` endpoint now handles pagination params
- `src/api/routes/optimize.ts`: `POST /api/optimize` expanded to handle multi-symbol, multi-timeframe, mode options
- `src/core/optimizer.ts`: `OptimizationConfig` interface extended; added `runMultiOptimization()` function
- `src/web/types.ts`: Added `PaginatedHistory` type; updated `OptimizationRequest` type
- `src/web/api/client.ts`: `getHistory()` method now accepts pagination params
- `src/web/hooks/useBacktest.ts`: `useHistory()` switched to `useInfiniteQuery`; added `useResolutionCandles()` hook
- `src/web/components/History/History.tsx`: UI updated with pagination controls and "X of Y" counter
- `src/web/components/Chart/Chart.tsx`: Added resolution selector buttons and dynamic fetch logic
- `src/web/components/OptimizerModal/OptimizerModal.tsx`: Added mode selector, checkboxes, multi-symbol input
- `src/web/App.tsx`: Passes additional props to Chart component
- `package.json`: Added npm script `quant:cache-candles`

## Files Modified

- `src/data/db.ts` - Pagination support in history queries
- `src/api/routes/backtest.ts` - Paginated history endpoint
- `src/api/routes/optimize.ts` - Multi-symbol/timeframe optimization endpoint
- `src/core/optimizer.ts` - Multi-optimization logic
- `src/web/types.ts` - New types for pagination and optimization
- `src/web/api/client.ts` - Pagination client support
- `src/web/hooks/useBacktest.ts` - Infinite query hook and resolution candles hook
- `src/web/components/History/History.tsx` - Pagination UI
- `src/web/components/Chart/Chart.tsx` - Resolution selector
- `src/web/components/OptimizerModal/OptimizerModal.tsx` - Multi-symbol/timeframe UI
- `src/web/App.tsx` - Chart props updated
- `scripts/cache-candles.ts` - New candle caching script
- `package.json` - New npm script

## Context

These features address key pain points:

1. **Pagination**: Users run hundreds of backtests. History UI was not scalable. Pagination with incremental loading provides better performance and UX.

2. **Multi-Symbol Grid Search**: Researchers need to optimize across multiple symbols and timeframes simultaneously. Batch optimization with `saveAllRuns` persists intermediate results, enabling comparison across the grid.

3. **Candle Cache Script**: Manual data fetching is tedious and slow. Automated incremental caching with progress reporting makes data population fast and reliable.

4. **Multi-Resolution Chart**: Backtest results show aggregate timeframe (e.g., 1h). Researchers need to zoom in/out for entry/exit analysis without re-running backtest. Dynamic chart resolution switching provides this without server-side re-calculation.

## Testing Notes

- Pagination: Test with 50+ backtest runs; verify "Load More" loads next page correctly
- Grid Search: Run batch optimization across 3+ symbols and 2+ timeframes; verify all results saved to DB
- Cache Script: Run with `--symbols=ALL --timeframes=1h,4h,1d`; verify incremental fetch (re-run script, should skip already-cached data)
- Chart Resolution: Run backtest, then click resolution buttons; verify trades overlay correctly and no data gaps on fetch
