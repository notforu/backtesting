# Unified Equity Display and Scroll Fix

**Date**: 2026-03-12 16:30
**Author**: fe-dev (claude-sonnet)

## Summary
Fixed critical UI consistency issues in paper trading dashboard. Unified real-time equity display across sidebar and detail view using a centralized Zustand store, added live equity points to charts, fixed funding payment history visibility, and corrected layout scrolling for the configurations page.

## Added
- `src/web/stores/realtimeEquityStore.ts` — Zustand store for centralized real-time equity management. Single source of truth for live equity data across all components.
- `useSessionEquity()` hook — Provides reactive access to live equity data with automatic updates via SSE subscription.

## Changed
- `src/web/hooks/usePaperTrading.ts` — Added `funding_payment` case to SSE event handler to invalidate events cache, ensuring funding payments appear in event history.
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx` — Updated to use `useSessionEquity()` hook for consistent equity display across all sessions.
- `src/web/components/PaperTradingPage/PaperSessionDetail.tsx` — Updated to use `useSessionEquity()` hook for real-time equity updates in detail view.
- `src/web/components/PaperTradingPage/PaperChartSection.tsx` — Pass real-time equity point to equity chart component.
- `src/web/components/PaperTradingPanel/PaperEquityChart.tsx` — Accept optional `realtimePoint` prop and append latest live equity as final chart point when newer than last DB snapshot.
- `src/web/App.tsx` — Changed layout from `min-h-screen` to `h-screen overflow-hidden`, enabling independent scrollable panels with fixed header visibility.

## Fixed
- **Equity display consistency** — Both sidebar session list and detail view now always show the same real-time return value.
- **Funding payment visibility** — Funding payments now appear in the event history tab via SSE event cache invalidation.
- **Layout scrolling** — Configurations page and paper trading panels now have proper scrolling behavior with sidebar and detail panes scrolling independently.

## Files Modified
- `src/web/stores/realtimeEquityStore.ts` (new)
- `src/web/hooks/usePaperTrading.ts`
- `src/web/components/PaperTradingPanel/PaperTradingPanel.tsx`
- `src/web/components/PaperTradingPage/PaperSessionDetail.tsx`
- `src/web/components/PaperTradingPage/PaperChartSection.tsx`
- `src/web/components/PaperTradingPanel/PaperEquityChart.tsx`
- `src/web/App.tsx`

## Context
The paper trading dashboard had several related UI issues:

1. The sidebar session list and detail view were showing different equity values because they were fetching separately, causing confusion about actual portfolio return.
2. Funding payments from the server weren't being reflected in the event history because the SSE handler wasn't invalidating the cache.
3. Layout scrolling was broken — the entire page scrolled together instead of having independent scrollable panels, making configurations and session details hard to navigate.

This batch of fixes unifies the equity display logic through a centralized store, ensures all event types are properly handled in the UI, and corrects the layout structure for better UX. The real-time chart enhancement now gives users instant visual feedback of their current equity position.
