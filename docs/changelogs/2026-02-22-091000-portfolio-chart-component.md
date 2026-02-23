# Portfolio Chart Component

**Date**: 2026-02-22 09:10
**Type**: Feature Addition

## Summary
Added PortfolioChart component for the multi-asset Portfolio tab, replacing the text placeholder with interactive charts showing portfolio performance over time with configurable overlay metrics and trade markers.

## Changed
- Portfolio tab now displays interactive equity curve visualization instead of placeholder text
- Chart supports multiple overlay metrics: ROI, Drawdown, Rolling Sharpe, Win Rate
- Trade markers integrated showing long/short entry points on equity line

## Added
- `src/web/components/Chart/PortfolioChart.tsx` - New component with:
  - TradingView Lightweight Charts line chart for portfolio equity curve
  - Overlay toggle controls (ROI blue, Drawdown red area, Rolling Sharpe purple, Win Rate orange)
  - Trade markers (green triangles for OPEN_LONG, red for OPEN_SHORT)
  - Crosshair tooltip showing equity value and overlay data
  - Zoom controls (in, out, fit) matching existing Chart component
  - Dark theme consistent with platform styling

## Fixed
- Portfolio tab now functional and provides visual feedback on portfolio performance

## Files Modified
- `src/web/components/Chart/PortfolioChart.tsx` - New file
- `src/web/App.tsx` - Replaced Portfolio tab placeholder with PortfolioChart component

## Context
The Portfolio tab previously showed only placeholder text. This component integrates the same charting patterns established in the single-strategy Chart component, allowing users to visualize aggregate portfolio performance across multiple backtests. The component accepts portfolio-level equity curve, rolling metrics, and trade data from AggregateBacktestResult type.

## Technical Notes
- Reuses TradingView Lightweight Charts library for consistency
- Maintains dark theme and visual patterns from existing Chart.tsx
- Overlay toggles allow users to focus on specific metrics
- Trade markers help identify entry/exit patterns at portfolio level
