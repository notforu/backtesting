# Paper Trading Full-Page View

**Date**: 2026-02-27 12:30
**Author**: fe-dev

## Summary
Moved Paper Trading from a cramped sidebar tab in the backtesting page into a dedicated full-page view with its own navigation. The application now has "Backtesting" and "Paper Trading" navigation pills in the header, allowing users to switch between modes. The paper trading page features a sidebar-main layout matching the backtesting UX, with session management, live metrics, trade visualization, and detailed performance analysis.

## Added
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` — Full-page paper trading view with:
  - Session sidebar (w-80) displaying all active/completed sessions
  - Session details panel with controls (start/stop/reset)
  - 6-metric grid (Account Value, Cash, Positions Value, Realized P&L, Total Return, Equity Growth Rate)
  - Open positions table
  - Asset tab selector for multi-asset sessions
  - Candlestick charts with trade markers (buy/sell overlays)
  - Equity curve chart (per-asset and portfolio)
  - Dashboard metrics widget
  - Full trades table (up to 200 rows) with P&L, fees, and funding rate columns
- `src/web/components/PaperTradingPage/index.ts` — Barrel export for PaperTradingPage
- `src/web/components/PaperTradingPage/paperUtils.ts` — Utility functions:
  - `mapPaperTrades()` — Converts PaperTrade DB records to backtesting Trade format for reuse in charts
  - `computePaperMetrics()` — Builds PerformanceMetrics from paper trades for consistency

## Changed
- `src/web/App.tsx` — Added conditional page rendering:
  - Added navigation pills in header (Backtesting / Paper Trading)
  - Renders PaperTradingPage when `activePage === 'paper-trading'`
  - Updated footer layout to accommodate page mode switching
- `src/web/stores/paperTradingStore.ts` — Added page navigation state:
  - New `activePage: 'backtesting' | 'paper-trading'` state
  - New `setActivePage(page)` action for switching between modes
- `src/web/stores/aggregationStore.ts` — Removed paper trading from config tabs:
  - Changed `activeConfigTab` type from `'strategies' | 'aggregations' | 'paper-trading'` to `'strategies' | 'aggregations'`
- `src/web/components/StrategyConfig/StrategyConfig.tsx` — Removed paper trading from sidebar:
  - Removed "Paper Trading" tab button
  - Removed PaperTradingPanel conditional render
  - Removed PaperTradingPanel import
- `src/web/hooks/usePaperTrading.ts` — Added bulk trade fetching:
  - New `usePaperAllTrades()` hook that fetches up to 10,000 trades for full-page view
  - Complements existing `usePaperTrades()` (paginated, sidebar mode)
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx` — Extracted shared helpers:
  - Exported `StatusBadge`, `SessionCard`, `SessionCardProps` types
  - Exported formatters: `NextTickCountdown`, `fmtUsd`, `fmtPct`, `fmtDate`, `fmtDuration`, `returnPercent`
  - Enables reuse in PaperTradingPage without duplication

## Key Design Decisions

1. **Client-side page routing**: Used Zustand `activePage` state instead of react-router for simplicity. Lightweight toggle between backtesting and paper trading modes.

2. **Component reuse**: PaperTradingPage reuses existing `<Chart />`, `<Dashboard />`, and `<PaperEquityChart />` components, reducing code duplication and maintaining UI consistency.

3. **Multi-asset support**: Sessions with multiple assets get a tab selector to view candlestick charts and trade markers per asset. Single-asset sessions show the chart directly.

4. **Trades table**: Shows up to 200 rows by default with full transaction details (entry/exit prices, P&L, fees, funding rates) for post-analysis.

5. **Sidebar-main layout**: Mirrors the backtesting page layout (session list → detail view), providing familiar navigation patterns.

## Files Modified
- `src/web/App.tsx`
- `src/web/stores/paperTradingStore.ts`
- `src/web/stores/aggregationStore.ts`
- `src/web/components/StrategyConfig/StrategyConfig.tsx`
- `src/web/hooks/usePaperTrading.ts`
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx`

## Files Added
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx`
- `src/web/components/PaperTradingPage/index.ts`
- `src/web/components/PaperTradingPage/paperUtils.ts`

## Context
Paper trading was originally embedded as a narrow sidebar tab, which constrained the UX and made viewing charts and trades difficult. Moving it to a dedicated full-page view improves usability:
- Larger canvas for candlestick charts and equity curves
- Better space for detailed trade logs and performance metrics
- Clearer visual separation between backtesting and live trading modes
- Consistent layout patterns (sidebar + main) across both modes

This also unblocks the backtesting page sidebar for future features (e.g., portfolio composition, risk analytics).
