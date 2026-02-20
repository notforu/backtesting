# History Explorer, Funding Rate Clarity, and Chart Enhancements

**Date:** 2026-02-19 16:30:00

## Summary

Comprehensive UI and backend improvements for backtest history exploration, funding rate transparency in futures mode, and chart performance optimization. Added History Explorer modal with advanced filtering/sorting, funding rate data persistence to trades, funding rate chart overlay, and date range limiting for high-resolution timeframes.

## Feature A: History API Filters + Runs Explorer Modal

### Backend Changes

**Modified: `src/core/types.ts`**
- Extended `BacktestSummary` type with new fields:
  - `exchange`: string (CCXT exchange name)
  - `startDate`: number (Unix timestamp)
  - `endDate`: number (Unix timestamp)
  - `params`: Record<string, number> (strategy parameters used)
  - `maxDrawdownPercent`: number
  - `winRate`: number (0-100 percentage)
  - `profitFactor`: number (gross profit / gross loss)
  - `totalTrades`: number
  - `totalFees`: number
  - `mode`: 'spot' | 'futures' | 'prediction' (trading mode)

**New interface: `HistoryFilters`**
```typescript
interface HistoryFilters {
  strategy?: string
  symbol?: string
  timeframe?: string
  exchange?: string
  mode?: 'spot' | 'futures' | 'prediction'
  dateRange?: { from: number; to: number }
  minSharpe?: number
  maxSharpe?: number
  minReturn?: number
  maxReturn?: number
  minWinRate?: number
  maxWinRate?: number
  minTrades?: number
}
```

**Modified: `src/data/db.ts`**
- Updated `getBacktestSummaries(filters?: HistoryFilters, sort?: string)` with:
  - Dynamic parameterized WHERE clauses for all filter dimensions
  - Sorting support: `date`, `sharpe`, `return`, `maxDrawdown`, `winRate`, `totalTrades`
  - Returns results in chronological order with sortable columns

**Modified: `src/api/routes/backtest.ts`**
- Extended `GET /api/backtest/history` endpoint to accept filter and sort query params
- Validates filters using Zod schema
- Passes filters through to `getBacktestSummaries()`

### Frontend Changes

**Modified: `src/web/api/client.ts`**
- Added `getBacktestHistory(filters?, sort?)` client that passes all filter params to the API

**New file: `src/web/components/HistoryExplorer/HistoryExplorer.tsx`**
- Modal component with:
  - **Filters bar** with dropdowns/inputs for strategy, symbol, timeframe, exchange, mode, date range, and Sharpe/Return ranges
  - **Sortable table** with 12 columns: Date, Strategy, Symbol, TF, Exchange, Return %, Sharpe, Max DD%, Win Rate, P.Factor, Trades, Mode
  - **Group-by-asset view** toggle to show runs grouped by symbol
  - **Pagination**: 20 results per page with next/previous navigation
  - **"Explore Runs" button** in sidebar to open the modal
  - Click-to-select rows (future: inspect runs feature)
  - Clear filters button

**New file: `src/web/components/HistoryExplorer/index.ts`**
- Export for HistoryExplorer component

**Modified: `src/web/App.tsx`**
- Added "Explore Runs" button in sidebar that opens HistoryExplorer modal

## Feature B: Funding Rate in Trades + PnL Clarity

### Backend Changes

**Modified: `src/core/types.ts`**
- Added `fundingRate` field to `Trade` interface (optional, for futures mode)
  - Stores the funding rate percentage at time of trade execution

**Modified: `src/core/types.ts` (PerformanceMetrics)**
- Added `totalFundingIncome`: number (cumulative funding payments received)
- Added `tradingPnl`: number (P&L from entry/exit, excluding funding)
- Maintains backward compatibility: `totalPnl = tradingPnl + totalFundingIncome`

**Modified: `src/core/engine.ts`**
- In futures mode, after each trade execution, attaches the nearest funding rate from the loaded `fundingRates` array
- `trade.fundingRate` stores the funding rate percentage at execution time
- Calculates `totalFundingIncome` separately from `tradingPnl` for clarity

**New migration: `migrations/002_add_funding_rate_to_trades.sql`**
```sql
ALTER TABLE trades_v2 ADD COLUMN funding_rate DECIMAL(10, 6);
```

**Modified: `src/data/db.ts`**
- Updated `saveBacktestRun()` to persist `fundingRate` in each trade record
- Updated `getBacktestRun()` to load `fundingRate` from DB and populate `Trade[]` array
- Updated `updateBacktestRun()` to handle funding rate updates

### Frontend Changes

**Modified: `src/web/components/TradesTable/TradesTable.tsx`**
- Added "FR Rate" column (visible only in futures mode)
- Displays funding rate as colored percentage: green for positive, red for negative

**Modified: `src/web/components/Dashboard/PerformanceMetrics.tsx` (or new file)**
- Added PnL clarity banner showing:
  - "Trading P&L: $X | Funding Income: $Y | Total: $Z"
  - Trading P&L is entry/exit profits only
  - Funding Income is cumulative funding payments
  - Total is the sum

