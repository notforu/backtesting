# Fix Strategy Re-run State Persistence & History Params Reset

**Date**: 2026-02-14 02:15
**Author**: Claude Code

## Summary

Fixed two critical bugs preventing consistent strategy re-runs: (1) IIFE closure state persistence in PM strategies causing 0 trades on re-run, and (2) frontend params race condition when loading history items. Backend now properly resets module-level state in init() methods. Frontend uses a persistent `_configSource` flag to prevent useEffect race conditions when applying history params.

## Problem

### Backend Issue: IIFE Closure State Stale on Re-run
All 3 PM strategies (pm-cross-platform-arb, pm-correlation-pairs, pm-information-edge) wrapped their `onBar` logic in IIFE closures capturing mutable state variables (barsInPosition, positionType, pricesA[], etc.). The strategy loader cached strategy instances, so on re-run the same closure with stale state was reused. For pm-cross-platform-arb specifically, `positionType` remained non-null after the first run, causing the entry guard `if (inPosition || positionType !== null) return;` to block ALL entries, resulting in 0 trades.

### Frontend Issue: useEffect Race Condition on History Load
When loading a history item and re-running, two useEffects in StrategyConfig competed to set state. The previous `_paramsFromHistory: boolean` flag had a timing bug: Effect 1 cleared the flag, then Effect 2 saw it as false and could overwrite history-loaded params with optimized params, causing incorrect config on re-run.

## Changed

- Replaced mutable IIFE closures with module-scope variables in PM strategies
- Added proper reset logic in each strategy's `init()` method to clear state before runs
- Removed unnecessary IIFE wrapper from pm-information-edge for consistency
- Replaced `_paramsFromHistory: boolean` with persistent `_configSource: 'dropdown' | 'history' | 'init'` in ConfigStore
- Updated StrategyConfig useEffects to check `_configSource === 'history'` instead of boolean flag

## Added

- State reset logic in `init()` methods:
  - pm-cross-platform-arb: barsInPosition, positionType
  - pm-correlation-pairs: pricesA, pricesB, spreads, barsInPosition, positionType
  - pm-information-edge: consistency wrapper removal

## Fixed

- pm-cross-platform-arb now consistently generates 1436 trades, +157.61% (identical on every run)
- pm-correlation-pairs now consistently generates 32 trades, +82.29% (identical on every run)
- History params no longer get overwritten by default/optimized params on re-run

## Files Modified

- `strategies/pm-cross-platform-arb.ts` - Moved barsInPosition, positionType to module scope; reset in init()
- `strategies/pm-correlation-pairs.ts` - Moved pricesA, pricesB, spreads, barsInPosition, positionType to module scope; reset in init()
- `strategies/pm-information-edge.ts` - Removed unnecessary IIFE wrapper
- `src/web/stores/backtestStore.ts` - Replaced _paramsFromHistory boolean with _configSource enum-like string; setStrategy() sets 'dropdown', applyHistoryParams() sets 'history'
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Both useEffects now check `_configSource === 'history'` to reliably skip param overwriting

## Context

The IIFE pattern was intended to encapsulate state, but without proper reset between runs it created a form of global state persistence. The fix moves these variables to module scope (still private) and adds explicit reset in init(), which is called by the pairs engine before each backtest run. This ensures a clean slate for each iteration.

The frontend race condition occurred because the boolean flag was mutated within an effect, creating a timing issue. Using a persistent string value that survives until the next explicit strategy change allows both effects to safely read it without races.

## Verification

Ran 3 consecutive backtests via API for each strategy with identical parameters and got identical results:
- pm-cross-platform-arb: 1436 trades, +157.61% (consistent)
- pm-correlation-pairs: 32 trades, +82.29% (consistent)
