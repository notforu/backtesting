# Fix Inline History Refresh + Cleanup

**Date**: 2026-02-22 18:45
**Author**: dev team

## Summary

Fixed aggregation runs and backtest results not appearing in inline history widgets after execution, removed the legacy History sidebar widget that was replaced by inline history displays, and widened the configuration sidebar for better usability.

## Changed

- Inline history widgets now properly refresh after backtest runs, aggregation runs, or history deletions
- Removed redundant legacy History widget from sidebar (replaced by per-tab inline history)
- Configuration sidebar width increased from 320px to 384px for better form input spacing

## Added

- Query invalidation for `explorer-history` key in all mutation hooks to trigger inline history refresh

## Fixed

- Bug: Inline `HistoryExplorerContent` components not updating after runs due to mismatched query keys
  - Root cause: Mutation hooks invalidated `['history']` key but inline components used `['explorer-history', ...]` key
  - Solution: Added `queryClient.invalidateQueries({ queryKey: ['explorer-history'] })` to all 5 mutation onSuccess handlers

## Files Modified

- `src/web/hooks/useBacktest.ts` - Added explorer-history query invalidation to `useRunBacktest`, `useRunPairsBacktest`, `useDeleteBacktest`, `useDeleteAllHistory`, and `useRunAggregation` hooks
- `src/web/App.tsx` - Removed `<History />` component and import statement, widened sidebar from `w-80` to `w-96`

## Context

The inline history widgets in the Strategies and Aggregations tabs use different React Query keys than the mutation hooks, causing them to not refresh when new runs completed. By invalidating the correct query key in all mutation onSuccess handlers, inline history now stays in sync with actual data. The legacy History widget was redundant and removed to reduce UI clutter.
