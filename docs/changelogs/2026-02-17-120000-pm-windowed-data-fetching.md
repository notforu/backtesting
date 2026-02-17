# Polymarket Windowed Data Fetching

**Date**: 2026-02-17 12:00
**Author**: system

## Summary

Replaced the Polymarket data provider's dual-request approach with a windowed pagination strategy using `startTs`/`endTs` parameters. This dramatically increases available data from ~740 points (31 days) to 4,000-8,000+ real hourly data points covering the full life of a market.

## Changed

- **File**: `src/data/providers/polymarket.ts` - `fetchCandles()` method rewritten
- Old approach: 2 requests with `interval=all` capped at ~740 points each
- New approach: 1 discovery request (fidelity=900) to find market range, then N windowed requests (fidelity=60, 15-day windows) to get full hourly history
- Key insight: CLOB API's `startTs`/`endTs` parameters are mutually exclusive with `interval`. Dropping `interval=all` and chunking into 15-day windows bypasses the ~740 point cap entirely.

## Added

- Windowed pagination logic in `fetchCandles()` to query 15-day chunks
- Market discovery phase to find min/max timestamps
- Proper handling of market creation to current time
- Better error handling for market discovery phase

## Fixed

- Data availability limited to ~31 days (now covers full market lifetime)
- Low real candle fill ratio for older data (~10% previously, now 99.7%)
- Insufficient data for walk-forward validation (need 6+ months)

## Test Results

- **Judy Shelton market**: 4,663 real points, 99.7% fill ratio, 195 days
- **Byron Donalds market**: 5,101 real points, 99.7% fill ratio, 213 days
- Previously both would have returned only ~740 points covering 31 days

## Impact

- **6-7x more real data points** per market on average
- 99.7% real candles vs ~10% previously for older data
- Enables statistically meaningful backtesting (more trades per market)
- Walk-forward validation now practical with 6+ months of data
- No API key requirements or cost changes (same free CLOB API, used correctly)
- Improved strategy research and optimization for Polymarket pair trading

## Files Modified

- `src/data/providers/polymarket.ts` - Complete rewrite of `fetchCandles()` method

## Context

The CLOB API has strict limitations on data retrieval. The previous implementation used `interval=all` which caps results at ~740 points regardless of actual market history. The new approach recognizes that `startTs`/`endTs` parameters are mutually exclusive with `interval`, allowing us to query arbitrary time ranges in 15-day windows. This single insight unlocks 6-7x more historical data without any API changes or authentication changes.

This is critical for PM strategy research because longer histories enable:
1. More statistically robust backtests
2. Proper walk-forward validation across market lifecycles
3. Better parameter optimization with more diverse market conditions
4. Identification of market regimes and strategy robustness

