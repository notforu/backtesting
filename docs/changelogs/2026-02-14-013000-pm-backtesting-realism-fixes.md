# Prediction Market Backtesting Realism Improvements

**Date**: 2026-02-14 01:30
**Author**: Agent

## Summary

Major overhaul of prediction market backtesting to improve accuracy and realism. Fixed 13 critical issues across data providers, execution models, and strategy logic. Changes include forward-filling missing market data, correcting cash flow calculations for short-selling, adding realistic slippage, and fixing mathematical errors in strategy calculations. Spans 12 files with 345 insertions and 81 deletions.

## Changed

### Data Provider Fixes
- **Forward-fill missing candles**: Both Polymarket and Manifold providers now fill gaps in market data by carrying forward the previous candle's close price with volume=0, preventing incorrect backtest results from missing data
- **Manifold open price correction**: Changed from using probAfter (incorrect) to probBefore or previous candle's close, ensuring proper OHLC integrity
- **Manifold pagination**: Implemented cursor-based pagination to fetch ALL bets instead of stopping at 1000-bet limit
- **Manifold volume calculation**: Updated to use actual mana wagered (bet amounts) instead of simple bet count, providing realistic volume metrics

### Engine/Execution Model Fixes
- **Polymarket trading fees**: Set to 0% (CLOB has zero protocol fees; real costs are modeled via slippage instead)
- **Default slippage for prediction markets**: Added 2% default slippage for both polymarket and manifold exchanges in main engine and pairs engine
- **Short-selling cash flow correction**: Fixed critical bug where shorting prediction markets now correctly locks up `(1-price)*amount` as capital (when buying NO shares) instead of only deducting trading fees
- **Pairs engine slippage**: Added slippage to ALL fills (previously filled at exact close price without slippage penalty)

### Strategy Logic Fixes
- **pm-correlation-pairs log(0) crash**: Clamped probability values to minimum 0.001 before Math.log to prevent undefined behavior
- **pm-information-edge ROC bias**: Switched from relative probability change to absolute change to avoid disproportionate triggers on low-probability events
- **pm-cross-platform-arb clarity**: Reworked description to clarify same-platform pairs as primary mode (Manifold operates with play money)
- **Extreme price avoidance**: Added `avoidExtremesPct` parameter to arb and correlation strategies to skip trades near 0/1 probabilities where data is unreliable
- **Position sizing cap**: Added `maxPositionUSD` cap ($1000 default) to all three PM strategies to prevent oversizing on thin prediction markets

## Added

- Forward-fill logic in both `polymarket.ts` and `manifold.ts` data providers
- Cursor-based pagination implementation in `manifold.ts`
- `avoidExtremesPct` parameter to pm-correlation-pairs, pm-cross-platform-arb, and pm-information-edge strategies
- `maxPositionUSD` parameter to all three PM strategies for risk management
- Improved slippage handling in pairs engine fill logic

## Fixed

- Cash flow calculation for prediction market short positions (critical bug affecting portfolio value)
- Probability clamping to prevent Math.log(0) crashes
- Relative vs absolute change calculation in information edge strategy
- Missing candle data causing backtests to skip trading days
- Manifold volume reported as bet count instead of actual mana wagered
- Manifold open price using incorrect data point
- Pairs engine fills executing at exact price without slippage penalty

## Files Modified

- `src/data/polymarket.ts` - Forward-fill missing candles, fee correction
- `src/data/manifold.ts` - Forward-fill missing candles, probBefore for open, pagination, mana volume
- `src/core/engine.ts` - Added 2% default slippage for prediction market exchanges
- `src/core/pairs-engine.ts` - Added slippage to fills, added default slippage for PM exchanges
- `src/core/portfolio.ts` - Prediction market short-selling cash flow fix
- `src/core/pairs-portfolio.ts` - Prediction market short-selling cash flow fix
- `src/core/leveraged-portfolio.ts` - Prediction market short-selling cash flow fix
- `src/core/leveraged-portfolio.test.ts` - Updated test assertions for corrected cash flows
- `strategies/pm-correlation-pairs.ts` - Log(0) crash fix, avoidExtremesPct, maxPositionUSD
- `strategies/pm-cross-platform-arb.ts` - Description clarity, avoidExtremesPct, maxPositionUSD
- `strategies/pm-information-edge.ts` - ROC bias fix, avoidExtremesPct, maxPositionUSD

## Context

Prediction market backtests were producing unrealistic results due to multiple compounding issues:

1. **Data gaps**: Missing market data caused entire trading days to be skipped during backtests
2. **Incorrect cash flows**: Short-selling logic didn't account for margin requirements, inflating available capital
3. **No slippage**: Prediction markets were assumed to trade at exact probabilities, ignoring real bid-ask spreads
4. **Strategy bugs**: Mathematical errors in signal generation and probability handling
5. **Oversizing risk**: Strategies could take positions larger than appropriate for thin markets

These fixes establish a more realistic simulation of prediction market mechanics, where:
- Markets have realistic data continuity (forward-filled gaps)
- Trades incur 2% slippage to model bid-ask spreads
- Short positions correctly consume margin
- Probability-based calculations handle edge cases properly
- Position sizes are capped to prevent unrealistic concentration

This provides more confidence in backtest results before live deployment.
