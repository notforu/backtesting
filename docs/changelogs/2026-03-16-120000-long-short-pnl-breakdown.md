# Long/Short PnL Breakdown in Metrics

**Date**: 2026-03-16 12:00
**Author**: development-team

## Summary

Added long/short PnL breakdown to backtesting performance metrics so users can see income contribution from each trade direction. This feature provides visibility into which trading direction (long or short) is generating profits, helping traders understand the effectiveness of each trading leg.

## Changed

- `src/core/types.ts`: Extended `PerformanceMetricsSchema` with 6 optional fields: `longPnl`, `shortPnl`, `longTrades`, `shortTrades`, `longWinRate`, `shortWinRate`
- `src/analysis/metrics.ts`: Updated `calculateMetrics()` to compute long/short breakdown by filtering close trades by `CLOSE_LONG` / `CLOSE_SHORT` directions
- `src/web/types.ts`: Added matching optional fields to `PerformanceMetrics` TypeScript interface
- `src/web/components/Dashboard/Dashboard.tsx`: Enhanced dashboard with new "Long / Short Breakdown" section displaying long/short PnL, win rates, and trade counts

## Added

- `src/analysis/__tests__/metrics.test.ts`: 6 new test cases covering:
  - No trades scenario
  - Long-only trading
  - Short-only trading
  - Mixed long/short positions
  - All winning trades
  - All losing trades
  - Partial win rate scenarios

## Fixed

N/A

## Files Modified

- `src/core/types.ts` - Schema definition for performance metrics
- `src/analysis/metrics.ts` - Metrics calculation logic
- `src/analysis/__tests__/metrics.test.ts` - Test coverage
- `src/web/types.ts` - Frontend type definitions
- `src/web/components/Dashboard/Dashboard.tsx` - Dashboard UI component

## Context

This feature works for both single-strategy backtests and aggregations since both share the same `calculateMetrics()` function and use the same `Dashboard` component for display. The section only renders when long/short data is present, ensuring backward compatibility with historical results that lack this breakdown.

The breakdown helps traders:
- Identify if one direction consistently outperforms the other
- Adjust strategy parameters for directional bias
- Understand capital allocation effectiveness between long and short positions
- Compare performance across different trading styles
