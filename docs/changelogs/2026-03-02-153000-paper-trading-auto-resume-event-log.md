# Paper Trading Auto-Resume and Event Log

**Date**: 2026-03-02 15:30
**Author**: docs-writer

## Summary
Fixed critical paper trading session recovery issue and added persistent event log for operational visibility. Sessions now auto-resume on server restart instead of staying paused, and all trading events (opens, closes, funding, errors, retries) are logged to database with human-readable UI display.

## Changed
- `shutdownAll()` no longer pauses sessions in DB — only clears runtime state. Allows `restoreActiveSessions()` to find and restart them on next boot.
- Extracted duplicate event handler registration code into shared `registerEngineEventHandlers()` method for DRY principle.

## Added
- **Auto-Resume Fix**: `shutdownCleanup()` method in `PaperTradingEngine` clears timers without touching session status.
- **Persistent Event Log**: New `paper_session_events` table (migration 009) tracks all session events with human-readable descriptions.
- **Event Types**: trade_opened, trade_closed, funding_payment, error, retry, status_change (equity_update and tick_complete are noisy and skipped).
- **Event API**: `GET /api/paper-trading/sessions/:id/events?limit=100&offset=0` returns paginated event log.
- **Frontend UI**: Event Log section in PaperTradingPage with color-coded badges, max height 256px, shows latest 100 events with scroll.
- **SSE Invalidation**: Event log refreshes on new trades/errors/status changes via existing SSE stream.
- **Type Definitions**: `PaperSessionEvent`, `PaperSessionEventsResponse` in web/types.ts.
- **Utility Hook**: `usePaperSessionEvents()` in usePaperTrading.ts for event fetching and SSE sync.

## Fixed
- **Critical**: Sessions staying paused after server restart. `shutdownAll()` now preserves session status in DB so `restoreActiveSessions()` can find and resume them.
- Missing operational visibility into paper trading runs — events not persisted or displayed.

## Files Modified

### Backend
- `src/paper-trading/engine.ts` — Added `shutdownCleanup()` method to clear timers without DB mutation
- `src/paper-trading/session-manager.ts` — Fixed `shutdownAll()` to call `shutdownCleanup()`, added `persistEvent()` and `registerEngineEventHandlers()`
- `src/paper-trading/db.ts` — Added `savePaperSessionEvent()`, `getPaperSessionEvents()` for event CRUD
- `src/api/routes/paper-trading.ts` — Added `GET /api/paper-trading/sessions/:id/events` endpoint
- `migrations/009_add_paper_session_events.sql` — New table schema with columns: id, session_id, event_type, message, created_at

### Frontend
- `src/web/types.ts` — Added `PaperSessionEvent`, `PaperSessionEventsResponse` types
- `src/web/api/client.ts` — Added `getPaperSessionEvents()` client function
- `src/web/hooks/usePaperTrading.ts` — Added `usePaperSessionEvents()` hook with SSE invalidation
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` — Added Event Log section with `EventTypeBadge` component for color-coded display

## Context

**Problem**: Paper trading sessions would restart the server/redeploy and all active sessions would show as paused. Root cause: `shutdownAll()` called `engine.pause()` which set `status: 'paused'` in the database. On next boot, `restoreActiveSessions()` only queries `WHERE status = 'running'`, so paused sessions were skipped. Users had to manually resume each session.

**Solution**: Separate shutdown concerns. `shutdownCleanup()` clears in-memory timers without touching the database. Sessions remain `status: 'running'` in DB so they're automatically found and restarted during boot via `restoreActiveSessions()`. This is consistent with the principle that DB state represents user intent (session should be running) while in-memory state is transient.

**Event Log Rationale**: Paper trading runs can last days/weeks. Without persistent events, operators can't debug what happened — did the session pause? Did trades fail? When did it start recovering? Event log provides audit trail for all significant state changes (trades, funding, errors, retries) with exact timestamps and human-readable descriptions. Fire-and-forget persistence keeps hot path performance intact. SSE invalidation ensures UI stays in sync.

**Noisy Events Decision**: Equity updates and tick completes happen on every bar (thousands per session). These are filtered out of persistent log to keep DB size reasonable while still capturing all meaningful state changes.
