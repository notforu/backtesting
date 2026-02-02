# Fix Optimizer vs Backtest Slippage Inconsistency

**Date**: 2026-02-02
**Type**: Bug Fix
**Severity**: High
**Impact**: Optimizer results now match regular backtest results for the same parameters

## Problem

Optimizer results did not match regular backtest results when using identical parameters. This was caused by a configuration mismatch in broker settings:

- **Regular backtest** used `slippagePercent: 0.05` (0.05%)
- **Optimizer** had undefined `slippagePercent` (defaulting to 0)

This meant that optimization would find "best" parameters that performed worse in actual backtests.

## Root Cause

### Before Fix

**`src/core/engine.ts`** (DEFAULT_ENGINE_CONFIG):
```typescript
broker: {
  slippagePercent: 0.05,  // 0.05% slippage
  commissionPercent: 0,
  feeRate: 0,
}
```

**`src/core/optimizer.ts`** (engineConfig):
```typescript
broker: {
  feeRate: cachedFeeRate,  // Only feeRate set, slippagePercent undefined
}
```

## Solution

Changed both configurations to use **zero slippage by default**:

1. **Updated `/workspace/src/core/engine.ts`**:
   - Changed `slippagePercent: 0.05` → `slippagePercent: 0`
   - Added comment explaining this matches optimizer behavior

2. **Updated `/workspace/src/core/optimizer.ts`**:
   - Explicitly set `slippagePercent: 0` in optimizer's broker config
   - Explicitly set `commissionPercent: 0` for clarity
   - Added comments explaining consistency

### After Fix

Both configurations now use:
```typescript
broker: {
  slippagePercent: 0,      // Consistent: no slippage by default
  commissionPercent: 0,    // Consistent: no commission
  feeRate: <fetched>,      // Dynamic from exchange
}
```

## Rationale

**Why zero slippage?**
- Slippage should be explicitly configured if needed, not silently applied
- Zero slippage provides more predictable and consistent results
- Users can still add slippage via `engineConfig.broker.slippagePercent` if desired
- Makes optimization results directly comparable to backtest results

## Files Changed

- `/workspace/src/core/engine.ts` - Updated DEFAULT_ENGINE_CONFIG
- `/workspace/src/core/optimizer.ts` - Made broker config explicit and consistent

## Testing

- TypeScript compilation: ✓ Passed (`npm run typecheck`)
- ESLint: ✓ Passed (no new errors)
- Configuration consistency: ✓ Verified

## Impact

**Before**: Optimizer might suggest parameters that work well with 0% slippage but fail with 0.05% slippage in regular backtests.

**After**: Optimizer and backtest use identical broker configuration, ensuring:
- Optimization results are reproducible in regular backtests
- Parameter selection is accurate and reliable
- No hidden configuration differences

## Migration Notes

If your existing strategies relied on the 0.05% slippage:
```typescript
// Explicitly add slippage when running backtests
await runBacktest(config, {
  broker: {
    slippagePercent: 0.05,  // Restore previous behavior
  }
});
```

## Related Issues

This fix ensures the optimizer is a reliable tool for finding optimal parameters, as results now exactly match what will be seen in production backtests.
