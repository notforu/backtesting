# Fix Frontend Pairs Backtest Detection from History

**Date**: 2026-02-13 23:30
**Type**: Bug Fix
**Impact**: Pairs Trading UI

## Problem

When a pairs backtest result was loaded from history (database), the frontend failed to detect it as a pairs result. This caused:

- Pairs backtests to display as single-market results
- Wrong chart component to be rendered (single chart instead of dual charts)
- Form fields not properly populated when applying history params

**Root Cause**: The detection logic checked for `candlesA`/`candlesB` properties, which only exist on fresh backtest results. History-loaded results don't have candles at the top level initially - only the config contains `symbolA`/`symbolB`.

## Solution

### Fix 1: App.tsx - `isPairsResult()` function

Updated the type guard to check both:
1. Fresh results: `candlesA` and `candlesB` properties
2. History-loaded results: `symbolA` and `symbolB` in the config

```typescript
function isPairsResult(result: unknown): result is PairsBacktestResult {
  if (result === null || typeof result !== 'object') return false;
  // Check for candlesA/candlesB (live results) OR symbolA in config (loaded from history)
  if ('candlesA' in result && 'candlesB' in result) return true;
  if ('config' in result) {
    const config = (result as any).config;
    return config && typeof config === 'object' && 'symbolA' in config && 'symbolB' in config;
  }
  return false;
}
```

### Fix 2: backtestStore.ts - `applyHistoryParams()` function

Changed pairs detection to check config instead of candles:

```typescript
applyHistoryParams: (result) => {
  const config = result.config as any;
  const isPairs = config.symbolA && config.symbolB;
  if (isPairs) {
    set({
      strategy: config.strategyName,
      params: config.params,
      symbol: config.symbolA,
      symbolB: config.symbolB,
      timeframe: config.timeframe,
      startDate: new Date(config.startDate).toISOString().split('T')[0],
      endDate: new Date(config.endDate).toISOString().split('T')[0],
      initialCapital: config.initialCapital,
      exchange: config.exchange,
      leverage: config.leverage || 1,
    });
  } else {
    // ... single-market case
  }
}
```

## Files Changed

- `src/web/App.tsx` - Updated `isPairsResult()` type guard
- `src/web/stores/backtestStore.ts` - Updated `applyHistoryParams()` detection logic

## Testing

TypeScript compilation passes with no errors.

## Impact

- Pairs backtests loaded from history now display correctly with dual charts
- Form properly populates both symbolA and symbolB when loading from history
- Consistent behavior between fresh backtests and history-loaded results
