# Dashboard UI Fixes and Aggregation Filtering

**Date**: 2026-02-24 15:00
**Author**: docs-writer

## Summary
Fixed critical bugs in history filtering and aggregation UI. History sidebar now properly filters out aggregation runs, run type toggles (Strategies/Aggregations/All) now work correctly with Group by Asset mode, and portfolio chart now has resolution controls. Also added a safety rule to CLAUDE.md requiring all backtest results be persisted to the database.

## Fixed
- History sidebar was showing mixed strategy and aggregation runs
- Run type toggler was not applied when "Group by Asset" was enabled
- Run type filter required manual Apply click instead of applying instantly
- Division by zero error in weighted multi-asset allocation when signal weights sum to 0
- Portfolio equity chart was fixed-resolution, now has resolution picker

## Added
- Portfolio chart resolution picker (1h, 4h, 1d, 1w) with smart downsampling for cleaner visualization
- Aggregation list now scrollable with max height to reduce visual clutter
- Group by Asset toggle now defaults to ON in History Explorer
- RULE 8 to CLAUDE.md: All backtest results must be saved to database via `saveBacktestRun()` for audit trail and reproducibility

## Changed
- History sidebar now filters by `runType: 'strategies'` only, excluding aggregation runs
- Run type filter now applied immediately without needing Apply button
- `getHistoryGroups()` now accepts and forwards `runType` parameter through full stack:
  - Frontend: `groupFilterParams` includes `runType`
  - API client: passes `runType` to backend
  - Backend: reads `runType` from query params
  - Database: `getBacktestGroups()` filters by `aggregation_id IS NULL/NOT NULL`

## Files Modified
- `src/web/hooks/useBacktest.ts` - Updated filter params structure for Group by Asset mode
- `src/web/components/Chart/PortfolioChart.tsx` - Added resolution picker UI and downsampling logic
- `src/web/components/AggregationsPanel/AggregationsPanel.tsx` - Made aggregation list scrollable
- `src/web/components/HistoryExplorer/HistoryExplorer.tsx` - Fixed run type filtering, default Group by Asset to ON
- `src/web/api/client.ts` - Updated `getHistoryGroups()` signature to accept `runType`
- `src/api/routes/backtest.ts` - Added `runType` query param handling to `/api/backtest/history/groups`
- `src/data/db.ts` - Updated `getBacktestGroups()` to filter by `aggregation_id` field
- `src/core/aggregate-engine.ts` - Fixed NaN in `weighted_multi` allocation with zero-sum signal weights fallback to equal-split
- `CLAUDE.md` - Added RULE 8 (persist all backtest results to database)

## Context
Dashboard had multiple UX issues that created confusion between strategy and aggregation runs. Users couldn't properly filter history, the Group by Asset mode ignored filter selections, and there was no way to control portfolio chart resolution. The weighted multi-asset allocation bug caused crashes when strategies produced no signals. These fixes improve dashboard stability and usability for strategy research workflows. The new RULE 8 ensures all backtest results are persisted for audit trail and prevents loss of optimization results.
