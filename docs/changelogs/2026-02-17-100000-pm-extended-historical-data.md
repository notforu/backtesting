# PM Extended Historical Data

**Date**: 2026-02-17 10:00
**Author**: docs-writer

## Summary

Extended Polymarket backtesting from 31 days to 13+ months by implementing hybrid data fetching. The provider now makes two API requests to the CLOB API and intelligently merges them: sparse long-range data (fidelity=900, ~650 points over 13+ months) combined with dense recent data (fidelity=60, ~740 points over 31 days). This increases data coverage from 741 points/31 days to 1342 points/407 days, enabling robust strategy validation over a full year of market history.

## Changed

- **Data Provider Architecture**: Modified `PolymarketProvider.fetchCandles()` to make TWO sequential API requests
  - Request 1: `fidelity=900` for long-range history (13+ months, ~1 sample every 15 hours)
  - Request 2: `fidelity=60` for dense recent history (31 days, ~1 sample per hour)
  - Intelligent merge: uses short-range data where it exists, long-range data elsewhere
  - Deduplication by timestamp ensures no double-counting

- **Data Points**: Increased from 741 to 1342 price points covering 407 days (13.5 months)
  - Old approach: only fidelity=60, limited to ~31 days of dense history
  - New approach: fidelity=60 (dense) + fidelity=900 (sparse) = full coverage

- **Merge Logic**: Automatically determines overlap point between datasets
  - Finds earliest timestamp in short-range data
  - Keeps all long-range data before that point
  - Appends short-range data for the overlap period
  - Timestamp deduplication prefers higher-fidelity data

## Added

- Hybrid data fetching strategy enabling year-long backtesting windows
- Logging of data range and fidelity breakdown for debugging
- Graceful fallback: if long-range returns no data, uses short-range only

## Files Modified

- `src/data/providers/polymarket.ts` (lines 72-125)
  - Added two API requests instead of one
  - Added merge logic to combine fidelity=900 and fidelity=60 datasets
  - Added deduplication by timestamp
  - Enhanced logging with fidelity breakdown

## Test Results with Extended Data

The extended data window revealed important strategy patterns:

**Performance Validation:**
- `pm-mean-reversion` on Playboi Carti album YAS prediction: 150% return, Sharpe 2.97, 21 trades (1h)
- `pm-mean-reversion` on Trump deportation 250-500K prediction: 30.7% return, Sharpe 1.15, 23 trades (1h)
- `pm-information-edge` confirmed as consistently losing money: -20% on most markets (needs removal or redesign)

**Backtest Duration:** Can now test strategies over 13+ months instead of 31 days, improving confidence in parameter robustness and seasonal patterns.

## Context

Previously, the Polymarket provider was limited to ~31 days of historical data because the CLOB API's `fidelity=60` parameter (highest resolution) only returns recent history. The `fidelity=900` parameter provides sparse data over 13+ months but at very low resolution (~1 sample per 15 hours).

The solution: make both requests in parallel and merge intelligently. For the recent period (where fidelity=60 exists), use the dense data. For the older period, use the sparse long-range data. This gives strategies enough history to test robustness over seasonal patterns and market structure changes, while still maintaining hour-level granularity for recent price action.

This is particularly valuable for prediction market strategies that need to observe full market lifecycle (creation → resolution) to validate mean-reversion patterns and volatility exploitation strategies.
