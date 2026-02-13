# Polymarket Prediction Market Integration

**Date**: 2026-02-13 00:00
**Author**: system

## Summary
Complete Polymarket prediction market strategy backtesting integration. Prediction market probabilities (0-1) map directly to price, allowing reuse of the existing OHLCV backtesting engine with new data providers for Polymarket and Manifold Markets. Enables momentum, pairs correlation, and cross-platform arbitrage strategies on prediction markets.

## Added

### Data Providers
- `src/data/providers/polymarket-types.ts` - Gamma/CLOB API response types for market metadata and price history
- `src/data/providers/polymarket.ts` - PolymarketProvider implementing DataProvider interface with CLOB prices-history API integration, probability-to-OHLCV conversion, and rate limiting
- `src/data/polymarket-cache.ts` - Market metadata CRUD operations for polymarket_markets SQLite table with slug/category indexing
- `src/data/providers/manifold.ts` - ManifoldProvider for Manifold Markets API enabling cross-platform prediction market access

### API Routes
- `src/api/routes/polymarket.ts` - Market discovery endpoints:
  - `GET /api/polymarket/markets` - Search/list markets with optional query
  - `GET /api/polymarket/markets/:slug` - Get single market details
  - `GET /api/polymarket/categories` - List available prediction categories

### Prediction Market Strategies
- `strategies/pm-information-edge.ts` - Single-market momentum strategy using Rate of Change (ROC) on probability changes with extremes filter to avoid overbought/oversold conditions
- `strategies/pm-correlation-pairs.ts` - Pairs z-score mean reversion strategy on correlated prediction markets
- `strategies/pm-cross-platform-arb.ts` - Cross-platform arbitrage strategy comparing Polymarket vs Manifold prices using pairs trading engine

### Frontend Components
- `src/web/components/PolymarketBrowser/PolymarketBrowser.tsx` - Market search/browse component with:
  - Debounced search input
  - Category filter dropdown
  - Click-to-select market discovery
- `src/web/components/PolymarketBrowser/index.ts` - Barrel export for component

## Changed

### Core Integration
- `src/data/providers/index.ts` - Added 'polymarket' and 'manifold' to SupportedExchange and providerRegistry
- `src/data/db.ts` - Added polymarket_markets table with slug and category indexes for efficient market lookups
- `src/api/routes/index.ts` - Registered polymarket routes
- `src/api/server.ts` - Integrated polymarket routes into server
- `src/web/api/client.ts` - Added PolymarketMarket interface and API methods:
  - `searchPolymarketMarkets()` - Market search with optional query
  - `getPolymarketCategories()` - Fetch category list

### UI/UX Updates
- `src/web/components/StrategyConfig/StrategyConfig.tsx` - Exchange selection now supports both Binance and Polymarket with conditional PolymarketBrowser rendering, dynamic timeframe options for prediction markets
- `src/web/components/Chart/Chart.tsx` - Y-axis formatting now displays probabilities as percentages (0-100%) for Polymarket symbols
- `src/web/App.tsx` - Passes isPolymarket flag to Chart component for conditional formatting

## Files Modified
- `src/data/providers/index.ts`
- `src/data/db.ts`
- `src/api/routes/index.ts`
- `src/api/server.ts`
- `src/web/api/client.ts`
- `src/web/components/StrategyConfig/StrategyConfig.tsx`
- `src/web/components/Chart/Chart.tsx`
- `src/web/App.tsx`

## Context

Prediction markets represent a new asset class for backtesting. Unlike traditional price-based markets (crypto, stocks), prediction market probabilities range from 0-1, making them directly compatible with OHLCV candle data when probability is treated as price. This allows:

1. **Data Reusability**: Existing backtesting engine handles probability timeseries without modification
2. **Strategy Portability**: Momentum, mean reversion, and pairs strategies transfer directly from crypto to prediction markets
3. **Cross-Platform**: Single interface supports multiple prediction market providers (Polymarket, Manifold)
4. **Multi-Market Analysis**: Correlation analysis between related prediction markets enables statistical arbitrage

The integration uses CLOB (Constant Product Automated Market Maker) order book data converted to probability timeseries, then aggregated into OHLCV candles for backtest compatibility.

## Not Implemented (Deferred)

- **Phase 4: Multi-Market Engine** - Requires new architecture for simultaneous multi-market position management
- **Phase 4: Kelly Portfolio Strategy** - Portfolio-level optimal sizing across many correlated prediction markets

These features require significant architectural changes and are planned for future implementation after validation of single-market and pairs strategies.

## Notes

- Polymarket CLOB API has rate limiting (~2000 requests/hour) - implemented backoff strategy
- Prediction market volatility differs from crypto (lower, clustered near event dates) - may require tuned strategy parameters
- Category data helps filter related markets for correlation analysis
- Manifold API has different response structure - encapsulated in separate provider to avoid cross-platform complexity
