# FR V3 Regime Filter and Aggregations Update

**Date**: 2026-03-17 14:00
**Author**: quant-lead

## Summary

Major update to funding-rate-spike-v3 strategy introducing improved regime filtering (EMA200 default, bear mode controls) and three new optimized aggregation portfolio designs. FR V3 Hybrid Tiered configuration achieves **Sharpe 2.42 (+29% vs V2)** and **Return 572.5%** with balanced risk exposure.

## Added

- **regimeMAType parameter**: Configure regime filter type ('sma' | 'ema') with calculateEMAValue() helper
- **bearMode parameter**: Three modes for bear market behavior:
  - `block` (default): Block all entries during bear market
  - `shortOnly`: Block longs only, allow shorts
  - `mirror`: Invert signals during bear market
- **BTC daily candle injection**: Aggregate engine auto-loads BTC daily candles for V3 strategies
- **Three new aggregation configurations** (saved to DB):
  - FR V3 Quality Core (4 symbols, Sharpe 2.31, Return 473.8%)
  - FR V3 Diversified 7 (7 symbols, Sharpe 1.73, Return 64.9%, MaxDD 6.0%)
  - FR V3 Hybrid Tiered (6 symbols, **Sharpe 2.42, Return 572.5%** — best overall)

## Changed

- **EMA200 default regime filter**: Changed from SMA200 to EMA200 (`regimeMAType: 'ema'`)
  - EMA200 reacts faster to trend changes
  - Recovers +$2,345 more bull profit vs SMA200
  - Maintains near-perfect bear protection (1 trade vs 94 for V2 unfiltered)
- **Aggregate engine enhancement**: Modified to detect and support V3 strategies automatically

## Fixed

- Bear market leakage: V2 unfiltered generated 94 spurious bear trades vs 1 for filtered V3
- Mirror mode losses: Identified and excluded mirror mode due to 673 spurious short trades causing $2,420 in losses

## Files Modified

- `strategies/funding-rate-spike-v3.ts` - Added regimeMAType and bearMode parameters, calculateEMAValue() helper
- `src/core/aggregate-engine.ts` - BTC daily candle injection logic for V3 strategies
- Database - Three new aggregation configs persisted

## Research Data

**EMA vs SMA comparison**: 510 backtests across 6 filter variants (SMA200, SMA100, SMA50, EMA200, EMA100) on 17 symbols and 5 market regimes.

**Bear mode comparison**: 340 backtests across 4 variants:
- V2 unfiltered: 94 bear trades, high drawdown
- Block mode: 1 bear trade, perfect protection
- ShortOnly mode: 47 bear trades, moderate leakage
- Mirror mode: 673 spurious trades, $2,420 losses

**Aggregation performance**:
| Configuration | Symbols | Allocation | Sharpe | Return | MaxDD |
|---------------|---------|-----------|--------|--------|-------|
| V2 Benchmark | 5 | Equal | 1.88 | 223.8% | 13.3% |
| V3 Quality Core | 4 | Optimized | 2.31 | 473.8% | 15.5% |
| V3 Diversified 7 | 7 | top_n/3 | 1.73 | 64.9% | 6.0% |
| V3 Hybrid Tiered | 6 | Weighted/3 | **2.42** | **572.5%** | 15.5% |

## Context

FR V3 improves upon V2 by:
1. **Faster regime detection**: EMA200 catches trend reversals ~2 bars earlier than SMA200
2. **Flexible bear handling**: Three modes allow users to choose between safety (block) and short opportunities (shortOnly)
3. **Diversification**: Hybrid Tiered portfolio spreads across 6 correlated symbols with mixed params, achieving +29% Sharpe improvement over V2 benchmark while maintaining acceptable drawdown

The aggregation configs represent three distinct use cases:
- **Quality Core**: Maximum Sharpe focus, fewer symbols for easier monitoring
- **Diversified 7**: Conservative approach, lowest drawdown (6.0%), broader symbol coverage
- **Hybrid Tiered** (recommended): Best balance of returns and Sharpe, production-ready configuration
