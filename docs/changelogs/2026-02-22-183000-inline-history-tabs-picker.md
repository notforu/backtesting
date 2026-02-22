# Inline History Tabs and Aggregation Picker

**Date**: 2026-02-22 18:30
**Author**: docs-writer

## Summary
Embedded run history directly inside strategy and aggregation config tabs, and added a history picker modal for creating aggregations from past runs. This improves the workflow by showing recent runs inline and allowing quick reuse of previous strategy configurations when building multi-asset portfolios.

## Changed
- **Backend history API**: Now returns `aggregationId` and `aggregationName` fields from database; previously omitted in response mapping
- **HistoryExplorer component**: Refactored from modal-only to flexible content component with modal wrapper option
- **History filtering**: Added server-side `runType` query parameter to separate strategy vs aggregation runs

## Added
- **Server-side runType filter** (`?runType=strategies|aggregations`) in history API
  - `strategies` filters to runs where `aggregation_id IS NULL`
  - `aggregations` filters to runs where `aggregation_id IS NOT NULL`
- **HistoryExplorer refactor**: Split into `HistoryExplorerContent` (logic, reusable) and `HistoryExplorer` (modal wrapper)
  - New props: `fixedRunType`, `compact`, `showFilters`, `showGroupToggle`, `maxHeight`, `onPickRun`
  - Compact 4-column layout (Strategy, Return%, Sharpe, Date) via `CompactRunRow` component
  - Picker mode for modal-over-modal stacking with `z-[60]`
- **Inline history sections**:
  - "Recent Strategy Runs" in Strategies tab (280px scrollable, shows only strategy runs)
  - "Recent Aggregation Runs" in Aggregations tab (280px scrollable, shows only aggregation runs)
  - Clicking a run loads its config into the current tab
- **Aggregation creation flow**: "Add from History" button in `CreateAggregationModal`
  - Opens HistoryExplorer in picker mode (filtered to strategies)
  - Auto-adds selected run as sub-strategy with full params and exchange
  - Prevents duplicate symbols

## Fixed
- History API response now includes aggregation metadata that was available in DB but omitted from mapping

## Files Modified
- `src/api/routes/backtest.ts` - Response mapping fix + runType query param
- `src/data/db.ts` - HistoryFilters type + runType SQL logic
- `src/web/api/client.ts` - HistoryParams type + runType query builder
- `src/web/components/HistoryExplorer/HistoryExplorer.tsx` - Major refactor (Content + Modal)
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Inline strategy history section
- `src/web/components/AggregationsPanel/AggregationsPanel.tsx` - Inline aggregation history section
- `src/web/components/AggregationsPanel/CreateAggregationModal.tsx` - History picker button

## Context
This work completes the run history integration initiated in recent commits. By embedding history inline in the UI tabs, users can now see their recent runs and quickly reload/reuse them without opening a separate modal. The history picker for aggregation creation makes it much easier to construct multi-asset portfolios by pulling in previously backtested strategies directly from the run history, eliminating manual parameter re-entry.

The refactor to `HistoryExplorerContent` and `HistoryExplorer` creates a reusable content component that can be embedded anywhere (tabs, modals, popovers) without modal constraints, improving component flexibility.