## Feature C: Funding Rate Chart Overlay

### Backend Changes

**New file: `src/api/routes/funding-rates.ts`**
- `GET /api/funding-rates` endpoint with query params:
  - `exchange`: string (CCXT exchange code)
  - `symbol`: string (trading pair)
  - `start`: number (Unix timestamp ms)
  - `end`: number (Unix timestamp ms)
- Returns `{ rates: FundingRate[] }` with fields: `timestamp`, `fundingRate`, `markPrice`
- Zod schema validation, 400 on invalid params, 500 on DB errors

**Modified: `src/api/routes/index.ts`**
- Exports `fundingRateRoutes`

**Modified: `src/api/server.ts`**
- Imports and registers `fundingRateRoutes`

**Modified: `src/data/index.ts`**
- Exports `getFundingRates` and `getFundingRateDateRange` functions from `db.ts`

### Frontend Changes

**Modified: `src/web/api/client.ts`**
- Added `getFundingRates(exchange, symbol, start, end)` function that calls `GET /api/funding-rates`

**Modified: `src/web/hooks/useBacktest.ts` (or create `useFundingRates` hook)**
- Added `useFundingRates(params | null)` React Query hook
- Stale time: 10 minutes (FR data updates every 8 hours)
- Automatically disabled when `params` is null

**Modified: `src/web/components/Chart/Chart.tsx`**
- Added `isFutures` prop to `ChartProps`
- Added imports for `LineSeries` from `lightweight-charts`
- Added `showFundingRate` state (default: false)
- Added `fundingRateParams` computed from backtest config
- Call `useFundingRates(fundingRateParams)` hook
- Create `frSeriesRef` for the funding rate line series
- In `useEffect`:
  - When `showFundingRate=true` and FR data loaded:
    - Create LineSeries with `priceScaleId: 'funding-rate'` (bottom 25% of chart)
    - Format FR values as percentages with 4 decimal places
    - Use amber (#F59E0B) color
  - On toggle off or unmount: remove series
- Added "FR" toggle button in chart toolbar (amber color, visible only when `isFutures=true`)

**Modified: `src/web/App.tsx`**
- Passes `isFutures` prop to `<Chart>` based on:
  - `config.mode === 'futures'` OR
  - Presence of `totalFundingIncome` in metrics

## Feature D: 1m Chart Performance Fix

### Frontend Changes

**Modified: `src/web/components/Chart/Chart.tsx`**
- Added date range limiter for high-resolution timeframes:
  - 1m: 7-day default max range
  - 5m: 30-day default max range
  - Other TFs: no limit
- Added compact date range selector below timeframe buttons:
  - `from` date input
  - `to` date input
  - Quick preset buttons: "7d", "30d", "90d"
- Added live candle count estimator:
  - Displays amber warning when estimated candle count > 50,000
  - Uses formula: `daysDiff * (1440 / timeframeMinutes)`
- When user selects 1m/5m:
  - Restricts date picker to max range
  - Shows estimated candle count
  - Prevents loading 1M+ candles that would freeze browser

## Database Migration

**New file: `migrations/002_add_funding_rate_to_trades.sql`**
- Adds `funding_rate DECIMAL(10, 6)` column to `trades_v2` table
- Runs automatically on app startup via migration system

## Files Modified

- `src/core/types.ts` - BacktestSummary, Trade, PerformanceMetrics, new HistoryFilters interface
- `src/core/engine.ts` - Attach FR to trades, calculate tradingPnl separately
- `src/data/db.ts` - getBacktestSummaries with filters/sort, save/load fundingRate
- `src/data/index.ts` - Export FR functions
- `src/api/routes/backtest.ts` - Extend /history endpoint with filters
- `src/api/routes/funding-rates.ts` - New endpoint for FR data
- `src/api/routes/index.ts` - Export fundingRateRoutes
- `src/api/server.ts` - Register fundingRateRoutes
- `src/web/api/client.ts` - getBacktestHistory, getFundingRates functions
- `src/web/hooks/useBacktest.ts` - useFundingRates hook
- `src/web/components/Chart/Chart.tsx` - FR overlay, date range limiter, showFundingRate state
- `src/web/components/TradesTable/TradesTable.tsx` - FR Rate column
- `src/web/components/HistoryExplorer/HistoryExplorer.tsx` - New modal
- `src/web/components/HistoryExplorer/index.ts` - New export
- `src/web/App.tsx` - Pass isFutures to Chart, add Explore Runs button
- `migrations/002_add_funding_rate_to_trades.sql` - New migration

## Notes

- All 5 features work together seamlessly: users can explore history, select a futures run, view FR data in the trades table, and overlay FR on the chart.
- Date range limiter prevents UI freezes on 1m/5m candle loads (practical limits: 7d @ 1m = ~10K candles, 30d @ 5m = ~8.6K candles).
- Funding rate data refreshes every 8 hours from Bybit. Chart overlay connects hourly candles with 8h FR updates correctly.
- All new fields are backward compatible: legacy spot/PM backtests won't have `fundingRate`, `totalFundingIncome`, `tradingPnl` fields.
