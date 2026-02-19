# Funding Rate Spike Trading & DEX-CEX Research

**Date**: 2026-02-18 11:30
**Author**: quant-lead

## Summary

Implemented comprehensive funding rate infrastructure for perpetual futures trading on Bybit, enabling contrarian funding rate spike strategies. Added Bybit data provider, funding rate caching and database storage, funding rate spike strategy implementation, and created DEX-CEX spread analysis framework. Also completed 5m pairs trading comparison research (results indicate 1h remains optimal timeframe despite academic literature).

## Changed

### Funding Rate Core Infrastructure
- Extended `BacktestConfigSchema` with optional `mode: 'spot' | 'futures'` parameter
- Extended `PerformanceMetricsSchema` with `totalFundingIncome` and `tradingPnl` fields to separately track funding payments vs entry/exit profit
- Added `FundingRateSchema`/`FundingRate` type for standardized funding rate data structure

### Engine & Portfolio Updates
- `src/core/engine.ts`: Modified to load funding rates from database when `mode='futures'`, apply 8-hour funding payments to open positions based on funding rate sign and position direction
- `src/core/portfolio.ts`: Added `applyFundingPayment(amount)` method to track cumulative funding income
- `src/strategy/base.ts`: Extended `StrategyContext` with optional `fundingRates` array and `currentFundingRate` fields for strategy access to funding data

### Database Schema
- `src/data/db.ts`: Added `funding_rates` table with columns: exchange, symbol, timestamp, fundingRate, indexPrice, markPrice, timestamp columns support full historical tracking
- Implemented CRUD functions: `saveFundingRates()`, `getFundingRates()`, `getFundingRateDateRange()` for efficient funding rate queries

### Data Provider Registration
- `src/data/providers/index.ts`: Registered 'bybit' as supported exchange type

### CLI Enhancements
- `src/cli/quant-backtest.ts`: Added `--mode=futures` flag for futures backtesting mode

## Added

### New Data Providers

**Bybit Provider** (`src/data/providers/bybit.ts`)
- Full `DataProvider` implementation using CCXT with `defaultType: 'swap'` for perpetual futures
- Paginated candle fetching (200 candles/request)
- Default fee configuration: maker 0.02%, taker 0.055%
- `fetchFundingRateHistory()` method for paginated historical funding rate data from Bybit API
- Supports all standard OHLCV timeframes (1m, 5m, 15m, 1h, 4h, 1d, etc.)

**GeckoTerminal Provider** (`src/data/providers/gecko-terminal.ts`)
- Utility class for DEX OHLCV data fetching from GeckoTerminal free API
- Rate-limited implementation (5 requests/minute) to respect API limits
- Pre-configured pools: Uniswap V3 ETH/USDC (Ethereum/Arbitrum), Aerodrome ETH/USDC (Base), Raydium SOL/USDC (Solana)
- Pagination support for complete historical data retrieval

### New Strategies

**Funding Rate Spike Strategy** (`strategies/funding-rate-spike.ts`)
- Contrarian strategy targeting overleveraged crowds through funding rate extremes
- Trading logic: short when crowd overleveraged long (high positive FR), long when overleveraged short (negative FR)
- 9 configurable parameters:
  - `zScoreThreshold`: z-score threshold for FR extremes (default 1.5)
  - `maxAbsoluteFR`: absolute FR threshold as backup (default 0.005)
  - `holdingPeriods`: number of funding periods to hold position (default 2)
  - `stopLossPercent`: stop loss percentage (default 5)
  - `takeProfitPercent`: take profit percentage (default 8)
  - `positionSizePercent`: capital allocation per signal (default 2)
  - `minVolumeSMA`: minimum volume for signal validation (default 5000)
  - `lookbackPeriods`: periods for FR z-score calculation (default 20)
  - `normalizeThreshold`: FR threshold for position close on normalization (default 0.001)
- Exit logic includes: stop loss, take profit, time-based (N funding periods), FR normalization (close when rate returns to normal)

### New Scripts

