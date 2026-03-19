# Funding Rate Spike V4: Engine-Managed Stop Loss & Take Profit

**Date**: 2026-03-19 09:15
**Author**: be-dev

## Summary

Implemented engine-managed stop loss and take profit execution for the backtesting system. The new `funding-rate-spike-v4` strategy replaces manual exit checks with true intra-bar order triggering via `ctx.setStopLoss()` and `ctx.setTakeProfit()`. This eliminates the execution optimism of candle-close fills, revealing a 5-24% more realistic performance picture when compared to manual exit strategies.

## Changed

- **Signal adapter SL/TP methods** now store values instead of no-ops
- **Aggregate engine** added intra-bar SL/TP checking before `wantsExit()` evaluation (step 4c)
- **Single-asset engine** tracks SL/TP trigger counts for metrics reporting
- **Performance metrics schema** now captures engine-managed exit statistics
- **Mode defaulting** fixed in aggregate engine (was not defaulting to 'futures')

## Added

- `strategies/funding-rate-spike-v4.ts` - FR spike strategy using engine-managed exits
  - Identical entry logic to v2 but uses `ctx.setStopLoss()` and `ctx.setTakeProfit()`
  - Exits fill at exact SL/TP price levels instead of candle close
  - Maintains position reference for intra-bar checks

- `scripts/compare-v2-v4.ts` - Comparison tool for v2 vs v4 performance
  - Runs both strategies on same aggregation configs
  - Outputs side-by-side Sharpe, return, and drawdown metrics
  - Tracks pessimistic SL/TP instances (cases where intra-bar pricing would have been better)

- Intra-bar SL/TP trigger checking in aggregate engine:
  - `checkSlTpTrigger()` integration before signal evaluation
  - Tracks `engineStopLossCount`, `engineTakeProfitCount`, and `pessimisticSlTpCount`

## Fixed

- Aggregate engine `mode` parameter now correctly defaults to 'futures' (was missing default)
- SL/TP values now persisted in signal adapter instead of being discarded

## Files Modified

- `src/core/signal-adapter.ts`
  - `setStopLoss()` and `setTakeProfit()` now store values to `_stopLoss` and `_takeProfit`
  - Added `getActiveStopLoss()` and `getActiveTakeProfit()` getter methods
  - `confirmExit()` and `resetShadow()` now clear stored SL/TP values

- `src/core/aggregate-engine.ts`
  - Added intra-bar SL/TP trigger checking (step 4c, before `wantsExit()`)
  - Added counter fields: `engineStopLossCount`, `engineTakeProfitCount`, `pessimisticSlTpCount`
  - Fixed `mode` parameter defaulting to 'futures'
  - Metrics include exit trigger breakdown

- `src/core/engine.ts`
  - Added same counter tracking for single-asset backtests
  - Maintains compatibility with existing backtest workflows

- `src/core/types.ts`
  - Extended `PerformanceMetricsSchema` with optional exit count fields:
    - `engineStopLossCount`: Number of exits triggered by engine SL
    - `engineTakeProfitCount`: Number of exits triggered by engine TP
    - `pessimisticSlTpCount`: Cases where SL/TP would have filled better than candle close

## Comparison Results (V2 vs V4)

| Configuration | V2 Sharpe | V4 Sharpe | Change | V2 Return | V4 Return | Change | V2 MaxDD | V4 MaxDD | Change | Pessimistic |
|---------------|-----------|-----------|--------|-----------|-----------|--------|----------|----------|--------|------------|
| 7-symbol top_n (mp=3) | 3.122 | 2.883 | -8% | 159.8% | 140.8% | -12% | 7.2% | 7.3% | +0.1pp | 7 |
| 11-symbol top_n (mp=5) | 3.042 | 2.312 | -24% | 101.3% | 80.8% | -20% | 3.4% | 8.8% | +5.4pp | 22 |
| 13-symbol short-selling (mp=1) | 2.982 | 2.833 | -5% | 4216% | 2934% | -30% | 32.9% | 29.5% | -3.4pp | 9 |

**Key Finding**: V2 was systematically optimistic by 5-24% in Sharpe terms. V4 provides realistic execution by filling SL/TP at exact price levels rather than at candle close. The "Pessimistic" column shows cases where intra-bar execution was actually beneficial (e.g., 22 instances in the 11-symbol config where hitting SL/TP earlier would have been better than holding to candle close).

## Context

Engine-managed exits are critical for realistic backtesting. In V2, the system checked for exit conditions at candle close, which assumes traders can only react to prices they see at bar completion. In reality, market makers and automated strategies can exit at any price within the candle's range.

The v4 strategy uses the new `ctx.setStopLoss()` and `ctx.setTakeProfit()` API to register orders with the engine. The aggregate and single-asset engines now check these levels intra-bar using high/low prices, filling at the exact SL/TP price rather than the close. This produces 5-24% lower (more realistic) Sharpe ratios but more trustworthy backtest results.

The comparison script reveals the magnitude of the execution optimism: v2 was overstating performance across all tested configurations. These results should inform future strategy development to account for realistic intra-bar execution.
