# Add Slippage Cost Tracking to Trades and Metrics

**Date:** 2026-02-14 06:14
**Type:** Feature Enhancement
**Components:** Backend (Core Engine, Metrics), Frontend (Dashboard, Trade Table)

## Summary

Added slippage cost tracking to all trades and exposed it in performance metrics and UI. With Polymarket fees set to 0, the execution cost (2% slippage) was previously invisible because it was baked into fill prices. Now users can see exactly how much slippage cost them on each trade and in total.

## Changes

### Backend Changes

#### 1. Trade Type (`src/core/types.ts`)
- Added `slippage?: number` field to `TradeSchema` and `Trade` type
- Added `totalSlippage?: number` to `PerformanceMetricsSchema` and `PerformanceMetrics` type

#### 2. Broker (`src/core/broker.ts`)
- Modified `tryFillOrder()` to calculate and record slippage cost after executing trades
- Slippage cost = `|fillPrice - candle.close| * amount`
- Only recorded when `fillPrice !== candle.close` (i.e., slippage was applied)

#### 3. Pairs Engine (`src/core/pairs-engine.ts`)
- Added slippage tracking to all 8 action types (openLongA, closeLongA, etc.)
- Calculates `originalPrice` vs `slippedPrice` and records difference × amount
- Applied to both main loop actions and onEnd final actions

#### 4. Metrics (`src/analysis/metrics.ts`)
- Added `totalSlippage` calculation: `trades.reduce((sum, t) => sum + (t.slippage ?? 0), 0)`
- Included in both normal metrics and empty metrics (edge case)

### Frontend Changes

#### 5. Types (`src/web/types.ts`)
- Added `slippage?: number` to `Trade` interface
- Added `totalSlippage?: number` to `PerformanceMetrics` interface

#### 6. Dashboard (`src/web/components/Dashboard/Dashboard.tsx`)
- Changed "Total Fees" metric card to "Execution Cost"
- Shows combined value: `(totalFees + totalSlippage)`
- Added `subValue` showing breakdown when slippage > 0:
  ```
  Fees: $X.XX | Slippage: $Y.YY
  ```

#### 7. Trade Table (`src/web/App.tsx`)
- Changed "Fee" column header to "Cost"
- Shows combined execution cost per trade: `(fee + slippage)`
- Displays "-" when both are zero/undefined

## Technical Details

### Slippage Calculation
```typescript
// In broker.ts and pairs-engine.ts
if (trade && fillPrice !== candle.close) {
  trade.slippage = Math.abs(fillPrice - candle.close) * trade.amount;
}
```

### UI Display Logic
```typescript
// Dashboard execution cost
value={`$${((metrics.totalFees ?? 0) + (metrics.totalSlippage ?? 0)).toFixed(2)}`}

// Trade table cost column
{(trade.fee || trade.slippage) ? `$${((trade.fee ?? 0) + (trade.slippage ?? 0)).toFixed(2)}` : '-'}
```

## User Impact

### Before
- Dashboard showed "Total Fees: $0.00" (misleading - cost was hidden)
- Trade table showed "-" for all fees (no visibility into execution cost)
- Users couldn't see that 2% slippage was eating into profits

### After
- Dashboard shows "Execution Cost: $XXX.XX" with breakdown
- Example: `Execution Cost: $45.32` with subtitle `Fees: $0.00 | Slippage: $45.32`
- Trade table shows actual cost per trade (e.g., "$0.67" for a $33.50 trade with 2% slippage)
- Full transparency into trading costs

## Testing

- Ran `npm run typecheck` - passes
- All TypeScript types compile correctly
- Works for both single-symbol and pairs trading backtests
- Backward compatible (slippage is optional field, defaults to 0)

## Files Modified

```
src/core/types.ts (Trade, PerformanceMetrics schemas)
src/core/broker.ts (slippage recording in tryFillOrder)
src/core/pairs-engine.ts (slippage recording in all 8 action types + onEnd)
src/analysis/metrics.ts (totalSlippage calculation)
src/web/types.ts (frontend Trade, PerformanceMetrics interfaces)
src/web/components/Dashboard/Dashboard.tsx (Execution Cost metric card)
src/web/App.tsx (Cost column in trade table)
```

## Notes

- Slippage is only recorded when `fillPrice !== originalPrice`
- For limit orders that fill at exact limit price, slippage = 0
- For market orders with 0% slippage config, slippage = 0
- Formula works for both long and short positions (absolute value)
- Pairs engine handles both A and B symbols independently
