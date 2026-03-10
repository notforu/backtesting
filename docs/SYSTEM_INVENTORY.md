# Backtesting System Inventory

**Date**: 2026-03-10
**Status**: Comprehensive system documentation after major cleanup (removed Polymarket, Pairs Trading, and v1 funding-rate-spike strategy)

---

## Table of Contents

1. [Overview](#overview)
2. [Backend Modules](#backend-modules)
3. [API Routes](#api-routes)
4. [Data Layer](#data-layer)
5. [Strategies](#strategies)
6. [Frontend](#frontend)
7. [Paper Trading](#paper-trading)
8. [CLI Tools](#cli-tools)
9. [Analysis & Metrics](#analysis--metrics)
10. [Infrastructure](#infrastructure)
11. [Authentication](#authentication)

---

## Overview

A modular TypeScript-based crypto backtesting platform supporting multiple exchanges (Binance, Bybit) with plugin-based strategies, real-time paper trading simulation, and multi-asset aggregation testing. The system enables researchers to develop, optimize, validate, and paper-trade quantitative strategies with comprehensive performance analytics.

**Key Capabilities:**
- Single-asset backtesting with technical indicators
- Multi-asset portfolio backtesting with signal aggregation
- Parameter optimization via grid search
- Walk-forward testing for robustness validation
- Real-time paper trading simulation (separate from backtesting)
- Support for spot and futures trading modes
- Comprehensive performance metrics and rolling analytics
- Web-based dashboard with charts and optimization history
- REST API for programmatic access

---

## Backend Modules

### Core Engine (`src/core/`)

#### **engine.ts** - Single-Asset Backtesting
Main orchestrator for backtesting a single strategy on one symbol:
- Loads strategy dynamically and validates parameters
- Fetches historical candles and funding rates from database
- Executes bar-by-bar backtest loop with strategy signals
- Manages trades, fees, slippage, and funding rate payments
- Calculates equity curve and performance metrics
- Supports both spot and futures trading modes
- Features:
  - Memory-efficient candle view (no array copying)
  - Configurable broker slippage and fees
  - Early stopping on equity drawdown for faster optimization
  - Progress callbacks for long-running backtests
  - Optional preloaded data (candles, funding rates, strategy) for optimizer reuse
  - Automatic fee fetching from exchanges (can be disabled for speed)

**Key Functions:**
- `runBacktest(config, engineConfig?)`: Executes the backtest
- `createBacktestConfig()`: Helper to construct config objects

#### **aggregate-engine.ts** - Multi-Asset Portfolio Backtesting
Runs multiple sub-strategies with shared capital and signal-based allocation:
- Loads N strategies, one per symbol/timeframe combination
- Creates `SignalAdapter` for each to convert strategy intent to signals
- Executes simultaneous multi-symbol bars via synchronized timestamps
- Allocates capital across signals using selectable strategies:
  - `single_strongest`: Trade only the strongest signal
  - `weighted_multi`: Allocate based on signal weight and capital
  - `top_n`: Trade top N signals within maxPositions limit
- Tracks per-asset trades, equity, and metrics separately
- Returns aggregate equity curve plus per-asset breakdown

**Key Functions:**
- `runAggregateBacktest(config, engineConfig?)`: Executes multi-asset backtest

#### **optimizer.ts** - Parameter Grid Search
Automated parameter optimization to find best hyperparameters:
- Generates all parameter combinations from config ranges
- Runs backtest for each combination
- Selects best result based on metric (Sharpe, return, profit factor, win rate, or composite)
- Caches candles/funding rates to avoid repeated I/O
- Preloads strategy once to avoid repeated dynamic imports
- Saves optimization history to database for later review
- Supports multi-symbol/timeframe batch optimization
- Progress callback system for UI updates

**Metrics Optimized:**
- `sharpeRatio`: Risk-adjusted returns
- `totalReturnPercent`: Total profit percentage
- `profitFactor`: Gross profit / gross loss
- `winRate`: Percentage of winning trades
- `composite`: Weighted combination of multiple metrics

**Key Functions:**
- `runOptimization(config, onProgress?)`: Single-symbol optimization
- `runMultiOptimization(baseConfig, symbols, timeframes, onProgress?)`: Multiple symbols/timeframes

#### **walk-forward.ts** - Robustness Testing
Validates strategy parameters against overfitting:
- Splits data into train (70%) and test (30%) periods
- Optimizes parameters on training period
- Validates on out-of-sample test period
- Measures degradation: (train metric - test metric) / train metric
- Assesses robustness based on degradation threshold (default: 30%)
- Returns detailed pass/fail verdict for parameter sets

**Key Functions:**
- `runWalkForward(config, onProgress?)`: Executes walk-forward test

#### **types.ts** - Core Type Definitions
Comprehensive Zod-validated type definitions:
- `Candle`: OHLCV data (timestamp, open, high, low, close, volume)
- `Trade`: Recorded trade execution with PnL, fees, slippage
- `Order`: Pending orders (pending, filled, cancelled)
- `TradeAction`: OPEN_LONG, CLOSE_LONG, OPEN_SHORT, CLOSE_SHORT
- `BacktestConfig`: Configuration for single-asset backtest
- `BacktestResult`: Complete backtest output with trades, equity, metrics
- `PerformanceMetrics`: Sharpe, Sortino, max drawdown, profit factor, etc.
- `EquityPoint`: Timestamped equity snapshots
- `RollingMetrics`: Time-series metrics (daily returns, drawdown history)
- `FundingRate`: Funding rate record (timestamp, symbol, rate, exchange)
- `Position`: Open position tracking (side, amount, entry price)
- `Timeframe`: Union type for valid timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w)

#### **portfolio.ts** - Position & Balance Management
Tracks long/short positions and cash balance:
- Maintains current long and short positions
- Tracks unrealized PnL on open positions
- Manages cash balance and fees deducted
- Generates trade records (open/close)
- Supports both long-only and bidirectional (long/short) strategies
- Prevents simultaneous long/short on same symbol
- Supports prediction markets (price between 0-1)

#### **leveraged-portfolio.ts** - Leverage Support
Extension of Portfolio for futures trading with leverage:
- Applies leverage multiplier to position sizes
- Tracks leverage ratio in configuration
- Supports both isolated and cross-margin setups
- Manages collateral and margin requirements

#### **multi-portfolio.ts** - Multi-Symbol Portfolio
Portfolio managing positions across multiple symbols:
- Tracks positions per symbol separately
- Allocates capital across symbols
- Calculates aggregate equity and cash
- Returns per-symbol position snapshots

#### **broker.ts** - Order Execution Simulation
Simulates order filling and execution costs:
- Fills market orders at candle price + slippage
- Fills limit orders when price touched (or marked as unfillable)
- Deducts trading fees from order value
- Tracks fee and slippage per trade
- Supports spot and futures commission models

#### **signal-adapter.ts** - Strategy to Signal Converter
Wraps strategies to emit standardized signals:
- Captures strategy trading intent (open/close/exit actions)
- Interprets as directional signals (long/short/flat)
- Manages "shadow" position state (strategy's perceived portfolio)
- Supplies weight calculators for capital allocation
- Bridges strategy implementation to aggregate engine

#### **signal-types.ts** - Signal & Aggregation Types
Defines signal aggregation framework:
- `Signal`: Direction (long/short/flat) + weight (0-1)
- `SignalProvider`: Interface for anything emitting signals
- `AggregateBacktestConfig`: Configuration for multi-strategy runs
- `AllocationMode`: How to distribute capital (single_strongest, weighted_multi, top_n)
- `WeightCalculator`: Interface for custom weight calculation logic
- `PerAssetResult`: Per-symbol metrics breakdown

#### **weight-calculators.ts** - Signal Weight Computation
Calculates signal strength for capital allocation:
- Implementations for various weight strategies (simple, momentum, funding-based)
- Context includes current price, funding rate, bar index
- Allows strategies to emit variable-strength signals

#### **config-export.ts & config-export-types.ts** - Configuration Persistence
Save and load backtest/aggregation configurations:
- Exports full configuration as JSON
- Preserves all parameters, dates, and settings
- Enables reproducible backtests
- Used for sharing strategy setups

#### **scoring.ts** - Result Scoring
Post-backtest analysis and ranking:
- Computes composite scores from multiple metrics
- Ranks results by selected metric
- Identifies optimal parameter sets

#### **multi-asset-validation.ts** - Portfolio Validation
Validates multi-asset configurations before running:
- Checks symbol availability across exchanges
- Validates symbol format
- Ensures required data exists
- Reports any issues upfront

---

### Analysis Module (`src/analysis/`)

#### **metrics.ts** - Performance Metrics Calculation
Comprehensive performance analytics from trades and equity curve:

**Calculated Metrics:**
- **Total Return**: Final equity - initial capital (absolute $)
- **Total Return %**: Return as percentage of capital
- **Max Drawdown**: Largest peak-to-trough decline in equity ($)
- **Max Drawdown %**: Drawdown as percentage
- **Sharpe Ratio**: (Mean return - risk-free rate) / StdDev(returns), annualized
- **Sortino Ratio**: Like Sharpe but only penalizes downside volatility
- **Win Rate**: Percentage of winning trades
- **Profit Factor**: Gross profit / gross loss
- **Total Trades**: Count of closed trades
- **Winning/Losing Trades**: Counts of each
- **Average Win/Loss**: Mean PnL per winning/losing trade
- **Average Win/Loss %**: Mean return % per winning/losing trade
- **Expectancy**: Expected value per trade (total PnL / trade count)
- **Expectancy %**: Expected return % per trade
- **Largest Win/Loss**: Best and worst single trade
- **Average Trade Duration**: Mean time in position
- **Exposure Time**: Percentage of time in the market
- **Total Fees**: Sum of all trading fees
- **Total Slippage**: Sum of all slippage costs

**Key Functions:**
- `calculateMetrics(trades, equity, initialCapital, timeframe?)`: Main calculation
- `generateEquityCurve(initialCapital, trades)`: Creates timestamp/equity array
- `calculateRollingMetrics(equity)`: Per-day drawdown, return tracking

#### **index.ts** - Analysis Module Exports

---

### Data Layer (`src/data/`)

#### **db.ts** - PostgreSQL Database & Migrations
Connection pooling and data persistence:
- Uses node-postgres (pg) for async/non-blocking access
- Connection pooling (max 10 connections)
- Automatic migration system (reads from `migrations/` directory)
- Handles database initialization on startup

**Database Tables:**
- `candles`: OHLCV data indexed by (exchange, symbol, timeframe, timestamp)
- `backtest_runs`: Backtest results with trades, equity, metrics
- `optimization_runs`: Optimization history with best parameters
- `funding_rates`: Funding rate data for futures
- `open_interest`: Open interest data per symbol
- `long_short_ratio`: Long/short ratio data per symbol
- `paper_sessions`: Paper trading session records
- `paper_trades`: Trades executed in paper sessions
- `paper_positions`: Current positions in paper sessions
- `paper_equity_snapshots`: Equity history in paper sessions
- `users`: User accounts with password hashes
- `_migrations`: Applied migration tracking

**Key Functions:**
- `initDb()`: Run migrations on startup
- `getCandles(exchange, symbol, timeframe, startDate, endDate)`: Fetch historical data
- `saveCandles(exchange, symbol, timeframe, candles)`: Store candle data
- `saveBacktestRun(result, aggregationId?)`: Persist backtest results
- `getBacktestRun(id)`: Retrieve single result
- `getBacktestSummaries(filters)`: List results with pagination/filtering
- `saveOptimizedParams(params)`: Store optimization results
- `getFundingRates(exchange, symbol, startDate, endDate)`: Get futures funding data
- `saveOpenInterestHistory(records)`: Store OI data
- `saveLongShortRatioHistory(records)`: Store LSR data

#### **index.ts** - Data Layer Exports

#### **providers/base.ts** - Exchange Provider Interface
Abstract base for exchange data providers:
- Defines methods: `fetchCandles()`, `fetchTicker()`, `fetchFundingRates()`
- Standard error handling and retry logic

#### **providers/binance.ts** - Binance Implementation
CCXT-based provider for Binance spot trading:
- Fetches candles via CCXT
- Fetches funding rates via Binance REST API
- Handles pagination and date range filtering
- Caches API responses to avoid redundant calls

#### **providers/bybit.ts** - Bybit Implementation
CCXT-based provider for Bybit perpetuals:
- Fetches candles via CCXT
- Fetches funding rates via direct Bybit REST API (bypasses CCXT's `since` limitation)
- Fetches open interest history (CCXT's direct API)
- Fetches long/short ratio data

#### **providers/index.ts** - Provider Factory
`getProvider(exchangeName)`: Returns appropriate provider instance

---

## API Routes

Fastify routes serving REST endpoints. All routes require JWT authentication (enforced by auth hook).

### Backtest Routes (`src/api/routes/backtest.ts`)

**POST /api/backtest/run**
- Execute a new single-asset or aggregate backtest
- Body:
  - `strategyName`: Strategy to run
  - `params`: Parameter overrides
  - `symbol`: Trading pair (e.g., "BTC/USDT")
  - `timeframe`: Candle interval (1m, 5m, etc.)
  - `startDate`: ISO string or timestamp
  - `endDate`: ISO string or timestamp
  - `initialCapital`: Starting balance
  - `exchange`: Exchange name
  - `mode`: "spot" or "futures" (optional)
  - OR `subStrategies` + `allocationMode` for aggregate mode
- Returns: Full `BacktestResult` with trades, equity, metrics

**GET /api/backtest/:id**
- Retrieve a stored backtest result by ID

**GET /api/backtest/history**
- List all backtest runs with optional filtering
- Query params: `limit`, `offset`, `strategy`, `symbol`, `timeframe`, `exchange`, `mode`, `runType`, `fromDate`, `toDate`, `minSharpe`, `maxSharpe`, `minReturn`, `maxReturn`, `sortBy`, `sortDir`
- Returns: Paginated list of summaries

**GET /api/backtest/groups**
- Group results by strategy/symbol/timeframe
- Returns: Summary counts per group

**DELETE /api/backtest/:id**
- Remove a specific backtest result

**DELETE /api/backtest/all**
- Clear all backtest history

### Optimization Routes (`src/api/routes/optimize.ts`)

**POST /api/optimize**
- Start parameter grid search optimization
- Server-Sent Events (SSE) for progress updates
- Body:
  - `strategyName`: Strategy to optimize
  - `symbol`: Trading pair
  - `timeframe`: Candle interval
  - `startDate` / `endDate`: Date range
  - `initialCapital`: Capital for backtests
  - `optimizeFor`: Metric to maximize (sharpeRatio, totalReturnPercent, profitFactor, winRate, composite)
  - `maxCombinations`: Grid search limit
  - `batchSize`: Parallel execution batch
  - `minTrades`: Minimum required trades
  - `leverage`: Futures leverage
  - `mode`: spot or futures
  - `symbols` / `timeframes`: For multi-symbol batch optimization
- Returns: SSE stream with progress + final `OptimizationResult`

**GET /api/optimize/:strategyName/:symbol/:timeframe**
- Get all optimization runs for this combination

**GET /api/optimize/:strategyName/:symbol/:timeframe/latest**
- Get newest optimization result

**GET /api/optimize/all**
- List all optimization results

**DELETE /api/optimize/:strategyName/:symbol/:timeframe**
- Delete all runs for this combination

**DELETE /api/optimize/id/:id**
- Delete specific optimization run

### Strategy Routes (`src/api/routes/strategies.ts`)

**GET /api/strategies**
- List all available strategies with metadata

**GET /api/strategies/:name**
- Get details for a specific strategy:
  - Name, description
  - Parameter schema (UI generation)
  - Default values
  - Example configuration

### Candle Routes (`src/api/routes/candles.ts`)

**GET /api/candles**
- Fetch historical candles for a symbol
- Query: `exchange`, `symbol`, `timeframe`, `startDate`, `endDate`, `limit`
- Returns: Array of `Candle` objects

**GET /api/exchanges**
- List supported exchanges (binance, bybit)

**GET /api/symbols**
- List available trading pairs per exchange

### Funding Rate Routes (`src/api/routes/funding-rates.ts`)

**GET /api/funding-rates**
- Fetch funding rate history for futures trading
- Query: `exchange`, `symbol`, `startDate`, `endDate`
- Returns: Array of `FundingRate` objects

### Aggregation Routes (`src/api/routes/aggregations.ts`)

**GET /api/aggregations**
- List saved multi-strategy aggregation configurations

**GET /api/aggregations/:id**
- Get specific aggregation config

**POST /api/aggregations**
- Save new aggregation configuration
- Body: `AggregationConfig` with sub-strategies and allocation mode

**PUT /api/aggregations/:id**
- Update aggregation configuration

**DELETE /api/aggregations/:id**
- Remove aggregation configuration

**POST /api/aggregations/:id/run**
- Execute saved aggregation and save result

### Paper Trading Routes (`src/api/routes/paper-trading.ts`)

**GET /api/paper-trading/sessions**
- List all paper trading sessions

**GET /api/paper-trading/sessions/:sessionId**
- Get session details: positions, equity, status, error state

**POST /api/paper-trading/sessions**
- Create new paper trading session
- Body: `CreatePaperSessionRequest` (aggregation config, initial capital, session name)
- Returns: New session ID and initial state

**POST /api/paper-trading/sessions/:sessionId/start**
- Start/resume paper trading simulation

**POST /api/paper-trading/sessions/:sessionId/pause**
- Pause active session (preserves state)

**POST /api/paper-trading/sessions/:sessionId/stop**
- Stop session (cleanup)

**DELETE /api/paper-trading/sessions/:sessionId**
- Delete session record

**GET /api/paper-trading/sessions/:sessionId/trades**
- Get all trades executed in session with pagination

**GET /api/paper-trading/sessions/:sessionId/equity**
- Get equity history snapshots

**GET /api/paper-trading/sessions/:sessionId/events**
- Get event stream (trades, equity updates, errors, status changes)

### Config Export Routes (`src/api/routes/config-export.ts`)

**POST /api/config/export**
- Export a backtest or aggregation configuration as JSON

**POST /api/config/import**
- Import configuration from JSON (creates new session)

### Price Stream Routes (`src/api/routes/price-stream.ts`)

**WebSocket /api/price-stream**
- Real-time price feed via WebSocket
- Subscribe to live ticks for selected symbols
- Used by price widgets and paper trading

### Scanner Routes (`src/api/routes/scan.ts`)

**POST /api/scan**
- Scan multiple symbols for strategy signals
- Returns: List of matching symbols with signal strength and metrics

### Auth Routes (`src/api/routes/auth.ts`)

**POST /api/auth/login**
- Authenticate user with password
- Returns: JWT token

**POST /api/auth/refresh**
- Refresh expired JWT token

---

## Data Layer

### Supported Exchanges

**Binance** (Spot)
- Candles: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w via CCXT
- Funding Rates: N/A (spot only)
- OpenInterest: N/A (spot only)

**Bybit** (Perpetuals)
- Candles: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w via CCXT
- Funding Rates: Via direct REST API (Bybit's `fetchOpenInterestHistoryDirect`)
- OpenInterest: Via direct REST API
- LongShortRatio: Available per symbol

### Database Structure

All data stored in PostgreSQL (production) with migrations in `migrations/` directory.

---

## Strategies

14 production strategies in `/strategies/` directory:

### Momentum & Trend Following

**ema-macd-trend-momentum.ts**
- EMA crossover + MACD momentum confirmation
- Signals: Long on fast EMA > slow EMA + MACD positive
- Best for: Trending markets, 4h-1d timeframes

**sma-crossover.ts**
- Simple Moving Average crossover
- Signals: Long on fast SMA > slow SMA
- Best for: Educational baseline, all timeframes

**cci-momentum-breakout.ts**
- Commodity Channel Index momentum + breakout filter
- Signals: Breakout when CCI > threshold
- Best for: Volatile markets, quick reversals

**volatility-squeeze-breakout.ts**
- Bollinger Band squeeze detection + breakout
- Signals: Enter on volatility expansion
- Best for: Consolidation-then-breakout patterns

**volatility-breakout-scalper.ts**
- ATR-based breakout in high volatility environments
- Signals: Scalp breakouts on ATR expansion
- Best for: 1m-5m scalping, high volume

### Funding Rate-Based (Futures)

**funding-rate-spike-v2.ts** (Production Version)
- Captures temporary funding rate spikes
- Scalps funding income on extreme rates
- Long entry: When funding rate spikes above historical average
- Exit: After collecting target funding or time-based exit
- Best for: Calm markets with periodic funding spikes
- Parameters: Funding threshold, hold duration, profit target
- Status: Tested and validated via walk-forward

**fr-gradient-momentum.ts**
- Funding rate momentum + price momentum integration
- Signals based on funding rate rate-of-change
- Combines with technical momentum for confirmation
- Best for: Sustained funding trends

**fr-epoch-scalper.ts**
- Executes trades around funding rate settlement epochs (8h)
- Captures funding payments with minimal hold time
- Entry: Just before settlement, exit just after
- Best for: Futures with predictable funding cycles

**fr-regime-momentum.ts**
- Identifies funding rate regimes (high, normal, low)
- Trades momentum within current regime
- Long when regime positive + price momentum aligns
- Best for: Stable markets with regime shifts

**fr-settlement-scalper.ts**
- Scalps funding payments around settlement times
- Multiple micro-positions to capture high frequency
- Best for: 1m-5m high-frequency strategies

### Market Structure & Price Action

**market-leader-divergence.ts**
- Identifies divergences between market leader (BTC) and altcoins
- Long alts when decoupling from BTC
- Best for: Alt trading in bull markets

**oi-delta-regime-scalper.ts**
- Open interest delta (change in OI) as momentum signal
- Positive OI delta = bullish regime, scalp long
- Best for: Futures, mid-frequency (4h-1d)

**bb-rsi-scalper.ts**
- Bollinger Bands + RSI combination
- Long when price near lower band AND RSI oversold
- Best for: Range-bound markets, 1h-4h

**gpt-long-ultimate.ts**
- (Legacy) Ultimate long-biased strategy
- Multiple confirmation signals
- Best for: Bull market conditions

### Strategy Loader

**src/strategy/loader.ts**
- Dynamically imports strategy files from `/strategies/` directory
- Validates against `Strategy` interface
- Caches loaded strategies for reuse
- Throws clear errors for invalid strategies

**src/strategy/base.ts**
- Core strategy interface all strategies must implement
- Methods: `init()`, `onBar()`, `onEnd()`
- Properties: `params`, `name`, `description`, `paramSchema`

**src/strategy/index.ts**
- Exports strategy types and interfaces

---

## Frontend

Built with React + Vite, running on port 5173 (dev) or embedded in API server (prod).

### Components (`src/web/components/`)

**Layout & Shell**
- `App.tsx`: Root component with routing and global state
- `LoginPage.tsx`: Authentication UI

**Main Sections**
- `Dashboard/Dashboard.tsx`: Key metrics display (Sharpe, return, drawdown, profit factor, etc.)
- `Chart/Chart.tsx`: Main equity curve chart with TradingView Lightweight Charts
- `Chart/PortfolioChart.tsx`: Multi-asset portfolio breakdown charts

**Backtesting UI**
- `StrategyConfig/StrategyConfig.tsx`: Strategy selection and parameter configuration
- `History/History.tsx`: List of past backtest runs
- `HistoryExplorer/HistoryExplorer.tsx`: Detailed result explorer
- `HistoryExplorer/RunParamsModal.tsx`: Display saved parameters

**Optimization**
- `OptimizerModal/OptimizerModal.tsx`: Grid search UI with progress
- Displays optimization results in table format
- Shows best parameters and metrics

**Multi-Asset**
- `AggregationsPanel/AggregationsPanel.tsx`: Manage aggregation configs
- `AggregationsPanel/CreateAggregationModal.tsx`: Create multi-strategy setups
- `ScannerResults/ScannerResults.tsx`: Symbol scan results

**Paper Trading**
- `PaperTradingPanel/PaperTradingPanel.tsx`: Session management UI
- `PaperTradingPanel/CreatePaperSessionModal.tsx`: New session creation
- `PaperTradingPage/PaperTradingPage.tsx`: Dedicated paper trading page
- `PaperTradingPanel/PaperEquityChart.tsx`: Equity curve during session
- `PaperTradingPage/PaperDrawdownChart.tsx`: Drawdown visualization
- `FundingRateChart.tsx`: Funding rate timeline (for futures strategies)

**Config Management**
- `ImportConfigModal/ImportConfigModal.tsx`: Load exported configs
- `Modal/Modal.tsx`: Generic modal wrapper

### Hooks (`src/web/hooks/`)

**useBacktest.ts**
- Manages backtest form state and API calls
- Handles parameter validation and overrides
- Submits backtest requests and stores results

**useOptimization.ts**
- Manages optimization workflow
- SSE event stream handling for progress
- Result retrieval and history

**usePaperTrading.ts**
- Paper trading session management
- WebSocket connection for real-time events
- Session creation, start, pause, stop
- Trade execution streaming

**usePriceStream.ts**
- WebSocket price feed subscription
- Real-time ticker updates
- Symbol switching

**useUrlSync.ts**
- Synchronizes UI state with URL parameters
- Enables shareable backtest configurations
- Bookmarkable analysis sessions

### Stores (`src/web/stores/`)

Zustand state management for global application state:

**backtestStore.ts**
- Current backtest configuration
- Recent backtest results
- Selected result for display

**authStore.ts**
- Current user authentication
- JWT token and user profile
- Login/logout state

**aggregationStore.ts**
- Saved aggregation configurations
- Current aggregation being edited
- Sub-strategy list

**paperTradingStore.ts**
- Active paper trading sessions
- Current session trades and equity
- Session status and errors

**scannerStore.ts**
- Scanner configuration (strategy, parameters, symbol list)
- Scan results (matching symbols, signals, metrics)
- Filter state

### API Client (`src/web/api/client.ts`)

Type-safe API client functions:
- `runBacktest(config)`: POST /api/backtest/run
- `getBacktest(id)`: GET /api/backtest/:id
- `getBacktestHistory(filters)`: GET /api/backtest/history
- `runOptimization(config, onProgress)`: POST /api/optimize (SSE)
- `getOptimization(strategyName, symbol, timeframe)`: GET /api/optimize/...
- `listStrategies()`: GET /api/strategies
- `getStrategy(name)`: GET /api/strategies/:name
- `getCandles(exchange, symbol, timeframe, ...)`: GET /api/candles
- `getPaperSessions()`: GET /api/paper-trading/sessions
- `createPaperSession(config)`: POST /api/paper-trading/sessions
- `startPaperSession(sessionId)`: POST /api/paper-trading/sessions/:sessionId/start
- `getPaperSessionTrades(sessionId, limit, offset)`: GET /api/paper-trading/sessions/:sessionId/trades
- `getPaperSessionEquity(sessionId)`: GET /api/paper-trading/sessions/:sessionId/equity
- `exportConfig(runId)`: POST /api/config/export
- `importConfig(json)`: POST /api/config/import

### Types (`src/web/types/`)
- `BacktestResult`, `AggregateBacktestResult`: Backtest output types
- `StrategyInfo`, `StrategyDetails`: Strategy metadata
- `OptimizationResult`: Optimization output
- `PaperSession`, `PaperTrade`: Paper trading types
- `PerformanceMetrics`: Metrics definitions
- `CandleRequest`: Candle fetch parameters
- All exported from shared types module

---

## Paper Trading

Real-time paper trading simulation system running in parallel with backtesting.

### Engine (`src/paper-trading/engine.ts`)

**PaperTradingEngine**
- Extends EventEmitter for event streaming
- Runs alongside backend API (not blocking)
- Processes one tick every 5 minutes (configurable per session)
- On each tick:
  1. Fetches latest closed candles for all sub-strategies
  2. Updates adapter candle data via `appendCandles()` (no re-init)
  3. Gets signals from each adapter
  4. Allocates capital using same rules as aggregate engine
  5. Executes trades on portfolio
  6. Tracks equity, positions, and PnL
  7. Emits events for UI (trades, equity updates, errors, status changes)

**Adapter Caching**
- Adapters created once per sub-strategy and cached
- Strategy `init()` called only on first encounter
- Subsequent ticks call `appendCandles()` to update without re-initializing
- Preserves strategy internal state (indicators, buffers, etc.)

**Shadow State Restore**
- On session resume, positions from DB are used to restore adapter shadow state
- Ensures strategy sees correct position even after restart

**Multi-Bar Processing**
- Processes ALL new bars since last tick (not just latest)
- Catches crossovers and multi-bar patterns

**Stale Data Guard**
- Skips tick if latest candle is too old (>10 min old)
- Prevents trading on delayed data

**Retry Logic**
- Max 10 transient error retries with exponential backoff
- Gives up after repeated failures (logs as error)
- Notifies UI of retry state

**Key Methods:**
- `start()`: Begin ticking
- `pause()`: Pause without stopping
- `stop()`: Stop and cleanup
- `on(eventType, callback)`: Listen to events

### Session Manager (`src/paper-trading/session-manager.ts`)

**SessionManager**
- Singleton managing all active paper trading engines
- Restores active sessions on API startup
- Provides CRUD operations for sessions
- Handles graceful shutdown (pauses all engines before DB close)
- Exposes current sessions and their status

### Database (`src/paper-trading/db.ts`)

Persistent storage for paper trading:
- Sessions: status, config, capital, equity
- Trades: executed trades with PnL, fees
- Positions: current open positions per symbol
- Equity snapshots: per-tick equity history for charting
- Events: audit log of all trading events

### Types (`src/paper-trading/types.ts`)

**PaperSession**
- id, name, aggregationConfig, status
- initialCapital, currentEquity, currentCash
- tickCount, lastTickAt, nextTickAt
- errorMessage, createdAt, updatedAt

**PaperPosition**
- sessionId, symbol, direction (long/short)
- subStrategyKey: identifier for the sub-strategy that opened it
- entryPrice, amount, entryTime
- unrealizedPnl, fundingAccumulated
- stopLoss / takeProfit (optional)

**PaperTrade**
- sessionId, symbol, action (open_long/open_short/close_long/close_short)
- price, amount, timestamp
- pnl, pnlPercent, fee, fundingIncome, balanceAfter

**PaperEquitySnapshot**
- sessionId, timestamp, equity, cash, positionsValue

**PaperTradingEvent** (Union type)
- trade_opened, trade_closed: Trade execution
- funding_payment: Funding rate payment
- equity_update: End-of-tick equity snapshot
- tick_complete: Tick processing completed
- error: Engine error
- status_change: Session status change
- retry: Transient error with retry info

### Live Data Fetcher (`src/paper-trading/live-data.ts`)

Fetches latest candle data for paper trading:
- Queries exchange for latest closed candles
- Supports multiple symbols simultaneously
- Filters to only new bars since last tick
- Handles exchange-specific data formats
- Caches API responses within tick window

---

## CLI Tools

Command-line interface for programmatic backtesting and optimization.

### quant-validate.ts
Validates strategy file against base interface:
```bash
npm run quant:validate -- strategies/my-strategy.ts
```
- Checks strategy compiles and exports correctly
- Validates parameter schema is present
- Reports errors with suggestions

### quant-backtest.ts
Run single backtest from CLI:
```bash
npm run quant:backtest -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 [options]
```
- Options: `--timeframe=4h`, `--capital=10000`, `--param.KEY=VALUE`, `--slippage=0.1`
- Outputs JSON to stdout (all logging to stderr)
- Success: `{"success":true,"metrics":{...},"tradeCount":42}`
- Failure: `{"success":false,"error":"..."}`

### quant-optimize.ts
Parameter grid search:
```bash
npm run quant:optimize -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 --metric=sharpeRatio [options]
```
- Options: `--param.KEY.min=1 --param.KEY.max=100 --param.KEY.step=5`
- Progress printed to stderr
- Final results to stdout: `{"bestParams":{...},"bestMetrics":{...}}`

### quant-walk-forward.ts
Robustness validation:
```bash
npm run quant:walk-forward -- --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-12-01 --metric=sharpeRatio [options]
```
- Automatically splits into 70% train / 30% test
- Optimizes on train, validates on test
- Outputs: `{"trainMetrics":{...},"testMetrics":{...},"degradation":15.2,"robust":true}`

### quant-score.ts
Score walk-forward results:
```bash
npm run quant:score -- --walk-forward-file=results.json
```
- Reads walk-forward result JSON
- Computes robustness verdict
- Outputs pass/fail and recommendations

### backtest.ts
(Legacy) General backtest runner

---

## Analysis & Metrics

### Performance Metrics

Comprehensive metrics calculated after each backtest:

| Metric | Formula | Interpretation |
|--------|---------|-----------------|
| Total Return | Final Equity - Initial Capital | Absolute profit in dollars |
| Total Return % | (Total Return / Initial Capital) × 100 | Profit as percentage |
| Sharpe Ratio | (Mean Daily Return) / StdDev(Daily Returns) | Risk-adjusted return (annualized) |
| Sortino Ratio | (Mean Daily Return) / StdDev(Downside Returns) | Like Sharpe, only downside volatility |
| Max Drawdown | Largest peak-to-trough decline | Worst-case loss exposure |
| Max Drawdown % | Max Drawdown / Peak Equity × 100 | Drawdown as percentage |
| Win Rate | (Winning Trades / Total Trades) × 100 | Percentage of profitable trades |
| Profit Factor | Gross Profit / Gross Loss | 2.0+ is profitable, >3.0 is strong |
| Total Trades | Count of closed trades | Trade frequency indicator |
| Average Win | Sum(Winning PnL) / Winning Trades | Mean profit per winning trade |
| Average Loss | Sum(Losing PnL) / Losing Trades | Mean loss per losing trade |
| Expectancy | Total PnL / Total Trades | Expected value per trade |
| Largest Win / Loss | Best/worst single trade | Best/worst-case scenarios |
| Average Trade Duration | Mean(Close Time - Open Time) | Typical holding period |
| Exposure Time | (Hours In Position / Total Hours) × 100 | Percentage of time trading |
| Total Fees | Sum of all trading fees | Cost of execution |

### Rolling Metrics

Per-day analysis stored as `RollingMetrics`:
- Daily returns (percentage change)
- Daily drawdown (maximum intra-day loss)
- Daily trades (count per day)
- Cumulative maximum equity (for drawdown calculation)

---

## Infrastructure

### Docker Setup

Development and production Docker environments:

**Development** (`.docker/claude-sandbox/`)
- Fastify API server on port 3000
- Vite dev server on port 5173 (requires host machine)
- PostgreSQL on port 5432 with test database
- Volume mounting for live code reloading

**Production** (Deployed to 5.223.56.226)
- Fastify API + static files on port 3000
- nginx reverse proxy on port 80/443
- PostgreSQL on port 5432 (persistent volume)
- Docker compose orchestration

### Database

**PostgreSQL** (Production)
- Connection pooling via pg library
- Migrations system for schema versioning
- Connection string: `postgresql://backtesting:PASSWORD@host:5432/backtesting`
- Persistent volumes for data durability

**Tables Structure:**
- candles, backtest_runs, optimization_runs
- funding_rates, open_interest, long_short_ratio
- paper_sessions, paper_trades, paper_positions, paper_equity_snapshots
- users, _migrations

### Environment Configuration

**Variables:**
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: API server port (default: 3000)
- `HOST`: API server host (default: 0.0.0.0)
- `LOG_LEVEL`: Logging level (default: info)
- `ROOT_PASSWORD`: Default admin password (default: "admin")
- `JWT_SECRET`: Secret key for token signing
- `NODE_ENV`: "development" or "production"

---

## Authentication

JWT-based authentication system protecting all API endpoints.

### Password Management (`src/auth/password.ts`)
- Hashes passwords using bcryptjs
- Compares during login
- Supports password reset and update

### JWT (`src/auth/jwt.ts`)
- Generates tokens with 24h expiry (configurable)
- Verifies token signatures
- Decodes claims (user ID, username)

### Database (`src/auth/db.ts`)
- Users table with hashed passwords
- Retrieve user by ID or username
- Create/update users
- Ensure root user exists with default password

### Auth Hook (`src/auth/hook.ts` and `src/auth/index.ts`)
- Global request hook validating JWT
- Public endpoints: `/api/auth/login`, `/api/health`
- All other endpoints require valid token
- Attaches user info to request object

---

## Summary

This backtesting system provides a complete infrastructure for quantitative crypto trading research:

1. **Backtesting Engine**: Single and multi-asset backtests with configurable brokers and realistic trade simulation
2. **Optimization**: Grid search parameter optimization with progress tracking
3. **Robustness Testing**: Walk-forward validation to detect overfitting
4. **Paper Trading**: Real-time simulation without real capital
5. **Strategies**: 14 production-ready strategies across momentum, funding rates, and market structure
6. **Analytics**: Comprehensive performance metrics and equity tracking
7. **API**: Complete REST interface for programmatic access
8. **Web UI**: React dashboard with charts, optimization history, and paper trading panels
9. **Infrastructure**: Docker-based deployment with PostgreSQL persistence
10. **Authentication**: JWT-based user authentication

The system is designed for extensibility: new strategies can be added to `/strategies/`, new indicators via technicalindicators library, and new exchanges via CCXT.

**Key Removed Components** (as of 2026-03-10 cleanup):
- Polymarket prediction market support
- Pairs trading (long-short hedging)
- Result storage to files (now database-only)
- Funding-rate-spike v1 (replaced with v2)

