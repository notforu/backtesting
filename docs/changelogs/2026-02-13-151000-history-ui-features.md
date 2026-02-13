# History UI Features & Persistent Database

**Date**: 2026-02-13 15:10
**Author**: development-team

## Summary

Added comprehensive history management features including bulk delete capability, persistent database storage, and the ability to apply historical backtest parameters directly to the configuration form. These changes improve workflow efficiency and data persistence across server restarts.

## Changed

- Moved default database location from `/tmp/backtesting.db` to `./data/backtesting.db` for persistent storage
- Database path is now configurable via `DB_PATH` environment variable
- Candle data and backtest history now persist between server restarts
- History item selection now auto-populates the backtest configuration form
- Added confirmation dialog for destructive delete operations

## Added

- **Backend delete endpoint**: `DELETE /api/backtest/history` clears all backtest runs at once
  - Returns count of deleted runs
  - Route placed before `/:id` to avoid route matching conflicts

- **Frontend History Management**:
  - "Clear All" button in history panel header with confirmation dialog
  - `applyHistoryParams()` action in config store to populate form from history
  - Support for both standard and pairs trading strategies (symbolA/symbolB, leverage)
  - Automatic timestamp-to-date conversion for form inputs

- **API and Hook Support**:
  - `deleteAllHistory()` function in API client
  - `useDeleteAllHistory()` React hook for mutation handling
  - Query invalidation and result clearing on successful deletion

## Fixed

- History items can now be reused immediately without manual re-entry
- Pairs strategy parameters (leverage, hedge ratio) are properly restored from history

## Files Modified

- `src/data/db.ts` - Added `deleteAllBacktestRuns()` function, updated DB path constant, added path import
- `src/data/index.ts` - Export `deleteAllBacktestRuns` for use in API routes
- `src/api/routes/backtest.ts` - Added `DELETE /api/backtest/history` endpoint (placed before `/:id` route)
- `src/web/stores/backtestStore.ts` - Added `applyHistoryParams()` action with strategy type handling
- `src/web/api/client.ts` - Added `deleteAllHistory()` function for API call
- `src/web/hooks/useBacktest.ts` - Added `useDeleteAllHistory()` mutation hook
- `src/web/components/History/History.tsx` - Added Clear All button and history selection handler

## Context

These changes address the need for better workflow efficiency when running multiple backtests. Users can now:

1. **Reuse configurations** - Click any past backtest to instantly reload its parameters
2. **Batch clean-up** - Clear all history when accumulating too many test runs
3. **Persistent data** - Database survives server restarts, improving reliability and data integrity

The route ordering fix (DELETE before GET/:id) prevents the delete endpoint from being intercepted by the dynamic route matcher, ensuring proper HTTP verb handling.
