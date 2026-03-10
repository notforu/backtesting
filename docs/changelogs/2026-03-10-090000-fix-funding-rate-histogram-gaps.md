# Fix Funding Rate Histogram Gaps on Sub-8h Timeframes

**Date**: 2026-03-10 09:00
**Author**: dev-team

## Summary
Fixed a charting issue where funding rate histograms showed gaps on sub-8h timeframes (4h, 2h, 1h, etc.). Since funding rates are recorded every 8 hours but candles appear more frequently on lower timeframes, the histogram now forward-fills FR values to ensure every candle has a corresponding bar.

## Problem
- Funding rates update every 8 hours
- On a 4h chart, candles appear every 4 hours
- The histogram only rendered bars at FR timestamp intervals
- This left every other candle without a visible histogram bar, making it appear incomplete or broken

## Solution
Changed FR histogram rendering to forward-fill values:
- For each candle timestamp, find the most recent FR value at or before that timestamp
- Use that FR value for the histogram bar
- This ensures continuous coverage across all candles regardless of timeframe

## Changed
- Modified funding rate histogram rendering logic in Chart component

## Added
- None

## Fixed
- Funding rate histogram no longer shows gaps on sub-8h timeframes (4h, 2h, 1h, etc.)
- Histogram bars now appear for every candle using forward-filled FR values

## Files Modified
- `src/web/components/Chart/Chart.tsx` - Updated FR histogram rendering to forward-fill values to candle timestamps

## Context
This was a display issue on the chart component where the visual presentation of funding rates didn't match the actual data granularity. The fix ensures that users see a complete histogram regardless of which timeframe they view, improving chart readability and data visibility without changing the underlying FR data or calculations.
