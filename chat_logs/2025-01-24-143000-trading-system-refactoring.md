# Trading System Refactoring - Open/Close Model with Short Support

**Date**: 2025-01-24 14:30
**Author**: be-dev

## Summary
Refactored trade model from round-trip to event-based (open/close separate records), enabling short selling and better trade visibility.

## Changed
- Trade model refactored from round-trip to event-based
- Portfolio now tracks long and short positions separately
- Metrics calculated from CLOSE trades only (where PnL is realized)
- Strategy context now uses `openLong/closeLong/openShort/closeShort` instead of `buy/sell`

## Added
- `TradeAction` enum: `OPEN_LONG`, `CLOSE_LONG`, `OPEN_SHORT`, `CLOSE_SHORT`
- Short selling support in strategies
- Balance tracking after each trade (`balanceAfter` field)
- Partial position closes supported
- `trades_v2` database table for new trade format

## Files Modified
- `src/core/types.ts` - New TradeAction, updated Trade and Position schemas
- `src/core/portfolio.ts` - New position management with open/close methods
- `src/core/broker.ts` - Updated order routing for TradeAction
- `src/core/engine.ts` - New strategy context with openLong/closeLong/openShort/closeShort
- `src/strategy/base.ts` - Updated StrategyContext interface
- `src/data/db.ts` - Added trades_v2 table, backward compatibility for legacy trades
- `src/analysis/metrics.ts` - Filter CLOSE trades for PnL calculations
- `src/web/types.ts` - Frontend type updates
- `src/web/App.tsx` - Updated trades table with action badges and balance column
- `src/web/components/Chart/Chart.tsx` - Updated trade markers for new model
- `src/cli/backtest.ts` - Updated CLI output for new trade format
- `strategies/sma-crossover.ts` - Updated to use new API with optional shorts

## Context
The old model showed trades as "BUY" with hidden sells. The new model explicitly shows every open and close event, making it clear what's happening. This enables short selling strategies, partial position closes, running balance visibility, and clearer PnL attribution (only on closes).
