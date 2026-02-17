# Prediction Market Provider Improvements

**Date**: 2026-02-14 01:22
**Type**: Enhancement
**Scope**: Data Providers (Polymarket, Manifold)

## Summary

Fixed critical data quality issues in prediction market providers that were breaking time-based strategy logic. Implemented forward-filling of missing candles, corrected Manifold open prices, added pagination for complete data fetching, and improved volume calculations.

## Changes

### 1. Forward-fill Missing Candles (Both Providers)

**Problem**: Both Polymarket and Manifold providers dropped candles for time periods with no trading activity, causing gaps in the time series.

**Impact**: Broke time-based strategy logic including:
- `maxHoldBars` exit timing
- Lookback periods for indicators
- Bar counting logic

**Fix**:
- After converting raw data to candles, iterate through full expected time range
- Insert forward-filled candles for any missing bucket
- Forward-filled candles use previous close as OHLCV (volume = 0)
- Implemented in both `convertPricePointsToCandles()` (Polymarket) and `convertBetsToCandles()` (Manifold)

### 2. Fix Manifold Open Price

**Problem**: Line 134 in `manifold.ts` used `probAfter` for open price, which represents the probability AFTER the bet was placed.

**Fix**:
- Updated `ManifoldBet` interface to include `probBefore?: number`
- Logic now uses (in order of preference):
  1. `probBefore` from first bet in bucket (if available)
  2. Previous candle's close price
  3. `probAfter` as fallback (first candle only)

### 3. Add Manifold Pagination

**Problem**: Manifold API calls limited to 1000 bets, causing incomplete historical data.

**Fix**:
- Implemented cursor-based pagination in `fetchCandles()`
- Fetches in batches of 1000 until:
  - No more results returned
  - All results are past the end date
  - Less than 1000 results in batch
- Each batch respects rate limiting via `rateLimiter.throttle()`

### 4. Replace Synthetic Volume with Real Volume

**Polymarket**:
- Volume remains count of data points (comment added explaining limitation)
- CLOB API `/prices-history` endpoint only provides `{t, p}` pairs without volume data
- Real dollar volume not available from this endpoint

**Manifold**:
- Updated `ManifoldBet` interface to include `amount?: number` field
- Changed from bet count to sum of mana wagered:
  ```typescript
  const volume = bucketBets.reduce((sum, b) => sum + (b.amount || 1), 0);
  ```
- Falls back to count of 1 per bet if amount not available

## Technical Details

### Files Modified
- `/src/data/providers/manifold.ts`
- `/src/data/providers/polymarket.ts`

### Type Safety
- All changes maintain TypeScript type safety
- Added optional fields to `ManifoldBet` interface
- Used `Array.from()` for Map iteration to avoid downlevelIteration issues

### Testing
- Files verified to compile without errors
- Syntax validation passed via node imports
- Ready for integration testing with real prediction market data

## Next Steps

1. Test with real Polymarket/Manifold backtests to verify forward-fill logic
2. Monitor pagination performance on markets with >1000 bets
3. Consider adding real volume data if alternative Polymarket endpoints become available
4. Validate that time-based exit strategies now work correctly with prediction markets

## Migration Notes

No breaking changes. Existing backtests will automatically benefit from:
- Complete candle coverage (no gaps)
- More accurate Manifold open prices
- Complete historical data (via pagination)
- Better volume estimates for Manifold
