# Embed Funding Rate Histogram in Main Chart

**Date**: 2026-02-20 14:25
**Author**: Claude Code

## Summary
Replaced the separate FundingRateChart component with an embedded histogram inside the main Chart component. This eliminates the laggy two-chart sync approach — one chart instance means one time scale, zero sync needed.

## Changed
- Chart now renders funding rate as a histogram overlay instead of a separate component
- FR histogram uses green/red coloring based on funding rate sign (green = positive, red = negative)
- Histogram occupies bottom ~25% of chart with separate Y-axis scale
- Candle price area adjusts to upper ~72% when FR is visible
- FR toggle button remains in toolbar but now controls visibility in the same chart

## Added
- HistogramSeries in Chart.tsx for funding rate visualization
- Automatic FR display enable in futures mode (no manual configuration needed)

## Fixed
- Eliminated laggy two-chart synchronization that caused scroll/zoom delays
- Removed bidirectional sync callbacks that routed events through React state
- One chart instance = consistent time scale across price and FR data

## Files Modified
- `src/web/components/Chart/Chart.tsx` - Added HistogramSeries for FR, integrated FR data fetching and toggle into main chart
- `src/web/App.tsx` - Removed separate FundingRateChart component, removed chart sync code (refs, useEffect setup, callbacks)

## Context
The previous implementation used two separate TradingView chart instances synced via React state callbacks. Every scroll or zoom event triggered a callback → setState → re-render → useEffect → setVisibleLogicalRange sequence, causing noticeable lag. Embedding the FR histogram as a second series in the same chart instance eliminates this problem entirely since both price and FR data now share one time scale with zero sync overhead.

This change improves UI responsiveness significantly on historical data exploration while maintaining all FR functionality (toggle, color coding, proper scale alignment).
