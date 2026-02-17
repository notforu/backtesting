# Fix 4 Critical Prediction Market Bugs

**Date**: 2026-02-14
**Type**: Bug Fix
**Severity**: Critical

## Summary

Fixed four critical bugs affecting prediction market backtesting accuracy:
1. Slippage never applying due to nullish coalescing with 0
2. Incorrect equity calculation for PM short positions
3. Forward-fill not applied to cached candle data
4. Slippage causing prices to exceed valid PM range (0-1)

## Changes

### Bug 1: Slippage Default Logic (`src/core/pairs-engine.ts`)

**Issue**: The nullish coalescing operator (`??`) doesn't trigger on `0`, so default slippage was always 0% instead of 2% for prediction markets.

**Fix**: Changed from:
```typescript
const slippagePercent = options.broker?.slippagePercent ?? (isPredictionMarket ? 2 : 0);
```

To:
```typescript
const configuredSlippage = options.broker?.slippagePercent;
const slippagePercent = (configuredSlippage === undefined || configuredSlippage === 0)
  ? (isPredictionMarket ? 2 : 0)
  : configuredSlippage;
```

### Bug 2: PM Short Equity Calculation

**Issue**: For prediction market shorts, the equity getter was adding PnL instead of the actual NO share value.

**Files Modified**:
- `src/core/pairs-portfolio.ts`
- `src/core/portfolio.ts`

**Fix**: For PM shorts in no-leverage path, changed from:
```typescript
total += (this._shortPositionA.entryPrice - this._priceA) * this._shortPositionA.amount;
```

To:
```typescript
if (this._isPredictionMarket) {
  // PM short = NO shares, value = (1 - currentPrice) * amount
  total += (1 - this._priceA) * this._shortPositionA.amount;
} else {
  total += (this._shortPositionA.entryPrice - this._priceA) * this._shortPositionA.amount;
}
```

### Bug 3: Forward-Fill Missing for Cached Data

**Issue**: Forward-fill was only applied in data providers' `fetchCandles()`, not when loading from cache, causing gaps in PM data.

**Files Modified**:
- `src/core/engine.ts`
- `src/core/pairs-engine.ts`

**Fix**:
1. Added `forwardFillCandles()` utility function to both engines
2. Applied forward-fill AFTER loading candles from either cache or provider
3. Only applies to prediction market exchanges (polymarket, manifold)

```typescript
// Apply forward-fill for prediction market exchanges
if (['polymarket', 'manifold'].includes(exchange)) {
  candles = forwardFillCandles(candles, timeframe);
}
```

### Bug 4: Slippage Exceeding PM Price Bounds

**Issue**: Slippage could push prices above 1.0 or below 0.0, which is invalid for prediction markets.

**Files Modified**:
- `src/core/broker.ts` - Added `isPredictionMarket` to `BrokerConfig`
- `src/core/engine.ts` - Pass `isPredictionMarket` to broker
- `src/core/pairs-engine.ts` - Updated `applySlippage()` function signature

**Fix**: Added price clamping for PM:
```typescript
if (isPredictionMarket) {
  slippedPrice = Math.max(0.001, Math.min(0.999, slippedPrice));
}
```

## Impact

### Before
- Slippage was always 0% for PM pairs (unrealistic, too optimistic)
- Equity calculation wrong during PM shorts (incorrect drawdown/returns)
- Cached PM data had gaps causing strategy errors
- Prices could exceed 1.0 or go below 0.0

### After
- Default 2% slippage properly applies to PM pairs
- Correct equity valuation for PM short positions
- No gaps in candle data (forward-filled)
- Prices always valid PM range (0.001 to 0.999)

## Testing

- [x] TypeScript compilation passes
- [x] All applySlippage call sites updated in pairs-engine.ts
- [x] BrokerConfig interface extended
- [x] Forward-fill logic added to both engines

## Breaking Changes

None - these are bug fixes that make the simulation more accurate.

## Related Files

- `/Users/notforu/WebstormProjects/backtesting/src/core/pairs-engine.ts`
- `/Users/notforu/WebstormProjects/backtesting/src/core/engine.ts`
- `/Users/notforu/WebstormProjects/backtesting/src/core/pairs-portfolio.ts`
- `/Users/notforu/WebstormProjects/backtesting/src/core/portfolio.ts`
- `/Users/notforu/WebstormProjects/backtesting/src/core/broker.ts`
- `/Users/notforu/WebstormProjects/backtesting/src/core/types.ts` (imported `timeframeToMs`)
