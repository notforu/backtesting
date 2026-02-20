# Multi-Asset FR Spike Strategy + Funding Rate UI Features

**Date**: 2026-02-20 09:30
**Author**: Claude Code (orchestrator)

## Summary

Implemented multi-asset portfolio backtesting for the funding-rate-spike strategy, enabling simultaneous testing across 5-8 assets with combined metrics. Added comprehensive funding rate visualization and per-trade funding income tracking to the dashboard. Funding rate column now displays actual percentages, funding income shows dollar amounts, and a new funding rate histogram sub-chart provides real-time rate analysis.

## Added

- **Multi-Asset Portfolio Backtest Script** (`scripts/fr-spike-aggr-backtest.ts`)
  - Orchestrates N independent FR spike backtests across multiple assets
  - Preset configs: `--preset=conservative` (5 assets: ATOM, DOT, ADA, OP, INJ) and `--preset=moderate` (8 assets)
  - Custom asset syntax: `--assets=SYMBOL@TF,...`
  - Combines trades, equity curves, and metrics into portfolio-level results
  - Results saved to DB with strategy name "fr-spike-aggr" and symbol "MULTI"

- **Frontend Multi-Asset UI**
  - Asset selector pill tabs (Portfolio, ATOM, DOT, ADA, OP, INJ) in chart section
  - Per-asset view: fetches candles via API, filters trades by symbol, shows funding rate overlay
  - Portfolio view: displays combined equity curve and all trades across assets
  - Multi-asset detection in App.tsx (detects `symbol === 'MULTI'`)

- **Funding Rate Display Component** (`src/web/components/FundingRateChart.tsx`)
  - Histogram sub-chart below price chart for futures mode
  - Shows funding rate percentages over time
  - Integrated with trading pairs to identify rate spikes

- **Database Migration** (`migrations/003_add_funding_income_to_trades.sql`)
  - Added `funding_income` column to trades table
  - Tracks per-position funding income in dollars

## Fixed

- **Funding Rate Column** in trades table
  - Now displays actual funding rate percentages (e.g., +0.0592%)
  - Correctly formatted from database values

- **Funding Income Column** in trades table
  - Now shows dollar income per position (e.g., +$15.54)
  - Based on per-trade funding_income tracking

- **PnL Breakdown Banner**
  - Added detailed breakdown: Trading PnL, Funding Income, Total Return
  - Shows separate values for transparent P&L analysis

- **saveTrades() in db.ts**
  - Fixed missing `funding_income` column in INSERT statement
  - Ensures funding income persists to database

## Changed

- `src/core/engine.ts`
  - Enhanced to track per-trade funding income via `fundingByPositionId`
  - Funding payments now associated with specific positions

- `src/web/hooks/useBacktest.ts`
  - Added `useFundingRates` hook for fetching funding rate data
  - Returns array of { timestamp, rate } for chart rendering

- `src/web/App.tsx`
  - Integrated multi-asset tab navigation
  - Added asset selector pill tabs
  - Per-asset filtering for candles and trades

## Files Modified

- `/workspace/scripts/fr-spike-aggr-backtest.ts` (new - 150+ lines)
- `/workspace/src/web/App.tsx` (multi-asset tabs, PnL banner)
- `/workspace/src/web/components/FundingRateChart.tsx` (new)
- `/workspace/src/core/engine.ts` (per-trade funding tracking)
- `/workspace/src/core/types.ts` (fundingIncome on Trade)
- `/workspace/src/web/types.ts` (fundingIncome on Trade)
- `/workspace/src/data/db.ts` (saveTrades funding_income fix)
- `/workspace/migrations/003_add_funding_income_to_trades.sql` (new)
- `/workspace/src/web/hooks/useBacktest.ts` (useFundingRates hook)

## Results

Portfolio-level backtest (5-asset conservative preset):
- **Sharpe Ratio**: 0.96
- **Total Return**: 53.5%
- **Total Trades**: 357 (14.8 trades/month average)
- **Funding Income**: $409 over 2 years
- **Individual Assets**: ATOM 4h, DOT 4h (walk-forward validated), ADA 1h, OP 1h, INJ 4h

## Context

The funding-rate-spike strategy proved to be the highest-quality strategy after extensive backtesting and walk-forward validation (Grade B). This update enables:

1. **Portfolio Deployment**: Run FR spike across multiple assets simultaneously with combined metrics
2. **Real-Time Funding Rate Analysis**: Visual funding rate histogram helps traders understand rate behavior
3. **Per-Trade Attribution**: Funding income is now tracked and displayed separately from trading P&L
4. **Multi-Asset Visualization**: Dashboard seamlessly switches between individual asset and portfolio views

This infrastructure supports live paper trading on the validated WF survivors (ATOM 4h, DOT 4h) while maintaining flexibility to add more assets.
