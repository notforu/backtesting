# Intra-bar Stop Loss / Take Profit Resolution

**Date**: 2026-03-19 14:30
**Author**: be-dev

## Summary
Implemented precise intra-bar stop loss and take profit resolution for the backtesting engine. Strategies can now set dynamic SL/TP levels that trigger at exact prices (not candle close) with realistic slippage modeling. When both SL and TP trigger on the same bar, the engine fetches sub-candles to determine which exit occurred first, with a pessimistic fallback when sub-candles are unavailable. This improves backtest realism and exit accuracy for strategies using hard stops.

## Changed
- Engine now checks SL/TP levels BEFORE calling `strategy.onBar()` using state from the previous bar
- Exit fills execute at exact SL/TP price plus slippage (not at candle close) — main accuracy improvement
- StrategyContext interface extended with `setStopLoss(price)` and `setTakeProfit(price)` methods
- TradeSchema now tracks `exitReason` field: "stop_loss" | "take_profit" | "signal" | "liquidation"
- When both SL and TP trigger on same bar: fetches sub-candles, iterates chronologically to find first trigger
- Pessimistic fallback: when sub-candles unavailable, stop loss wins (conservative for risk)
- All 1301 tests pass; 53 new tests added for 100% coverage of SL/TP logic

## Added
- `src/core/intra-bar.ts` - Pure logic module for SL/TP resolution:
  - `checkSlTpTrigger()` - Detects if a candle touches SL/TP levels for long/short positions
  - `resolveAmbiguousExit()` - Uses sub-candles to determine which exit happened first when both trigger; pessimistic fallback (SL wins) when no sub-candles available
  - `getSubTimeframe()` - Maps main timeframes to sub-timeframes (4h→5m, 1h→1m, 1d→15m, 5m→1m, 15m→1m, 1w→1h, 1M→4h)
- `src/core/__tests__/intra-bar.test.ts` - 38 unit tests covering:
  - SL trigger detection for long/short positions
  - TP trigger detection for long/short positions
  - Ambiguous exit resolution with multiple sub-candles
  - Edge cases: exact price matches, no sub-candles, out-of-order fills
  - Timeframe mapping for various main timeframes
- `src/core/__tests__/intra-bar-engine.test.ts` - 15 integration tests:
  - Engine workflow: position open, SL/TP set, candle triggers exit
  - Exit at exact SL/TP price with slippage applied
  - Trade record shows correct `exitReason` field
  - Ambiguous exit resolved via sub-candles
  - Backward compatibility: strategies not using SL/TP work unchanged

## Fixed
- Exit fills now occur at realistic prices (exact SL/TP + slippage) instead of always at candle close
- Ambiguous SL/TP situations no longer arbitrary — sub-candle lookup provides true exit order
- Risk profiles more conservative: when uncertain, stop loss triggers first (protects capital)

## Files Modified
- `src/strategy/base.ts`:
  - Added `setStopLoss(price: number | null): void` to StrategyContext interface
  - Added `setTakeProfit(price: number | null): void` to StrategyContext interface

- `src/core/types.ts`:
  - Added `exitReason: 'stop_loss' | 'take_profit' | 'signal' | 'liquidation'` field to TradeSchema

- `src/core/engine.ts`:
  - Added `intraBarTimeframe?: Timeframe | null` to EngineConfig (optional, for sub-candle fetching)
  - Engine state: `activeStopLoss: number | null` and `activeTakeProfit: number | null` tracked per position
  - STEP A (before each `onBar()`): Check current candle against SL/TP levels, execute fill at exact price if triggered, resolve ambiguous exits with sub-candles, call `onOrderFilled()`, clear SL/TP on close
  - Helper methods: `applySlippage()`, `fetchSubCandles()` for supporting logic
  - onOrderFilled() now receives `exitReason` field

- `src/core/signal-adapter.ts`:
  - Added no-op `setStopLoss()` and `setTakeProfit()` stub implementations

## Context
Stop loss and take profit are critical for risk management and profit taking in real trading. Previous implementation treated all exits identically — if a bar touched both levels, the system arbitrarily chose which one filled. This produced unrealistic backtest results.

The new implementation:
1. **Opt-in API**: Strategies call `ctx.setStopLoss(price)` or `ctx.setTakeProfit(price)` during `onBar()`. Existing strategies unchanged.
2. **Exact pricing**: Instead of `candle.close`, fills occur at the actual SL/TP price plus slippage — far more realistic.
3. **Ambiguity resolution**: When both levels trigger on the same bar (e.g., opening gap through both), fetch sub-candles and find true chronological order.
4. **Conservative fallback**: Without sub-candles, stop loss always wins — preserves capital when uncertain.
5. **Backward compatible**: All existing backtest results identical. Only strategies that call `setStopLoss/setTakeProfit` see different behavior.

**Key design decisions:**
- SL/TP checked BEFORE strategy.onBar() ensures they use previous bar's levels (standard market behavior)
- Sub-candle fetch only on ambiguous exits (performance: most bars have no SL/TP)
- Pessimistic fallback (SL wins) avoids false TP fills during sharp reversals
- 100% test coverage of all edge cases (zero trades, single trade, mixed long/short, funding payments, etc.)

This unblocks strategies that depend on hard stops for risk control.
