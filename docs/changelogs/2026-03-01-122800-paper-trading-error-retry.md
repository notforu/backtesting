# Paper Trading: Auto-Retry and Error Handling Improvements

**Date**: 2026-03-01 12:28
**Author**: be-dev

## Summary
Enhanced paper trading engine with automatic retry logic for transient errors, improved error recovery, and better API error responses. Engine now distinguishes between fatal and transient errors, implements exponential backoff for retries (up to 6 attempts), and maintains running state during recovery attempts. API routes now validate session existence and return structured error details. All changes are backward compatible and thoroughly tested (116 tests passing).

## Added
- Auto-retry mechanism for transient errors (network timeouts, rate limits, connection resets, stale data)
- Exponential backoff strategy: 30s → 1m → 2m → 5m → 10m → 15m (capped at 10 retries)
- Retry state tracking: `retryCount`, `lastError`, `lastErrorAt` with public getter methods
- `isTransientError()` classifier to distinguish transient from fatal errors
- `getRetryDelay()` backoff calculator for exponential timing
- `retry` event type to PaperTradingEvent for SSE streaming
- Session state recovery: `resumeSession()` now handles 'error' state
- 7 new TDD retry tests covering all retry scenarios

## Fixed
- Engine stays in 'running' state during retries instead of immediately failing
- Only transitions to 'error' state after max retries or fatal errors
- Fatal errors (strategy not found, config errors) immediately set 'error' state
- 3 pre-existing test failures in session manager (incorrect no-engine expectations)
- Missing session existence checks in API routes before lifecycle operations
- API error responses now include structured details: `{ error, code, sessionId, timestamp }`

## Changed
- `resume()` now works from both 'paused' AND 'error' states (enables manual recovery)
- `resumeSession()` recreates engine from DB when resuming from 'error' state
- API routes return 404 for non-existent sessions and 409 for invalid state transitions
- Successful tick resets retry state to zero

## Files Modified
- `src/core/engine.ts` - Auto-retry logic, transient/fatal classification, backoff calculator, retry state tracking
- `src/api/session-manager.ts` - Error state recovery in `resumeSession()`
- `src/api/paper-trading.ts` - Structured error responses, session validation, state transition checks
- `src/types.ts` - Added `retry` event type
- `test/core/engine.test.ts` - 7 new retry tests (R1-R7), 116 total tests passing

## Context
Paper trading sessions can fail due to transient network issues that are recoverable. Previous implementation would immediately terminate on any error, forcing users to manually restart. This update implements industry-standard retry patterns with exponential backoff, keeping the engine "alive" and attempting recovery automatically. API error responses are now more informative, helping users understand why a session failed and whether recovery is possible. The session manager now supports recovery from error states, allowing users to resume after transient failures are resolved.

All changes maintain backward compatibility with existing API clients and strategy implementations.
