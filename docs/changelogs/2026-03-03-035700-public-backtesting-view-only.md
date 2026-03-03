# Public Backtesting View-Only Access

**Date**: 2026-03-03 03:57
**Author**: frontend-team

## Summary
Made the Backtesting tab accessible to unauthenticated users in read-only/view-only mode. Users can now browse historical backtest results, strategies, and optimization history without authentication while maintaining full security by blocking all mutation operations.

## Changed
- Backend now exposes GET endpoints for backtest, strategies, aggregations, and optimizer data to public users
- Frontend hides all mutation controls for unauthenticated users
- Backtesting tab always visible; users can view but not execute operations

## Added
- No new features, only access control changes

## Fixed
- Allow unauthenticated users to view historical results

## Files Modified

### Backend (1 file)
- `src/auth/hook.ts`
  - Added `/api/backtest`, `/api/strategies`, `/api/aggregations`, `/api/optimize` to `PUBLIC_GET_PREFIXES`
  - Only GET requests are public; POST/DELETE/PATCH remain protected

### Frontend (7 files)
- `src/web/components/App.tsx`
  - Show Backtesting tab for all users (removed auth check)
  - Removed forced redirect to paper-trading for unauthenticated users

- `src/web/components/StrategyConfig.tsx`
  - Hide "Run Backtest" button when not authenticated
  - Hide "Grid Search" button when not authenticated
  - Hide "Scan Markets" button when not authenticated

- `src/web/components/OptimizerModal.tsx`
  - Hide "Setup" tab entirely for unauthenticated users
  - Hide "Delete" buttons in optimization history for unauthenticated users

- `src/web/components/AggregationsPanel.tsx`
  - Hide "Create Aggregation" button when not authenticated
  - Hide "Delete" button when not authenticated
  - Hide "Run Aggregation" button when not authenticated

- `src/web/components/HistoryExplorer.tsx`
  - Hide "Import Configs" button when not authenticated

- `src/web/components/RunParamsModal.tsx`
  - Hide "Load & Run" buttons when not authenticated
  - Rename "Cancel" to "Close" for better UX when operations unavailable

- `src/web/components/ScannerResults.tsx`
  - Disable row click behavior for unauthenticated users (prevents auto-run)
  - Hide "Clear" button when not authenticated

## Security Considerations
- All mutation endpoints (POST, DELETE, PATCH) remain protected behind JWT authentication
- Unauthenticated users cannot trigger expensive operations (backtests, grid searches, aggregation runs)
- Read-only access allows users to browse results without login barrier
- API authentication checks remain in place at route handlers

## Context
This change improves user experience by allowing visitors to explore historical backtest results without creating an account, while maintaining security by preventing them from running new tests or modifying data.
