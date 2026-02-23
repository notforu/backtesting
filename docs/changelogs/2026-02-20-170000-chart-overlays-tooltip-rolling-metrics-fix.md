# Chart Overlays, Tooltip, and Rolling Metrics Fix

**Date**: 2026-02-20 17:00
**Author**: fullstack-dev

## Summary

Added interactive crosshair tooltip for chart data inspection, implemented toggleable metric overlays (ROI/Drawdown/Sharpe/Win Rate) in the history explorer, and fixed empty performance charts in multi-asset backtests by persisting rollingMetrics to PostgreSQL.

## Changed

### Chart Crosshair Tooltip
- Displays OHLC candle data, funding rate, and active overlay metric values on hover
- Positioned at top of chart, follows cursor horizontally
- Color-coded styling: green/red for close vs open price, unique colors per metric overlay
- Updates in real-time as user moves cursor across chart

### Toggleable Metric Overlays
- Four new overlay options: ROI (blue line), Drawdown (red area), Rolling Sharpe (purple), Win Rate (amber)
- Toggle buttons in chart toolbar: ROI, DD, SR, WR
- Metrics render in bottom 25% of chart area alongside funding rate histogram
- Metric values appear dynamically in crosshair tooltip when overlays are active
- Candle rendering area auto-adjusts when overlays active to prevent overlap

### Rolling Metrics Persistence
- Multi-asset backtest results now show performance charts instead of empty state
- `rollingMetrics` now saved to PostgreSQL `rolling_metrics JSONB` column
- Chart component reads persisted metrics and renders overlays
- Fixes issue where only single-asset backtests had visible performance data

## Added

- `migrations/004_add_rolling_metrics.sql` — adds `rolling_metrics JSONB` column to `backtest_runs` table
- Crosshair tooltip component with OHLC, FR, and metric display
- Overlay toggle buttons in Chart component toolbar
- `calculateRollingMetrics` export from analysis module

## Fixed

- Empty performance chart in multi-asset history explorer (metrics now persisted)
- Single-asset backtests now also persist rolling metrics for consistency
- Chart overlays now display metric values in tooltip on hover

## Files Modified

- `src/web/components/Chart/Chart.tsx` — added tooltip component, overlay toggle buttons, metric rendering logic
- `src/web/App.tsx` — pass `rollingMetrics` prop to Chart component
- `src/data/db.ts` — `saveBacktestRun()` persists rolling_metrics, `getBacktestRun()` loads rolling_metrics
- `src/api/routes/backtest.ts` — calculate and pass rollingMetrics for multi-asset results
- `src/analysis/index.ts` — export `calculateRollingMetrics` function
- `migrations/004_add_rolling_metrics.sql` — new migration file

## Context

The history explorer was showing empty charts for multi-asset backtests because rollingMetrics were calculated in memory but never persisted to the database. The chart component had no data to load and render. Additionally, users had no way to inspect individual metric performance without drilling into raw trade data.

The solution persists metrics to PostgreSQL (following the recent SQLite-to-PostgreSQL migration) and adds interactive overlays so users can visualize strategy performance across multiple dimensions: cumulative return, drawdown curve, rolling risk-adjusted returns, and win rate trends.

Tooltip enhancement allows quick inspection of candle details and metric values without hovering over separate legend items.
