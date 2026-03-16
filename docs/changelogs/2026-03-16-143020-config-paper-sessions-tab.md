# Implement Paper Trading Sessions Tab on Configuration Page

**Date**: 2026-03-16 14:30
**Author**: docs-writer

## Summary
Replaced the placeholder "Paper trading sessions" tab on the strategy configuration detail page with a fully functional implementation that displays active paper trading sessions linked to the configuration. Sessions show real-time status, equity, returns, and provide quick navigation to the paper trading page.

## Changed
- `src/web/api/client.ts` — Added `ConfigPaperSessionSummary` type and `getConfigPaperSessions()` API client function
- `src/web/hooks/useConfigurations.ts` — Added `useConfigPaperSessions()` React Query hook with 15-second refetch interval
- `src/web/components/ConfigurationsPage/ConfigPaperTab.tsx` — Replaced placeholder with full session display component

## Added
- **Session cards** displaying:
  - Session name
  - Status badge (running/paused/stopped/error) with color coding
  - Current equity and return percentage
  - Creation date
- **Auto-refresh** mechanism (15 second interval) for live session data
- **View Session button** that navigates to paper trading page with session pre-selected
- **Loading state** with spinner
- **Empty state** when no sessions exist

## Fixed
- Placeholder UI now shows actual session data instead of static text

## Files Modified
- `src/web/api/client.ts`
- `src/web/hooks/useConfigurations.ts`
- `src/web/components/ConfigurationsPage/ConfigPaperTab.tsx`

## Context
This completes the configuration page UI by connecting the frontend to the existing backend endpoint (`GET /api/strategy-configs/:id/paper-sessions`). Users can now monitor paper trading sessions directly from the strategy configuration view and quickly navigate to detailed session metrics without switching pages.
