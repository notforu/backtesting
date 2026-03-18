# Fix: Critical Silent Fallback Bugs in Backtesting Engine

**Date**: 2026-03-18
**Type**: Bug Fix (Critical/High)

## Summary

Fixed five silent fallback bugs where the engine masked configuration errors
by proceeding with defaults instead of surfacing problems immediately.
All fixes follow TDD — failing tests were written first.

---

## Bug 1 (CRITICAL): Weight calculator prefix matching for funding-rate-spike variants

**File**: `src/core/weight-calculators.ts`

**Problem**: `funding-rate-spike-v2` and `funding-rate-spike-v3` were not
registered in the weight calculator registry. `getWeightCalculator()` silently
fell back to the `'default'` calculator (weight=1.0), causing `single_strongest`
allocation mode to pick signals at random instead of by funding-rate intensity.

**Fix**:
- Added longest-prefix matching to `getWeightCalculator()`. The registered
  `funding-rate-spike` key now matches `funding-rate-spike-v2`, `-v3`, etc.
- Added `'*'` wildcard registration that acts as the catch-all default for
  strategies that don't need custom weight logic (preserves backward-compat).
- Removed the previous implicit `calculatorRegistry.get('default')` fallback.
  Unknown strategies now go through explicit lookup order:
  exact match → prefix match → `'*'` wildcard → throw.

---

## Bug 2 (HIGH): Missing default case in allocation mode switch

**File**: `src/core/aggregate-engine.ts`

**Problem**: The `switch (allocationMode)` block had no `default` case.
An invalid allocation mode silently produced zero trades with no error.

**Fix**: Added `default: throw new Error(\`Unknown allocation mode: "${allocationMode}"\`)`.

---

## Bug 3 (HIGH): Strategy loading silently caught in findOrCreateStrategyConfig

**File**: `src/data/strategy-config.ts`

**Problem**: A `try/catch` swallowed `loadStrategy()` errors with the comment
"Strategy not found — use params as-is". This masked typos and misconfigured
strategy names, producing configs with incorrect (un-merged) params.

**Fix**: Removed the `try/catch`. `loadStrategy()` errors now propagate.
Updated three existing tests that documented the old silent-swallow behavior to
verify the new throw behavior instead.

---

## Bug 4 (MEDIUM): BTC candles failure for V3 was a silent no-op

**Files**: `src/core/aggregate-engine.ts`, `src/core/walk-forward.ts`

**Problem**: When BTC daily candles could not be loaded for the V3 regime
filter, both files logged a warning and returned an empty array. The regime
filter defaulted to "bull" mode, defeating the whole purpose of V3.

**Fix**: Both `loadBtcDailyCandles()` (aggregate engine) and
`loadBtcDailyCandlesIfNeeded()` (walk-forward) now throw an error when the
strategy name contains `v3` or `V3` and no candles could be loaded.

---

## Bug 5 (CRITICAL): Adapter lookup used silent fallback in result building

**File**: `src/core/aggregate-engine.ts`

**Problem**: In the result-building loop (`subStrategies.map(...)`), when
`adaptersWithData.find(...)` returned `undefined`, the code silently used
`s.params` (the un-resolved input params) instead of the adapter's resolved
params. This should never happen by construction.

**Fix**: Added an explicit `if (!awd) throw new Error(...)` guard. If the
invariant is violated, the engine fails immediately with a clear message.

---

## Tests Added

- `src/core/__tests__/weight-calculators.test.ts` — updated registry tests
  for prefix matching, v2/v3 resolution, and `'*'` wildcard behavior
- `src/core/__tests__/silent-fallback-bugs.test.ts` — new file with 17 tests
  documenting and verifying fixes for Bugs 2–5 in isolation
- `src/data/__tests__/strategy-config.test.ts` — updated 3 tests to reflect
  the new throw-on-loadStrategy-failure behavior

**Test results**: 1055 tests pass, 0 failures. TypeScript compiles cleanly.
