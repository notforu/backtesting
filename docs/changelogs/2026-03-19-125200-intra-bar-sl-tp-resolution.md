# Intra-Bar SL/TP Resolution in Backtesting Engine

**Date:** 2026-03-19 12:52
**Type:** Feature
**Scope:** Backend — core engine, strategy interface, types

## Summary

Implements engine-level stop-loss (SL) and take-profit (TP) management with
intra-bar resolution using sub-candles. Previously, SL/TP exits happened at
`candle.close` price regardless of whether the candle's high/low touched the
level during the bar. This created systematically optimistic backtest results.

## Changes

### New File: `src/core/intra-bar.ts`

Pure logic module for intra-bar SL/TP resolution. Exports:

- `checkSlTpTrigger(candle, side, stopLoss, takeProfit)` — checks if a candle
  triggers SL and/or TP for a long or short position.
- `resolveAmbiguousExit(subCandles, side, stopLoss, takeProfit)` — iterates
  sub-candles chronologically to determine which level was hit first when both
  SL and TP trigger on the same bar. Pessimistic fallback (SL wins) when
  sub-candles are unavailable.
- `getSubTimeframe(mainTimeframe)` — maps main timeframes to appropriate
  sub-timeframes for resolution (e.g., `4h → 5m`, `1h → 1m`, `1d → 15m`).
- `IntraBarExitResult` interface.

### Modified: `src/strategy/base.ts`

Added two new methods to `StrategyContext` interface:

```typescript
setStopLoss(price: number | null): void;
setTakeProfit(price: number | null): void;
```

Strategies call these to register SL/TP levels. Engine checks the levels
before each subsequent `onBar()` call. Pass `null` to clear.

### Modified: `src/core/types.ts`

Added `exitReason` field to `TradeSchema`:

```typescript
exitReason: z.enum(['stop_loss', 'take_profit', 'signal', 'liquidation']).optional()
```

Engine-managed exits populate this field for analytics.

### Modified: `src/core/engine.ts`

- Added `intraBarTimeframe?: Timeframe | null` to `EngineConfig`. Set to
  `null` to disable sub-candle fetching (always pessimistic fill). Defaults
  to auto-detected from main timeframe.
- Engine tracks `activeStopLoss` and `activeTakeProfit` state variables.
- Before each bar's `strategy.onBar()` call (Step A), the engine checks if
  the current candle triggers the active SL/TP:
  - Single trigger (SL or TP only): exits at that exact price level.
  - Both triggered on same bar: fetches sub-candles to resolve chronological
    order. Falls back to pessimistic fill (SL wins) if sub-candles unavailable.
  - After engine-managed exit: `updateContext()` is called so strategy's
    `onBar()` sees the closed position and can re-enter same bar.
- Slippage is applied to engine-managed exit prices (sell direction for long
  exits, buy direction for short exits).
- `strategy.onOrderFilled()` is called after engine-managed exits with a
  synthetic order object.
- When strategy closes a position itself, SL/TP state is automatically cleared.
- Sub-candle fetching: tries DB first, falls back to exchange provider, caches
  fetched ranges to avoid redundant fetches.

### Modified: `src/core/signal-adapter.ts`

Added no-op implementations of `setStopLoss` and `setTakeProfit` to satisfy
the `StrategyContext` interface (signal adapter shadow mode doesn't need
engine-level SL/TP).

### New Tests: `src/core/__tests__/intra-bar.test.ts`

38 unit tests covering all pure logic functions:
- `checkSlTpTrigger`: long/short positions, SL/TP combinations, null values,
  exact boundary conditions.
- `resolveAmbiguousExit`: long/short, empty sub-candles, SL-first, TP-first,
  same-bar both (pessimistic), fallback cases, price/timestamp accuracy.
- `getSubTimeframe`: all 8 supported timeframes.

### New Tests: `src/core/__tests__/intra-bar-engine.test.ts`

15 integration tests running `runBacktest()` with mock strategies:
- SL and TP triggered on next bar at correct price (not candle close).
- Neither triggered: position stays open.
- Trailing stop (strategy updates SL between bars).
- Strategy clears SL/TP with null.
- Position closed by strategy automatically clears SL/TP.
- SL exit → strategy sees no position → can re-enter same bar.
- `onOrderFilled` called after engine-managed exits.
- Equity recorded correctly after SL exit.
- Slippage applied to SL/TP fill price.
- Both triggered, no sub-candles → pessimistic (SL wins).
- Both triggered, with sub-candles → correct TP resolution.
- Short position SL and TP scenarios.
- No-op when SL/TP set without open position.

## Test Coverage

- 1301 total tests pass (37 test files)
- TypeScript: no errors (`npx tsc --noEmit`)
- ESLint: no new errors (only pre-existing frontend warnings)

## Backward Compatibility

- All new fields are optional — existing backtest results and strategies are
  unaffected.
- Existing strategies that do not call `setStopLoss`/`setTakeProfit` behave
  identically to before.
- Signal adapter's no-op implementations prevent type errors in multi-asset
  aggregate engine.
