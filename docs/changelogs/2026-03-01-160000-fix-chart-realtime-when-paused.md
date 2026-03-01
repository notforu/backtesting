# Fix: Chart Real-Time Updates When Session Paused

**Date**: 2026-03-01 16:00
**Author**: fullstack-dev

## Summary
Fixed the paper trading price chart not updating in real-time when the session is paused/stopped. Previously, WebSocket tick updates would trigger cache key changes that caused unnecessary refetches, breaking the candle merge pipeline and resetting chart zoom/scroll position.

## Changed
- **PaperTradingPage.tsx**: Stabilized `endRounded` value using `useState` + `useEffect` timer pattern
- **Chart.tsx**: Updated candle update effect to use TradingView's `update()` method for all incremental updates

## Fixed
- Chart no longer resets zoom/scroll when receiving real-time price updates
- WebSocket ticks properly merge into forming candles without triggering React Query refetches
- Paper trading charts continue updating smoothly regardless of session status (running/paused/stopped)

## Files Modified
- `src/web/components/PaperTradingPage.tsx` - Replaced inline `endRounded` recalculation with stable state value updated by timer. This prevents WS tick updates from crossing 5-minute boundaries and changing the React Query cache key.
- `src/web/components/Chart.tsx` - Updated the candle update effect to use TradingView's `update()` method for both same-count updates (WS tick merging into forming candle) and single-candle additions (new bar from WS stream). Removed conditional `setData()` calls that were resetting chart position.

## Context
### Root Cause
The paper trading chart received real-time price updates via WebSocket, but the component's render cycle had a critical bug:

1. `endRounded` was calculated inline on every render: `Math.floor(Date.now() / 300000) * 300000`
2. When a WebSocket tick arrived, it triggered a re-render
3. If that tick crossed a 5-minute boundary, `endRounded` changed
4. This changed the React Query cache key for `useCandles`
5. React Query refetched older candle history, replacing `assetCandles` with stale data
6. The WS candle merge pipeline was broken because old candles couldn't merge with the live WS tick
7. The Chart component received stale data and called `setData()` to reset the entire chart

### Solution
- **Stabilize `endRounded`**: Use `useState` to hold the value and `useEffect` with a 1-minute timer to update it predictably, not on every WS tick. This ensures React Query cache key only changes intentionally, not reactively.
- **TradingView `update()` method**: TradingView charts have two modes - `setData()` replaces all data and resets zoom, `update()` increments the last candle. Use `update()` for all incremental changes (WS ticks and new bars), preserving user zoom/scroll.

### Why Session Status Doesn't Matter
The fix applies to all session states (running, paused, stopped) because the chart's data pipeline is now decoupled from WS tick arrival timing. Whether the session is active or idle, the chart receives the same real-time price stream and merges it cleanly without triggering cache invalidations.