**Funding Rate Caching Script** (`scripts/cache-funding-rates.ts`)
- CLI tool for pre-fetching and persisting historical funding rate data to database
- Usage: `npx tsx scripts/cache-funding-rates.ts --exchange=bybit --symbols=BTC/USDT:USDT,ETH/USDT:USDT --from=2024-01-01`
- Supports multiple symbols and custom date ranges
- Enables offline backtesting without external API calls

**DEX-CEX Spread Analysis Script** (`scripts/dex-cex-spread-analysis.ts`)
- Compares DEX (GeckoTerminal) vs CEX (Bybit) prices across multiple chains
- Calculates metrics:
  - Mean, median, standard deviation of spread %
  - Percentage of candles above various thresholds (0.1%, 0.3%, 0.5%, 1.0%)
  - Mean reversion time to baseline spread
- Generates structured markdown report to `docs/research/dex-cex-spread-analysis.md`
- Supports multiple asset pairs and GeckoTerminal pools

## Fixed

- None

## Files Modified

- `src/core/types.ts` - Added FundingRate type and mode/funding metrics fields
- `src/core/engine.ts` - Added funding rate loading and payment processing logic
- `src/core/portfolio.ts` - Added applyFundingPayment() method
- `src/strategy/base.ts` - Extended StrategyContext with funding rate fields
- `src/data/db.ts` - Added funding_rates table and CRUD operations
- `src/data/providers/index.ts` - Registered Bybit exchange
- `src/cli/quant-backtest.ts` - Added --mode=futures flag

## Files Added

- `src/data/providers/bybit.ts` - Bybit data provider implementation
- `src/data/providers/gecko-terminal.ts` - GeckoTerminal DEX data provider
- `strategies/funding-rate-spike.ts` - Funding rate contrarian strategy
- `scripts/cache-funding-rates.ts` - Funding rate caching utility
- `scripts/dex-cex-spread-analysis.ts` - DEX-CEX spread analysis tool

## Context

### Motivation

**Funding Rate Trading**: Perpetual futures funding rates represent a structural inefficiency where retail traders overpay to maintain leveraged positions. When funding rates spike (extreme positive/negative), it indicates crowd leverage extremes that often reverse. This strategy targets those reversals for mean-reversion alpha.

**Infrastructure**: Previously the backtesting system only supported spot trading. Adding funding rate support requires:
1. Futures-specific data (funding rates, index/mark prices)
2. Modified engine logic for funding payments every 8 hours
3. Separate performance tracking (funding income vs trading PnL)

**DEX-CEX Spread Research**: Arbitrage opportunities exist between DEX prices and CEX prices, especially on newer chains (Base, Solana) where DEX liquidity is emerging. This research framework enables quantifying those spreads and identifying actionable opportunities.

### Design Decisions

1. **Bybit Selection**: Bybit chosen over Binance for funding rate backtest data - Binance perpetual rates are harder to backtest historically due to API limitations
2. **8-Hour Funding Cycles**: Standard across exchanges; strategy holds for N cycles (2-3) to capture funding payments
3. **Separate Mode Field**: `mode: 'futures'` allows same backtesting engine to support both spot and futures without code branching
4. **GeckoTerminal for DEX**: Free API limits but sufficient for research; production would need paid tier or RPC provider
5. **Contrarian Logic**: High positive FR = crowd overleveraged long = increased liquidation risk for longs, so we short. Opposite for negative FR.

### Research Findings (5m Pairs Trading)

Tested pairs-zscore-scalper at multiple timeframes:
- **5m**: Sharpe -2.0 (worst)
- **15m**: Sharpe +0.12
- **1h**: Sharpe +0.75 (best, +7.08% return)
- **4h**: Sharpe +0.38

**Conclusion**: Academic literature on ultra-high-frequency pairs trading does NOT hold with realistic transaction costs (0.1% per order, 4 orders per round trip = 0.4% slippage per cycle). 1h remains optimal for crypto pairs trading.

### Quality Assurance

- TypeScript compilation: 0 errors
- ESLint: 0 new errors (166 pre-existing warnings, unrelated)
- All new code follows project style guidelines and interfaces
- Funding rate engine logic validated against expected 8-hour funding cycles
- Bybit API pagination tested with multi-symbol requests
