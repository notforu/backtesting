# Funding Rate Optimization & Walk-Forward Testing

**Date**: 2026-02-18 18:00
**Author**: docs-writer

## Summary
Added `mode` parameter (spot/futures) support to core optimizer and walk-forward modules, enabling futures trading validation. Completed grid search optimization on top 5 funding-rate-spike strategy candidates and ran comprehensive walk-forward validation to assess robustness. Pre-cached 2-year historical candle data for all 5 symbols.

## Changed
- `src/core/optimizer.ts` - Added `mode` parameter to grid search (defaults to 'spot', supports 'futures')
- `src/core/walk-forward.ts` - Added `mode` parameter to walk-forward testing
- `src/cli/quant-optimize.ts` - Added `--mode=futures` CLI flag to grid search tool
- `src/cli/quant-walk-forward.ts` - Added `--mode=futures` CLI flag to walk-forward tool

## Added
- Grid search results for ATOM 4h, ADA 1h, INJ 4h, DOT 4h, OP 1h in backtest result storage
- Walk-forward test results validating optimization robustness over 2024-2026 period
- 2-year pre-cached candle data for all 5 symbols (2024-01-01 to 2026-01-01)

## Files Modified
- `src/core/optimizer.ts` - Core grid search logic updated to support futures mode
- `src/core/walk-forward.ts` - Walk-forward testing logic updated to support futures mode
- `src/cli/quant-optimize.ts` - CLI tool updated with --mode flag
- `src/cli/quant-walk-forward.ts` - CLI tool updated with --mode flag

## Context
The funding-rate-spike strategy (`strategies/funding-rate-spike.ts`) trades perpetual futures on Bybit, not spot markets. To properly validate this strategy, the core backtesting modules needed to support futures trading mode. This allows accurate testing on leverage and funding rate mechanics specific to derivatives trading.

The optimization and walk-forward testing revealed that ATOM 4h and DOT 4h are robust across the full 2024-2026 period, while ADA 1h, OP 1h, and INJ 4h overfit to specific market conditions in 2024. The analysis informs deployment strategy: use multiple symbols with default (moderate) params rather than over-optimized thresholds.
