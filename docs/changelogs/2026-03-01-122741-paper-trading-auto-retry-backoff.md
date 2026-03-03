# Paper Trading Auto-Retry with Exponential Backoff

**Date:** 2026-03-01
**Type:** Feature

## Summary

The paper trading engine now auto-retries on transient errors (network timeouts, rate limits, stale data, etc.) instead of permanently dying on any error. Sessions survive temporary exchange outages and resume automatically.

## Changes

### `src/paper-trading/types.ts`
- Added `retry` event type to `PaperTradingEvent`:
  ```typescript
  | { type: 'retry'; sessionId: string; retryCount: number; nextRetryAt: number; error: string }
  ```

### `src/paper-trading/engine.ts`
- Added module-level constants: `MAX_RETRIES = 10`, `RETRY_DELAYS_MS = [30s, 1m, 2m, 5m, 10m, 15m]`
- Added private retry state fields: `retryCount`, `lastError`, `lastErrorAt`
- Added public read-only getters: `currentRetryCount`, `currentLastError`, `currentLastErrorAt`
- Updated `scheduleTick()` catch block with retry logic:
  - Classifies errors as transient vs fatal using `isTransientError()`
  - On transient error: increments `retryCount`, emits `retry` event, schedules next retry with backoff, keeps status as `'running'`
  - On max retries exceeded: sets `status = 'error'`, emits `error` and `status_change` events
  - On fatal error: immediately sets `status = 'error'` (previous behavior)
  - After successful tick: resets `retryCount`, `lastError`, `lastErrorAt` to zero/null
- Added `isTransientError(error: unknown): boolean` helper that classifies:
  - **Transient**: ECONNRESET, ECONNREFUSED, ETIMEDOUT, network errors, timeout, rate limits (429), 5xx server errors, "no candles", stale data, SQLITE_BUSY, connection pool errors, "no valid sub-strategies"
  - **Fatal**: "session not found", "strategy X not found", "not found", validation errors, invalid config, out of memory
- Added `getRetryDelay(): number` helper returning delay from `RETRY_DELAYS_MS` based on `retryCount`
- Updated `resume()` to also accept `'error'` status (previously only allowed `'paused'`):
  - Resets retry state on manual resume
  - Clears `errorMessage` in DB on resume

### `src/paper-trading/session-manager.ts`
- Updated `resumeSession()` comment to reflect it now handles both `'paused'` and `'error'` states
- When no engine is in memory and session is in `'error'` state, creates new engine and starts it (same as `'paused'` behavior)

### `src/paper-trading/__tests__/engine.test.ts`
- Added 7 new TDD tests for retry behavior (R1-R7):
  - **R1**: Transient network error keeps status `running`, increments `retryCount`, emits `retry` event
  - **R2**: Fatal error ("Strategy X not found") immediately sets `status = 'error'`, does NOT retry
  - **R3**: `getRetryDelay()` returns increasing delays: 30s, 1m, 2m, 5m, 10m, 15m (capped)
  - **R4**: After `MAX_RETRIES` exceeded, next transient error sets `status = 'error'`
  - **R5**: Successful tick resets `retryCount = 0`, `lastError = null`, `lastErrorAt = null`
  - **R6**: `resume()` from `'error'` state transitions to `'running'`, resets retry state
  - **R7**: `isTransientError()` correctly classifies network/rate-limit errors as transient, config/strategy errors as fatal

### `src/paper-trading/__tests__/session-manager.test.ts`
- Fixed 3 pre-existing test failures where tests expected throws for graceful no-engine operations:
  - `stop without engine` now correctly tests that DB is updated to `'stopped'` (not a throw)
  - `pause without engine` now correctly tests that DB is updated to `'paused'` (not a throw)
  - `resume without engine` now correctly tests that engine is re-created from DB and started

## Behavior

### Before
- Any error during a tick → session permanently set to `'error'` state
- Network blip at night = dead session requiring manual intervention

### After
- Transient errors → auto-retry with exponential backoff (30s → 1m → 2m → 5m → 10m → 15m)
- Session stays in `'running'` state during retries; `retryCount` and `lastError` stored in DB
- After 10 consecutive failures → permanent `'error'` state
- Manual `resume()` from `'error'` state resets retry count and starts fresh
- Fatal errors (strategy not found, config invalid) still die immediately

## Test Results
- 41 engine tests pass (including 9 new retry tests)
- 116 total paper trading tests pass
- TypeScript compiles without errors
