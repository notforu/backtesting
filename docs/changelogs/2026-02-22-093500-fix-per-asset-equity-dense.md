# Fix Per-Asset Equity Dense

**Date**: 2026-02-22 09:35
**Author**: be-dev

## Summary
Fixed per-asset equity curve calculation in aggregate engine. Previously equity was built only at trade timestamps (sparse), causing Max Drawdown to be understated and Sharpe Ratio to be incorrectly annualized. Now using bar-by-bar dense equity tracking that includes mark-to-market unrealized PnL for open positions.

## Changed
- Per-asset equity curves now built at every candle bar (dense), not just at trade timestamps (sparse)
- Max Drawdown calculation now captures intra-trade drawdowns during open positions
- Sharpe Ratio annualization now based on actual daily/hourly returns from dense equity curve
- Rolling metrics (Sharpe, Sortino, etc.) now calculated with proper granularity matching candle frequency

## Added
- Dense equity tracker in per-asset metric calculation
- Mark-to-market unrealized PnL calculation for open positions
  - Long: (currentClose - entryPrice) * amount
  - Short: (entryPrice - currentClose) * amount
- Position state tracking (direction, entry price, entry amount) from open/close trades

## Fixed
- Per-asset Max Drawdown was understated due to sparse equity only at trade times
- Per-asset Sharpe Ratio annualization factor was wrong (sparse timestamps treated as single periods)
- Rolling Sharpe/Sortino/Calmar metrics were inconsistent with portfolio-level metrics

## Files Modified
- `src/core/aggregate-engine.ts` - Replaced sparse equity builder (lines 400-413) with dense bar-by-bar tracker

## Context
The aggregate engine calculates per-asset performance metrics (Max Drawdown, Sharpe Ratio, Sortino, rolling metrics) for each asset in a backtest. Previously, it only recorded equity values at timestamps when trades occurred. This created sparse equity curves that missed important intra-trade price movements.

For example:
- Asset enters long position at $100, price drops to $80 (20% unrealized loss), then recovers to $110 (trade closed at profit)
- Sparse tracking: Only see entry and exit, miss the $80 drawdown entirely
- Dense tracking: See every bar, capture the 20% peak-to-trough drawdown

The fix iterates over each asset's full candle history, tracking position state from trades, and calculating mark-to-market equity at each bar. This ensures per-asset metrics match the accuracy of portfolio-level metrics and properly reflect actual trading performance.

All 303 tests pass. TypeScript compiles without errors.
