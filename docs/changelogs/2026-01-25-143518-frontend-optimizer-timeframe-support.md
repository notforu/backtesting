# Frontend: Add Optimizer Timeframe Support

**Date:** 2026-01-25 14:35
**Type:** Enhancement
**Component:** Frontend (Web UI)

## Summary

Updated the frontend to support timeframe-specific optimizer results. The backend API was previously updated to key optimized parameters by (strategy, symbol, timeframe), and now the frontend properly supports this structure.

## Changes Made

### 1. Type Definitions (`/workspace/src/web/types.ts`)
- Added `timeframe: string` field to `OptimizationResult` interface
- Ensures type safety across the frontend stack

### 2. API Client (`/workspace/src/web/api/client.ts`)
- Updated `getOptimizedParams()` to accept `timeframe` parameter
  - New signature: `getOptimizedParams(strategyName, symbol, timeframe)`
  - Updated route: `/api/optimize/:strategyName/:symbol/:timeframe`
- Updated `deleteOptimization()` to accept `timeframe` parameter
  - New signature: `deleteOptimization(strategyName, symbol, timeframe)`
  - Updated route: `/api/optimize/:strategyName/:symbol/:timeframe`

### 3. React Query Hooks (`/workspace/src/web/hooks/useOptimization.ts`)
- Updated `optimizationQueryKeys.optimized()` to include timeframe in cache key
- Updated `useOptimizedParams()` hook:
  - Accepts `timeframe` parameter
  - Includes timeframe in query key and API call
  - Enabled condition now checks for `timeframe` presence
- Updated `useRunOptimization()` hook:
  - Uses timeframe from result when caching new optimization
- Updated `useDeleteOptimization()` hook:
  - Accepts timeframe in mutation parameters
  - Passes timeframe to API call and cache invalidation

### 4. Strategy Config Component (`/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx`)
- Updated `useOptimizedParams` call to pass current `timeframe` from form state
- Updated optimization badge to display timeframe:
  - Shows: "Using optimized parameters for {timeframe} (Sharpe: X.XX)"
  - Example: "Using optimized parameters for 1h (Sharpe: 2.34)"
- Updated `handleClearOptimizedParams` to include timeframe when deleting
- Updated useEffect dependency array to include timeframe

## Impact

### User-Facing Changes
- Users can now optimize parameters for different timeframes independently
- Badge clearly shows which timeframe the optimized parameters are for
- Changing timeframe automatically loads the correct optimized params (if available)

### Technical Impact
- Proper cache invalidation per (strategy, symbol, timeframe) combination
- No breaking changes to existing optimizations (backend handles migration)
- Type-safe implementation prevents runtime errors

## Testing

- Ran `npm run typecheck` - passed with no errors
- Ran `npm run lint` - passed (only existing console warnings)
- All TypeScript types properly aligned with backend API

## Next Steps

- Test in browser with actual optimization runs
- Verify optimized params are properly loaded when changing timeframes
- Confirm badge displays correct timeframe information

## Related Files

- `/workspace/src/web/types.ts`
- `/workspace/src/web/api/client.ts`
- `/workspace/src/web/hooks/useOptimization.ts`
- `/workspace/src/web/components/StrategyConfig/StrategyConfig.tsx`
