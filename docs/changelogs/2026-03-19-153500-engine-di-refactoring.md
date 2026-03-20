# Engine DI Refactoring - Core Loop Extraction

**Date**: 2026-03-19 15:35
**Author**: be-dev

## Summary

Extracted pure core loop functions from both backtesting engines to enable unit testing of previously untestable financial logic. Made the core bar processing loop, strategy lifecycle, position management, and metrics calculation deterministic and database-independent, allowing comprehensive unit test coverage of financial calculations via dependency injection.

## Changed

- **`src/core/engine.ts`**: Refactored to separate orchestration from core loop logic
  - Extracted `runCoreBacktestLoop()` as pure function with zero database dependencies
  - Main `runBacktest()` now acts as thin orchestrator (data loading → core loop → metrics → DB save)
  - Core loop injection points: `subCandleResolver` callback for SL/TP resolution
  - Public API remains unchanged (backward compatible)

- **`src/core/aggregate-engine.ts`**: Same pattern applied to multi-asset portfolio engine
  - Extracted `runCoreAggregateLoop()` as pure function
  - Exported `AdapterWithData` interface for test use
  - `runAggregateBacktest()` refactored as orchestrator
  - Backward compatible public API

## Added

- **`src/core/__tests__/core-backtest-loop.test.ts`**: 44 tests covering single-asset engine core loop
  - Strategy lifecycle (init → on_bar → on_exit for each candle)
  - Bar processing order and loop bounds
  - Early stop conditions (date range, max trades, drawdown)
  - Equity curve tracking and per-trade equity snapshots
  - Trade execution (entry, exit-before-entry enforcement, same-bar re-entry)
  - Fee handling (taker fees, maker fees, funding rate payments)
  - Funding rate application (long/short sign, zero padding, exact timing)
  - Engine-managed SL/TP with sub-candle resolution
  - Indicator freshness (current bar not in calculations)
  - Zero trades, single trade, many trades edge cases
  - Position management during exits and re-entries

- **`src/core/__tests__/core-aggregate-loop.test.ts`**: 44 tests covering multi-asset portfolio engine
  - Capital allocation modes (top_n, weighted_multi, single_strongest)
  - Signal selection and ranking
  - Per-asset position management (long/short, simultaneous signals)
  - Funding rate application across assets
  - Position sizing and equity per asset
  - Multi-symbol equity curve aggregation
  - Portfolio and per-asset metrics
  - SL/TP across assets with sub-candle resolver
  - Slippage and fee handling in multi-asset context
  - Missing data/candles handling
  - Extreme moves and resolution edge cases

## Fixed

- Mutation testing vulnerability: mutations inside main loop (funding rate sign flips, loop off-by-one, early stop bypass) are now detectable by unit tests instead of slipping through
- Test coverage gap: core financial logic was previously untestable without live database connection
- Determinism: core loop functions now pure and fully testable with synthetic data (zero mocking required)

## Files Modified

- `src/core/engine.ts` - Extracted core loop, refactored orchestrator
- `src/core/aggregate-engine.ts` - Extracted core loop, refactored orchestrator
- `src/core/__tests__/core-backtest-loop.test.ts` - NEW (44 tests)
- `src/core/__tests__/core-aggregate-loop.test.ts` - NEW (44 tests)

## Context

Rule 6 (Critical Test Coverage for Financial Logic) requires 100% unit test coverage with all corner cases for code affecting backtesting calculations, position sizing, capital allocation, PnL, metrics, equity curves, and trade execution. The main loop functions previously violated this because they were tightly coupled to the database layer, making unit testing impossible without mocking.

This refactoring makes the core financial logic deterministic and injectable, allowing comprehensive synthetic testing. The extracted functions are pure (zero side effects, fully deterministic given inputs), enabling mutation testing to detect subtle bugs like off-by-one errors in loop bounds, sign flips in funding rate calculations, and incorrect position management edge cases.

All 1514 tests pass (42 test files). 88 new tests added for the extracted core loops. All existing integration tests remain unchanged and passing, confirming backward compatibility.
