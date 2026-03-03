# URL Routing & Paper Trading Default Page

**Date**: 2026-03-03 04:22
**Author**: fullstack-dev

## Summary
Implemented bidirectional URL routing using the History API to sync browser URLs with application state. Made paper trading the default landing page, replacing backtesting. Users can now share direct links to specific sessions and backtest runs.

## Changed
- Default landing page changed from backtesting to paper trading
- Added URL-to-state synchronization on page load
- Added state-to-URL synchronization on navigation
- Browser back/forward now properly restores application state

## Added
- `src/web/hooks/useUrlSync.ts` — New hook implementing bidirectional URL ↔ Zustand state sync using History API
- URL structure for all pages:
  - `/` → Paper trading (default)
  - `/paper-trading` → Paper trading view
  - `/paper-trading/:sessionId` → Specific paper trading session
  - `/backtesting` → Backtesting view
  - `/backtesting/:runId` → Specific backtest run (auto-loaded from DB)
- Auto-select first session when paper trading page loads without a selected session

## Fixed
- Simplified routing without external dependencies (no react-router-dom needed)
- Clean root URL `/` for default page
- Prevented infinite loops in URL sync logic using refs

## Files Modified
- `src/web/hooks/useUrlSync.ts` — Created
- `src/web/stores/paperTradingStore.ts` — Changed default `activePage` from `'backtesting'` to `'paper-trading'`
- `src/web/App.tsx` — Integrated `useUrlSync()` hook and added auto-load effect for backtest runs
- `src/web/components/PaperTradingPage/PaperTradingPage.tsx` — Added auto-select first session on load

## Context
This change improves the user experience by:
1. Making paper trading (live/simulated trading) the primary feature
2. Enabling shareable links to specific trading sessions and backtest runs
3. Preserving browser history with proper back/forward support
4. Reducing dependencies by leveraging native History API instead of adding a router library

The implementation uses no new npm packages and integrates with existing SPA fallback configuration in both nginx and Fastify.
