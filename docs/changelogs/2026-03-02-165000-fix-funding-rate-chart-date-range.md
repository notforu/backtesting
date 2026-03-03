# Fix: Empty Funding Rate Chart in Paper Trading

**Date**: 2026-03-02 16:50
**Author**: docs-writer

## Summary
Fixed a bug where the funding rate chart displayed no data in paper trading sessions. The Chart component was querying funding rates using the session's start/end dates, which were too narrow for historical candles. The fix derives the query range from actual displayed candle timestamps instead.

## Changed
- `src/web/components/Chart/Chart.tsx` - Updated funding rate query logic to use candle timestamp range

## Fixed
- Funding rate chart returning 0 results in paper trading (previously queried only from session creation time)
- Chart now correctly queries the full range of displayed historical candles

## Technical Details
The bug occurred because:
1. Paper trading sets `startDate` = `session.createdAt` and `endDate` = `Date.now()`
2. Chart component displays ~200 historical candles going back much further than session creation
3. Funding rate query used these session-based dates, missing all the historical data

The fix:
1. Extract actual displayed candle timestamps from `candles[0].timestamp` to `candles[last].timestamp`
2. Use that range for funding rate queries
3. Fall back to `startDate`/`endDate` props when candles haven't loaded yet

## Verification
Production verification shows the query now returns 100 funding rate records (vs 0 with old logic) when using the correct candle-based date range.

## Files Modified
- `src/web/components/Chart/Chart.tsx` - Derive funding rate query range from displayed candles
