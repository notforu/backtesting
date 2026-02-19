# Realism Fixes & Dashboard Support

**Date**: 2026-02-19 10:00
**Author**: orchestrator

## Summary
Added realistic futures slippage defaults, intra-bar stop-loss/take-profit checks, and full dashboard support for exchange selection and trading mode (spot/futures). These realism improvements significantly reduce backtest performance across all strategies, reflecting true market conditions.

## Changed
- Engine defaults to 0.05% slippage for futures mode (was 0%)
- Stop-loss and take-profit now check against intra-bar high/low instead of just close price
- Dashboard now supports mode selection (spot/futures) with proper symbol format hints
- Bybit provider re-registered in provider index

## Added
- Mode selector in dashboard with hint text
- Mode state and setMode action to backtest store
- Mode forwarding through API schema and backtest routes
- Bybit to exchange dropdown

## Fixed
- CLI mode not being passed to backtest config
- Bybit provider missing from provider registration

## Files Modified
- `src/core/engine.ts` - Default futures slippage to 0.05%
- `strategies/funding-rate-spike.ts` - Intra-bar SL/TP checks
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Exchange dropdown and mode selector
- `src/web/stores/backtestStore.ts` - Mode state management
- `src/api/routes/backtest.ts` - Mode forwarding in schema
- `src/data/providers/index.ts` - Bybit provider re-registration
- `src/cli/quant-backtest.ts` - Mode passthrough fix

## Impact on Results
Performance impact after enabling realism (2-year default params, $2K capital):

| Strategy | Metric | Before | After | Change |
|----------|--------|--------|-------|--------|
| DOT 4h | Sharpe | 1.78 | 1.65 | -7.3% |
| DOT 4h | Return | 100% | 74% | -26% |
| ADA 1h | Sharpe | 1.87 | 1.60 | -14.4% |
| ADA 1h | Return | 90% | 73% | -18.9% |
| INJ 4h | Sharpe | 1.08 | 0.77 | -28.7% |
| INJ 4h | Return | 62% | 36% | -41.9% |
| ATOM 4h | Sharpe | 1.18 | 0.63 | -46.6% |
| ATOM 4h | Return | 56% | 23% | -58.9% |
| OP 1h | Sharpe | 1.16 | 0.36 | -69.0% |
| OP 1h | Return | 52% | 11% | -78.8% |

## Context
These changes improve backtest realism by:
1. **Default futures slippage**: Futures markets have inherent slippage from liquidation cascades and funding rate impacts. 0.05% is conservative for medium-size orders on major exchanges.
2. **Intra-bar SL/TP**: Real trading can exit at any price within a candle, not just the close. This prevents unrealistic exit prices and better reflects actual fills.
3. **Dashboard mode support**: Allows users to test both spot and futures strategies from the UI without CLI-only testing.
4. **Bybit support**: Extends exchange coverage for users testing on major CEXs.

The significant performance degradation is expected and healthy—it reveals which strategies are actually robust vs. which relied on unrealistic assumptions. Strategies surviving these realism checks are candidates for live trading.
