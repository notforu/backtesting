# Real-Time Equity Updates via WebSocket (CCXT Pro watchTickers)

**Date**: 2026-03-11
**Type**: Feature

## Summary

Adds continuous real-time portfolio equity updates to paper trading sessions using Bybit WebSocket mark prices via CCXT Pro `watchTickers`. The dashboard now reflects live portfolio value between engine ticks, updating every ~2 seconds as prices move.

## Changes

### New File: `/workspace/src/paper-trading/price-watcher.ts`

A new singleton service `PriceWatcher` that:

- Uses `ccxt.pro.bybit` (no API keys required — public mark price stream)
- Manages a registry of active sessions with their cash/position snapshots
- Runs a continuous `watchLoop()` calling `exchange.watchTickers(allSymbols)` in a `while` loop
- Computes equity per session on each ticker update:
  - Long positions: `markPrice * amount`
  - Short positions: `(2 * entryPrice - markPrice) * amount`
  - No positions: `equity = cash`
- Throttles emissions to 2 seconds per session (avoids SSE spam)
- Handles CCXT Pro reconnection automatically (errors are caught and loop continues)
- Auto-stops the loop when the last session is unregistered

Public API:
- `registerSession(sessionId, symbols, cash, positions, callback)`
- `unregisterSession(sessionId)`
- `updateSessionState(sessionId, cash, positions)`
- `start()` / `stop()`

### Modified: `/workspace/src/paper-trading/types.ts`

Added `realtime_equity_update` to `PaperTradingEvent` union type:
```typescript
| { type: 'realtime_equity_update'; sessionId: string; equity: number; cash: number; positionsValue: number; markPrices: Record<string, number>; timestamp: number }
```

### Modified: `/workspace/src/paper-trading/session-manager.ts`

Integrated `PriceWatcher` into the session lifecycle:

- `startSession()`: registers session with PriceWatcher after engine starts
- `resumeSession()`: re-registers session with PriceWatcher after resume
- `pauseSession()`: unregisters session from PriceWatcher
- `stopSession()`: unregisters session from PriceWatcher
- `shutdownAll()`: calls `priceWatcher.stop()` to close the WebSocket
- `registerEngineEventHandlers()`: calls `syncPriceWatcherState()` on `tick_complete` / `equity_update` events to keep position snapshots fresh
- New private `registerWithPriceWatcher()`: fetches positions from DB, builds symbol list from aggregation config + open positions, registers callback that forwards `realtime_equity_update` events directly to SSE listeners (bypassing Telegram and DB persistence)
- New private `syncPriceWatcherState()`: fire-and-forget DB refresh of cash + positions after each tick
- `persistEvent()`: now skips `realtime_equity_update` events (ephemeral, not stored)

### Modified: `/workspace/src/web/types.ts`

Added `realtime_equity_update` to the frontend `PaperTradingEvent` union type (mirrors backend).

### Modified: `/workspace/src/web/hooks/usePaperTrading.ts`

In `usePaperSessionSSE`, added `realtime_equity_update` case that:
- Uses `queryClient.setQueryData()` to directly mutate the session cache (no network refetch)
- Updates `currentEquity`, `currentCash` on the session object
- Recomputes `unrealizedPnl` on each position using the incoming mark prices

## Design Decisions

- **No API keys**: uses Bybit public WebSocket endpoints only
- **Ephemeral events**: `realtime_equity_update` is never persisted to DB or sent to Telegram
- **Throttling**: 2 s per session to avoid overwhelming SSE clients
- **Fallback**: if a symbol's mark price is unavailable, entry price is used as a fallback for that position's value
- **Auto-start**: `start()` is safe to call multiple times; the loop only starts if sessions are registered
- **ccxt.pro typing**: `ccxt.pro` is typed in the ccxt type definitions — accessed as `(ccxt as any).pro.bybit` to avoid TypeScript declaration issues with the dynamic nature of the import
