# Funding Rate API Endpoint and Chart Overlay

**Date:** 2026-02-19 16:24:45

## Summary

Added a REST API endpoint for querying funding rate data and a frontend chart overlay that visualizes funding rates on the backtesting chart for futures mode backtests.

## Changes

### Backend

**New file: `src/api/routes/funding-rates.ts`**
- `GET /api/funding-rates` endpoint accepting `exchange`, `symbol`, `start`, `end` query params
- Returns `{ rates: FundingRate[] }` with timestamp, fundingRate, markPrice fields
- Zod schema validation with 400 error on invalid params, 500 on server errors

**Modified: `src/api/routes/index.ts`**
- Exports the new `fundingRateRoutes`

**Modified: `src/api/server.ts`**
- Imports and registers `fundingRateRoutes`

**Modified: `src/data/index.ts`**
- Exports `getFundingRates` and `getFundingRateDateRange` from `db.ts`

### Frontend

**Modified: `src/web/api/client.ts`**
- Added `getFundingRates(params)` function that calls `GET /api/funding-rates`

**Modified: `src/web/hooks/useBacktest.ts`**
- Added `useFundingRates(params | null)` React Query hook with 10-minute stale time

**Modified: `src/web/components/Chart/Chart.tsx`**
- Added `isFutures` prop to `ChartProps`
- Added `LineSeries` import from `lightweight-charts`
- Added `showFundingRate` state (default: false)
- Added `fundingRateParams` and `useFundingRates` hook call
- Added `frSeriesRef` for the funding rate line series
- Added `useEffect` to create/remove the FR series based on `showFundingRate` toggle
  - Uses a separate `priceScaleId: 'funding-rate'` scale in the bottom 25% of chart
  - FR values displayed as percentages with 4 decimal places
  - Amber (#F59E0B) color for the line
- Added "FR" toggle button in the chart toolbar (visible only when `isFutures=true`)
- FR series is cleaned up on chart unmount

**Modified: `src/web/App.tsx`**
- Passes `isFutures` prop to `<Chart>` based on `config.mode === 'futures'` or presence of `totalFundingIncome` metric

## Notes

- FR data is fetched every 8 hours from the DB (Bybit perpetuals). Chart candles may be 1h - the line series connects the dots correctly.
- The FR overlay is hidden by default. Users click "FR" in the chart toolbar to enable it.
- Only shown for futures mode backtests (not spot or Polymarket).
