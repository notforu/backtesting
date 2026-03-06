# Add SL/TP Lines on Paper Trading Price Chart

**Date**: 2026-03-06
**Type**: Feature

## Summary

Implemented display of stop-loss and take-profit price levels as dashed horizontal lines on the paper trading price chart. When a paper trading session has open positions with SL/TP levels, they appear as colored dashed lines labeled "SL" (red) and "TP" (green) on the chart.

## Changes

### Backend

**`migrations/013_add_sl_tp_to_paper_positions.sql`** (new)
- Added `stop_loss NUMERIC` and `take_profit NUMERIC` nullable columns to `paper_positions` table via `ALTER TABLE ADD COLUMN IF NOT EXISTS`

**`src/paper-trading/types.ts`**
- Added `stopLoss: number | null` and `takeProfit: number | null` fields to `PaperPosition` interface

**`src/paper-trading/db.ts`**
- Added `stop_loss` / `take_profit` to `PaperPositionRow` interface
- Updated `rowToPosition()` mapper to read and convert the new columns
- Updated `savePaperPosition()` SQL to include `stop_loss` and `take_profit` in both INSERT and ON CONFLICT UPDATE clauses

**`src/paper-trading/engine.ts`**
- Added `computeSlTp()` private method that derives SL/TP prices from strategy params at position open time. Supports two conventions:
  1. ATR-based: detects `useATRStops`, `atrPeriod`, `atrStopMultiplier`, `atrTPMultiplier` params (used by FR V2 and ATR-based strategies)
  2. Percentage-based: detects `stopLossPct` / `takeProfitPct` params
- Called `computeSlTp()` in Step 8 (signal execution) and saves the computed levels with the position to the DB

**`src/api/routes/paper-trading.ts`**
- Fixed field name bug: API was returning `openPositions` but frontend type expected `positions`. Changed to `positions` to match the `PaperSessionDetail` type.

### Frontend

**`src/web/types.ts`**
- Added `stopLoss: number | null` and `takeProfit: number | null` to `PaperPosition` interface

**`src/web/components/Chart/Chart.tsx`**
- Added `ActiveLevel` interface (exported): `{ price: number; label: string; color: string }`
- Added `activeLevels?: ActiveLevel[]` prop to `ChartProps`
- Added `priceLinesRef` to track created price line handles for cleanup
- Added `useEffect` that creates/removes `createPriceLine()` entries on the candlestick series whenever `activeLevels` changes — renders dashed horizontal lines with axis labels

**`src/web/components/PaperTradingPage/PaperTradingPage.tsx`**
- Imported `ActiveLevel` type from Chart
- Added `activeLevels` memo that extracts SL/TP from `session.positions` for the active asset symbol
- Passed `activeLevels` prop to the `<Chart>` component
- Added Stop Loss and Take Profit columns to the Open Positions table

## Visual Result

- SL lines: red dashed horizontal line with "SL" axis label
- TP lines: green dashed horizontal line with "TP" axis label
- Lines update automatically as positions open/close (driven by React Query cache invalidation)
- Lines are only shown for the currently selected asset
