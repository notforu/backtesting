# Paper Trading: Real-time Price Streaming and Chart Improvements

**Date**: 2026-02-27 16:05
**Author**: fe-dev

## Summary
Enhanced paper trading dashboard with real-time WebSocket price streaming, improved chart controls, and cleaner UI. Removed duplicate stats tab and added resolution switching for equity/drawdown charts. Price chart now updates live during active sessions and displays session start markers.

## Changed
- Removed duplicate Stats tab from chart section (Dashboard metrics section already shows statistics)
- Refactored chart layout to show only Price, Equity, and Drawdown tabs
- Added real-time price streaming via Bybit public WebSocket proxied through SSE endpoint
- Implemented shared WebSocket connection pooling to avoid redundant upstream connections
- Added resolution switching (All, 1h, 4h, 1d, 1w) for Equity and Drawdown charts
- Integrated session start marker on price chart for temporal context

## Added
- `src/api/routes/price-stream.ts` - SSE endpoint that proxies Bybit public kline WebSocket
  - Shared connection pool for multiple simultaneous clients watching same symbol
  - 20-second keepalive pings for connection stability
  - Auto-reconnect on disconnect
- `src/web/hooks/usePriceStream.ts` - Frontend hook for consuming price stream
  - Connects to `/api/paper-trading/price-stream` SSE
  - Returns latest forming candle data
  - Handles connection lifecycle
- Resolution selector UI buttons in chart component
- `resampleSnapshots()` utility function for aggregating equity snapshots into time buckets

## Fixed
- Chart now reflects real-time price updates when session is running
- Equity and drawdown charts now adjustable to match user's preferred time resolution
- Session context clearer with visible start marker on price chart

## Files Modified
- `src/api/server.ts` - Registered `/api/paper-trading/price-stream` SSE route
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` - UI refactoring:
  - Removed StatsTab and StatCard components
  - Integrated `usePriceStream()` hook
  - Added resolution selector for Equity/Drawdown charts
  - Passed `startDate` prop to Chart component
  - Refactored chart rendering logic

## Context
These changes improve paper trading observability and usability. Real-time price streaming enables traders to monitor live market conditions as their bot executes, while chart resolution controls allow flexible analysis at different time scales. The removal of duplicate stats reduces cognitive load and keeps the UI focused. The shared WebSocket connection pool ensures efficient resource usage under concurrent user sessions.

Uses Node 20 built-in WebSocket API — no new dependencies added.
