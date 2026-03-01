# Paper Trading UI Improvements

**Date**: 2026-02-27 15:30
**Author**: fe-dev

## Summary
Enhanced the paper trading interface with four key improvements: clearer session naming for multi-strategy sessions, ability to create sessions from historical backtest runs, corrected price chart candle calculation, and added tabbed chart views with comprehensive trading statistics display.

## Changed
- **Config display naming**: Replaced generic "Unknown config" with meaningful session descriptions
  - Single-strategy sessions: "strategyName on SYMBOL timeframe" (e.g., "sma-crossover on BTC 1m")
  - Multi-strategy sessions: "N strategies (mode)" (e.g., "3 strategies (equal)")
  - Fallback: aggregationConfigId or "Manual config"
- **Price chart date calculation**: Fixed to use current reference point (Date.now()) instead of session creation date, ensuring latest candles are fetched
- **Chart section UI**: Converted to tabbed interface allowing users to switch between different chart views

## Added
- **"From History" paper trading session creation mode**
  - Third mode in CreatePaperSessionModal (alongside From Aggregation and Simple Strategy)
  - Fetches recent aggregation backtest runs from `/api/backtest/history?runType=aggregations`
  - Displays runs with aggregation name, date, return%, and Sharpe ratio
  - Auto-populates session name and capital from selected run
  - Uses run's aggregationId to create session

- **Tabbed chart views**
  - Per-asset view tabs: Price (default) | Equity | Drawdown | Stats
  - Portfolio view tabs: Equity (default) | Drawdown | Stats
  - New `PaperDrawdownChart` component: computes peak drawdown from equity snapshots, renders red area chart with labeled maximum drawdown
  - New `StatsTab` component: grid layout of large stat cards displaying Win Rate, Profit Factor, Expectancy, Average Win/Loss, Best/Worst Trade, Fees, and Funding Income

## Fixed
- "Unknown config" display in SessionCard and SessionDetail components
- BTC price chart showing only single candle (now properly fetches 200 bars of history)
- Missing visual distinction between different chart metric types in paper trading

## Files Modified
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` - Implemented all 4 fixes: config display naming, chart tabbing, drawdown chart integration, stats tab
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx` - Added `configDisplayName()` helper function for consistent naming across components
- `src/web/components/PaperTradingPanel/CreatePaperSessionModal.tsx` - Added "From History" mode with backtest run fetching and population
- `src/web/components/PaperTradingPage/PaperDrawdownChart.tsx` - New component for drawdown visualization

## Context
These improvements address user experience gaps identified in paper trading:

1. **Session naming clarity**: Users were confused by "Unknown config" labels when creating sessions from multi-strategy aggregations or historical runs. Now the UI clearly explains what configuration a session uses.

2. **Workflow efficiency**: Creating sessions from historical backtest runs accelerates the common flow of "test a strategy → run paper trading with same parameters". Users can now browse recent runs and instantly replicate them without manual parameter entry.

3. **Price chart accuracy**: The price chart was anchored to session creation date, causing it to miss current market data. Fixed by using current time as reference point and always fetching 200 bars of history.

4. **Complete performance visibility**: Previously only position/trade list was shown. Added comprehensive metrics (drawdown chart, win rate, profit factor, expectancy, etc.) so users can understand session performance at a glance without scrolling through individual trades.
