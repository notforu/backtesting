# Multi-Market Scanner & PM Mean Reversion Strategy

**Date**: 2026-02-16 17:30
**Author**: orchestrator

## Summary
Added multi-market PM scanner and PM mean reversion strategy to the backtesting platform. The scanner enables rapid screening of multiple prediction markets with a new Bollinger Band-based mean reversion strategy, providing both quick performance estimates and detailed backtests.

## Added

### New Strategy: PM Mean Reversion (`strategies/pm-mean-reversion.ts`)
- Bollinger Band mean reversion strategy for prediction market probabilities
- Parameters: bbPeriod, bbStdDev, exitStdDev, positionSizePct, maxPositionUSD, avoidExtremesPct, cooldownBars, minProfitPct, minBBWidth
- Buys when price drops below lower band, shorts when price exceeds upper band
- Exits when price reverts toward the mean
- Risk controls: extreme zone avoidance (outer bands), minimum BB width filter, profit threshold, cooldown between trades

### Scanner Backend Infrastructure
- **`src/api/routes/scan.ts`** - Multi-market SSE streaming endpoint
  - `POST /api/backtest/scan` accepts array of PM symbols
  - Runs backtests sequentially, streams results as Server-Sent Events
  - Events: `progress`, `result` (per market), `done` (with summary stats)
  - No DB persistence - results ephemeral (cleared on new scan)

- **`src/api/routes/polymarket.ts`** - Active markets endpoint
  - `GET /api/polymarket/markets/active` returns top 50 markets by volume
  - Used to prefill scanner market selection

### Scanner Frontend Components & State
- **`src/web/stores/scannerStore.ts`** - Zustand store
  - State: scan results, progress, selected markets
  - Actions: startScan, addResult, toggleMarket, clearResults, etc.

- **`src/web/components/ScannerResults/ScannerResults.tsx`** - Results table
  - Displays scan results sorted by Sharpe ratio
  - Color coding: green (profitable), red (losses)
  - Progress bar during scan, summary footer with aggregate stats
  - Click row to run detailed backtest on that market

### UI Enhancements
- **PolymarketBrowser** - Multi-select mode
  - Checkboxes for market selection, Select All/Clear buttons
  - Backward compatible with single-select mode
  - Used by scanner for bulk market picking

- **StrategyConfig** - Scanner integration
  - Collapsible "Scan Multiple Markets" section (polymarket + non-pairs strategies)
  - "Scan N Markets" button triggers SSE scan with selected markets

- **App.tsx** - Scanner results display
  - ScannerResults component shown between chart and performance charts

## Changed

### Modified: Server & API Client
- **`src/api/server.ts`** - Registered scan routes
- **`src/web/api/client.ts`**
  - Added `runScan()` SSE streaming function
  - Added `getActivePolymarketMarkets()` function

### Modified: Type Definitions (`src/web/types.ts`)
- Added: `ScanRequest`, `ScanResultRow`, `ScanSummary`, `ActivePolymarketMarket` types

## Files Modified

### New Files
- `strategies/pm-mean-reversion.ts`
- `src/api/routes/scan.ts`
- `src/web/stores/scannerStore.ts`
- `src/web/components/ScannerResults/ScannerResults.tsx`

### Modified Files
- `src/api/server.ts` - Route registration
- `src/api/routes/polymarket.ts` - Active markets endpoint
- `src/web/types.ts` - Type definitions
- `src/web/api/client.ts` - API client functions
- `src/web/components/PolymarketBrowser/PolymarketBrowser.tsx` - Multi-select mode
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Scanner UI section
- `src/web/App.tsx` - Results display

## Context

The scanner addresses a key pain point: finding profitable prediction markets is time-consuming. Users previously had to manually test individual markets one by one. This feature enables:

1. **Rapid screening** - Backtest 50+ markets in minutes via SSE streaming
2. **Discovery** - Quickly identify which markets the mean reversion strategy performs best on
3. **Performance ranking** - Results sorted by Sharpe, Sortino, and other metrics
4. **Drill-down workflow** - Click any result for detailed backtest analysis

The PM mean reversion strategy specifically targets the prediction market microstructure where prices often overshoot, creating reversions toward fair value. This complements existing correlation-pairs and cross-platform arb strategies in the PM suite.
