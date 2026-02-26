# Params Modal and Explorer Improvements

**Date**: 2026-02-25 19:30
**Author**: fe-dev

## Summary
Major improvements to the Run Params Modal, History Explorer, and header UX. Added editable params modal for aggregation runs with support for ad-hoc backtest execution, new API endpoint for inline aggregation runs, and enhanced history explorer with params tooltips and visual highlighting.

## Added
- **Params button in header**: Gear icon "Params" button added to main header bar (next to "Explore Runs")
  - Only visible when a run is loaded that has parameters
  - Opens RunParamsModal for the currently displayed backtest
- **New API endpoint**: `POST /api/backtest/aggregate/run`
  - Runs aggregation backtest with inline config (no saved aggregation ID needed)
  - Accepts full `AggregateBacktestConfig` in body
  - Validates with Zod schema, saves result to DB
- **Client-side function**: `runAdhocAggregation()` in `src/web/api/client.ts`
  - Executes ad-hoc aggregation runs with optional callbacks
- **History Explorer params tooltip**: Hover tooltip showing key:value parameters
  - SubStrategies array displays as "N sub-strategies" instead of raw JSON
  - Provides quick parameter visibility without modal

## Changed
- **RunParamsModal (full rewrite)**:
  - No longer read-only for aggregation runs
  - Full editing of top-level settings: `allocationMode`, `maxPositions`, `initialCapital`, `mode`, `exchange`
  - Sub-strategy list with human-readable cards showing strategy name, symbol, timeframe, params
  - Delete sub-strategies with X button
  - Add new sub-strategies via inline form (strategy name, symbol, timeframe, optional params JSON)
  - Fixed `[object Object]` rendering: SubStrategy params now display as compact `key=value` tokens
  - "Load & Run" button now triggers actual backtest execution:
    - Strategy runs: applies params to config store + auto-triggers backtest
    - Aggregation runs: calls new ad-hoc aggregation API endpoint

- **History Explorer (HistoryExplorer.tsx)**:
  - Replaced params modal trigger with hover tooltip for compact parameter display
  - Enhanced selected run highlight: `bg-primary-900/40` + left accent border (`border-l-2 border-l-primary-400`)
  - Highlight applies to both full and compact row views
  - Cleaned up modal plumbing: removed `onShowParams` prop, `paramsModalRun` state, RunParamsModal render

## Fixed
- SubStrategy params no longer render as `[object Object]` in params modal
- Selected run highlighting was inconsistent; now unified and visually distinct
- Params modal logic was split between modal and explorer; now centralized

## Files Modified
- `src/web/App.tsx` - Added Params button with icon, modal wiring, auto-run flow integration
- `src/web/components/HistoryExplorer/RunParamsModal.tsx` - Complete rewrite with aggregation editing support
- `src/web/components/HistoryExplorer/HistoryExplorer.tsx` - Replaced modal with tooltip, enhanced highlighting, cleanup
- `src/api/routes/backtest.ts` - New `aggregate/run` endpoint for ad-hoc runs
- `src/web/api/client.ts` - New `runAdhocAggregation()` function with optional callbacks

## Context
This work unifies the params editing workflow across strategy and aggregation runs, allowing users to:
1. Quick preview params via History Explorer tooltip (non-intrusive)
2. Full edit + re-run via Params modal (comprehensive)
3. Modify aggregation sub-strategies and re-run without navigating to aggregation saved config

The new ad-hoc aggregation endpoint removes the dependency on saved aggregation IDs, enabling live parameter tweaking and immediate backtest results.
