# Fix Paper Trading Engine Medium-Severity Issues (M2-M5)

**Date**: 2026-03-01
**Type**: Bug Fix
**Files Changed**:
- `src/paper-trading/engine.ts`
- `src/paper-trading/__tests__/engine.test.ts`
- `src/strategy/base.ts`

## Summary

Fixed 4 medium-severity issues in the paper trading engine. All fixes include new TDD tests.

## M2: Call strategy.onEnd() on session stop

**Problem**: When a paper trading session was stopped, `strategy.onEnd()` was never called, so strategies that use `onEnd` for cleanup (e.g. logging final state, releasing resources) were silently skipped.

**Fix**:
- Added a `strategy` field to the `AdapterWithConfig` internal type to store the raw strategy instance alongside its `SignalAdapter` wrapper (since `SignalAdapter` does not expose `onEnd` publicly).
- Imported `Strategy` type from `src/strategy/base.ts`.
- In `stop()`, before clearing the adapter list and cache, iterates over `this.adapters` and calls `awd.strategy.onEnd?.()` on each, with error catching per-adapter so one failure does not block others.
- Made the `context` parameter of `Strategy.onEnd()` optional in `src/strategy/base.ts` (was required), since paper trading stop has no bar context to supply.

**Test**: `M2: strategy.onEnd() is called when session stops`

## M3: Use candle timestamp for equity snapshots

**Problem**: `savePaperEquitySnapshot` was called with `timestamp = Date.now()` (wall clock), causing equity history points to not align with candle bar timestamps on the chart.

**Fix**:
- Renamed `timestamp` to `wallClockTimestamp` in `executeTick()` to clarify its purpose.
- Added `latestCandleTimestamp` tracking: updated in Step 3 whenever a bar's close price is processed.
- The equity snapshot now uses `latestCandleTimestamp` (candle time) instead of wall clock time.
- `lastTickAt`, tick events (`equity_update`, `tick_complete`), and the `TickResult.timestamp` still use `wallClockTimestamp` since those reflect when the tick ran.

**Test**: `M3: equity snapshot uses candle timestamp, not Date.now()`

## M4: Update fundingAccumulated on open positions

**Problem**: `fundingAccumulated` on DB positions was set to 0 on open and never updated during the position's lifetime. This meant the running total of funding payments was only visible on trade close, not while the position was open.

**Fix**:
- In Step 10 (update open positions), added a lookup map from `subStrategyKey → AdapterWithConfig`.
- When saving an open position's unrealized PnL, also saves `fundingAccumulated = matchingAwd.accumulatedFunding` (the adapter's running funding total).
- Falls back to `pos.fundingAccumulated` if no matching adapter is found.

**Test**: `M4: funding accumulated is updated on open positions during tick`

## M5: Remove redundant candle fetch in Step 1

**Problem**: Step 1 fetched candles per unique symbol (at the shortest timeframe for alignment), then Step 2 fetched them again per sub-strategy timeframe. The Step 1 fetch was redundant because Step 2 already has its own `perSubCandleCache` that deduplicates by `symbol:timeframe`.

**Fix**:
- Removed the Step 1 candle fetch loop entirely.
- Kept the Step 1 funding rates fetch for futures mode (this is still needed to populate `frCache` before Step 2).
- Step 2's `perSubCandleCache` now provides full deduplication: two sub-strategies on the same `symbol:timeframe` share one network call.

**Test**: `M5: candles fetched once per symbol:timeframe for two sub-strategies on same symbol`

## Test Results

- All 4 new M-series tests pass.
- All 29 pre-existing tests continue to pass.
- 2 pre-existing H2 tests (adapter caching) remain failing — these are unrelated to this change and reflect an incomplete feature added by a parallel agent.
