# Backtesting System Architecture

## Overview

A comprehensive TypeScript-based crypto backtesting and paper trading platform supporting single-asset and multi-asset portfolio strategies, real-time simulation, optimization, and walk-forward testing across multiple exchanges.

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Language | TypeScript | Type safety, single language across stack |
| Backend | Fastify | Fast, type-safe, good WebSocket support |
| Frontend | React + Vite | Fast DX, rich component ecosystem |
| Database | PostgreSQL | Production-grade, connection pooling, migrations |
| Charting | TradingView Lightweight Charts | Free, professional-grade, lightweight |
| Exchange API | CCXT | Unified API for 100+ exchanges |
| Indicators | technicalindicators | Pure JS, no native dependencies |
| Auth | JWT + bcryptjs | Token-based, password hashing |
| Testing | Vitest + Playwright | Fast unit tests, visual regression testing |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Dashboard    │ │ Chart        │ │ Paper Trading│             │
│  │ Backtesting  │ │ Results      │ │ Monitor      │             │
│  │ Optimizer    │ │ Equity Curve │ │ Live Signals │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
│         │                │                │                      │
│         └────────────────┴────────────────┘                      │
│                  │ REST API + WebSocket                          │
└──────────────────┼──────────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────────┐
│                  │            BACKEND (Fastify)                 │
│  ┌───────────────▼───────────────────────────────────┐          │
│  │         API Routes & WebSocket Handlers           │          │
│  │  (backtest, optimize, strategies, candles, paper- │          │
│  │   trading, aggregations, auth, config-export)     │          │
│  └───────────────┬───────────────────────────────────┘          │
│                  │                                               │
│  ┌───────────────┴────────────────────┬─────────────┐           │
│  │                                    │             │           │
│  ▼                                    ▼             ▼           │
│  ┌─────────────────────────────┐  ┌─────────────────────────┐  │
│  │ Backtesting Engines         │  │ Paper Trading Engine    │  │
│  ├─ engine.ts (single-asset)   │  ├─ engine.ts             │  │
│  ├─ aggregate-engine.ts        │  ├─ session-manager.ts    │  │
│  ├─ optimizer.ts               │  ├─ live-data.ts          │  │
│  ├─ walk-forward.ts            │  └─ Real-time ticking     │  │
│  └─────────────────────────────┘  └─────────────────────────┘  │
│       │                                      │                  │
│       ├─ Strategy Loader                     │                  │
│       │  (14 production strategies)           │                  │
│       │                                      │                  │
│       ├─ Signal Adapter                      │                  │
│       │  (strategy → signals)                │                  │
│       │                                      │                  │
│       ├─ Portfolio Management                │                  │
│       │  (long/short positions)              │                  │
│       │                                      │                  │
│       └─ Broker Simulation                   │                  │
│          (order execution + fees)            │                  │
│                                              │                  │
│  ┌──────────────────────────────┬────────────┴──────────────┐   │
│  │                              │                          │   │
│  ▼                              ▼                          ▼   │
│  ┌────────────────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Data Layer             │ │ Metrics      │ │ Risk         │  │
│  ├─ Database (PostgreSQL) │ │ Calculation  │ │ Management   │  │
│  ├─ Exchange Providers    │ │              │ │              │  │
│  │  (Binance, Bybit)      │ └──────────────┘ └──────────────┘  │
│  └────────────────────────┘                                    │
│           │                                                    │
│           ├─ candles (cached by exchange/symbol/timeframe)    │
│           ├─ funding_rates (futures)                          │
│           ├─ open_interest, long_short_ratio                  │
│           ├─ backtest_runs, optimization_runs                 │
│           ├─ paper_sessions, paper_trades, paper_positions    │
│           └─ users (authentication)                           │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Authentication (JWT + PostgreSQL)                        │ │
│  │ - Login with password (bcrypt hashing)                   │ │
│  │ - Token refresh (24h expiry)                             │ │
│  │ - Protected routes via auth hook                         │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
    ┌─────────┐       ┌─────────┐       ┌──────────┐
    │ Binance │       │ Bybit   │       │ CCXT...  │
    │ (Spot)  │       │ (Futures)       │ (Others) │
    └─────────┘       └─────────┘       └──────────┘
```

## Directory Structure

```
backtesting/
├── src/
│   ├── core/                    # Backtesting engines
│   │   ├── engine.ts            # Single-asset backtest engine
│   │   ├── aggregate-engine.ts   # Multi-asset portfolio engine
│   │   ├── optimizer.ts         # Parameter grid search
│   │   ├── walk-forward.ts      # Robustness validation
│   │   ├── portfolio.ts         # Position & balance management
│   │   ├── leveraged-portfolio.ts # Leverage support
│   │   ├── multi-portfolio.ts   # Multi-symbol positions
│   │   ├── broker.ts            # Order execution & fees
│   │   ├── signal-adapter.ts    # Strategy → signal conversion
│   │   ├── signal-types.ts      # Signal definitions
│   │   ├── weight-calculators.ts # Signal weight computation
│   │   ├── config-export.ts     # Configuration persistence
│   │   ├── scoring.ts           # Result scoring & ranking
│   │   ├── multi-asset-validation.ts # Config validation
│   │   └── types.ts             # Core type definitions
│   │
│   ├── data/                    # Data layer
│   │   ├── db.ts                # PostgreSQL connection & migrations
│   │   ├── providers/           # Exchange data providers
│   │   │   ├── base.ts          # Provider interface
│   │   │   ├── binance.ts       # Binance implementation
│   │   │   ├── bybit.ts         # Bybit implementation
│   │   │   └── index.ts         # Provider factory
│   │   └── index.ts             # Data layer exports
│   │
│   ├── strategy/                # Strategy system
│   │   ├── base.ts              # Base strategy interface
│   │   ├── loader.ts            # Dynamic strategy loader
│   │   └── index.ts             # Strategy exports
│   │
│   ├── analysis/                # Results analysis
│   │   ├── metrics.ts           # Performance metrics (Sharpe, max DD, etc.)
│   │   └── index.ts             # Analysis exports
│   │
│   ├── paper-trading/           # Real-time paper trading
│   │   ├── engine.ts            # Ticking engine with EventEmitter
│   │   ├── session-manager.ts   # Session persistence & restoration
│   │   ├── db.ts                # Paper trading database
│   │   ├── live-data.ts         # Live candle fetcher
│   │   └── types.ts             # Session/trade/position types
│   │
│   ├── auth/                    # Authentication system
│   │   ├── password.ts          # bcrypt hashing/verification
│   │   ├── jwt.ts               # Token generation/verification
│   │   ├── db.ts                # User database operations
│   │   ├── hook.ts              # Fastify auth hook
│   │   └── index.ts             # Auth module exports
│   │
│   ├── api/                     # REST API
│   │   ├── server.ts            # Fastify server setup
│   │   └── routes/
│   │       ├── backtest.ts      # POST /api/backtest/run, GET history
│   │       ├── optimize.ts      # POST /api/optimize, GET results
│   │       ├── strategies.ts    # GET /api/strategies
│   │       ├── candles.ts       # GET /api/candles
│   │       ├── funding-rates.ts # GET /api/funding-rates
│   │       ├── aggregations.ts  # CRUD /api/aggregations
│   │       ├── paper-trading.ts # Paper trading sessions & trades
│   │       ├── config-export.ts # Config import/export
│   │       ├── price-stream.ts  # WebSocket price feed
│   │       ├── scan.ts          # POST /api/scan
│   │       └── auth.ts          # POST /api/auth/login
│   │
│   └── web/                     # React frontend
│       ├── main.tsx             # Entry point
│       ├── App.tsx              # Root router & auth wrapper
│       ├── components/
│       │   ├── Chart/           # TradingView charts
│       │   ├── Dashboard/       # Metrics display
│       │   ├── StrategyConfig/  # Parameter forms
│       │   ├── OptimizerModal/  # Grid search UI
│       │   ├── History/         # Result browser
│       │   ├── AggregationsPanel/ # Multi-strategy management
│       │   ├── PaperTradingPanel/ # Session control
│       │   ├── PaperTradingPage/ # Dedicated paper trading
│       │   ├── ScannerResults/  # Symbol scanning results
│       │   ├── ImportConfigModal/ # Config loading
│       │   ├── Modal/           # Generic modal wrapper
│       │   ├── FundingRateChart/ # Funding rate visualization
│       │   └── LoginPage.tsx    # Authentication UI
│       ├── hooks/
│       │   ├── useBacktest.ts   # Backtest state & API
│       │   ├── useOptimization.ts # Optimization workflow
│       │   ├── usePaperTrading.ts # Session management
│       │   ├── usePriceStream.ts # WebSocket prices
│       │   └── useUrlSync.ts    # URL ↔ state sync
│       ├── stores/              # Zustand state management
│       │   ├── backtestStore.ts
│       │   ├── authStore.ts
│       │   ├── aggregationStore.ts
│       │   ├── paperTradingStore.ts
│       │   └── scannerStore.ts
│       ├── api/
│       │   └── client.ts        # Type-safe API client
│       └── types/               # Frontend types
│
├── strategies/                  # 14 production strategies
│   ├── sma-crossover.ts         # Basic SMA crossover
│   ├── ema-macd-trend-momentum.ts # EMA + MACD
│   ├── cci-momentum-breakout.ts # CCI momentum
│   ├── volatility-squeeze-breakout.ts # BB squeeze
│   ├── volatility-breakout-scalper.ts # ATR scalping
│   ├── bb-rsi-scalper.ts        # BB + RSI
│   ├── funding-rate-spike-v2.ts # Funding rate scalping
│   ├── fr-gradient-momentum.ts  # FR momentum
│   ├── fr-epoch-scalper.ts      # FR epoch trading
│   ├── fr-regime-momentum.ts    # FR regime detection
│   ├── fr-settlement-scalper.ts # FR settlement scalping
│   ├── market-leader-divergence.ts # BTC/alt divergence
│   ├── oi-delta-regime-scalper.ts # OI momentum
│   └── gpt-long-ultimate.ts     # Multi-confirmation long
│
├── migrations/                  # PostgreSQL migration files
│   ├── 001-initial-schema.sql
│   ├── 002-paper-trading.sql
│   ├── 003-auth.sql
│   └── ...
│
├── data/                        # Runtime data (gitignored)
│   └── (PostgreSQL data in container volumes)
│
├── docs/                        # Documentation
│   ├── ARCHITECTURE.md          # This file
│   ├── PROJECT_GOALS.md         # Project vision & phases
│   ├── system_inventory.md      # Current system state
│   ├── changelogs/              # Change history
│   ├── strategies/              # Strategy research & specs
│   └── images/                  # Documentation images
│
├── scripts/                     # CLI tools & scripts
│   ├── quant-validate.ts        # Strategy validation
│   ├── quant-backtest.ts        # Single backtest
│   ├── quant-optimize.ts        # Grid search
│   ├── quant-walk-forward.ts    # Walk-forward testing
│   ├── quant-score.ts           # Result scoring
│   └── backtest.ts              # Legacy backtest runner
│
├── chat_logs/                   # Session logs & agent usage
│   ├── agent-usage.log          # Timestamped agent calls
│   └── CHANGELOG.md             # High-level change index
│
└── .claude/                     # Claude Code config
    └── agents/                  # Custom agent definitions
```

## Core Components

### 1. Backtesting Engines

#### Single-Asset Engine (`src/core/engine.ts`)
Executes strategy on one symbol with one timeframe:
- Loads strategy dynamically from `/strategies/`
- Fetches historical candles and funding rates
- Bar-by-bar execution loop
- Manages positions, fees, slippage
- Calculates metrics and equity curve
- Supports spot and futures modes
- Optional preloaded data for optimizer reuse

#### Multi-Asset Engine (`src/core/aggregate-engine.ts`)
Runs multiple strategies with shared capital:
- Loads N strategies (one per symbol/timeframe)
- Creates SignalAdapter for each strategy
- Synchronized multi-symbol bar processing
- Capital allocation strategies:
  - `single_strongest`: Trade only strongest signal
  - `weighted_multi`: Allocate based on signal weight
  - `top_n`: Trade top N signals
- Per-asset metrics + aggregate equity curve

#### Optimizer (`src/core/optimizer.ts`)
Automated parameter grid search:
- Generates all parameter combinations
- Runs backtest for each combination
- Selects best by metric (Sharpe, return, profit factor, win rate, composite)
- Caches candles to avoid redundant I/O
- Saves history to database
- Supports multi-symbol batch optimization

#### Walk-Forward Testing (`src/core/walk-forward.ts`)
Robustness validation:
- Splits data: 70% train, 30% test
- Optimizes on training period
- Validates on out-of-sample test period
- Measures parameter degradation
- Returns pass/fail verdict based on threshold

### 2. Paper Trading Engine (`src/paper-trading/engine.ts`)

Real-time simulation without real capital:
- Ticks every 5 minutes (configurable)
- Fetches latest candles for all sub-strategies
- Processes all new bars since last tick (multi-bar support)
- Updates strategy adapters via `appendCandles()` (no re-init)
- Allocates capital using same rules as aggregate engine
- Executes trades on MultiPortfolio
- Emits events (trades, equity, errors) to frontend via WebSocket
- Handles transient errors with exponential backoff retry
- Guards against stale data (>10 min old)
- Restores positions from database on session resume

### 3. Strategy System

**Base Interface** (`src/strategy/base.ts`):
```typescript
interface Strategy {
  name: string;                              // Strategy identifier
  description: string;                       // Human description
  paramSchema: Zod validation schema;        // Parameter validation
  init(): void;                              // Sync initialization
  onBar(ctx: StrategyContext): void;         // Per-bar logic
  onEnd(): void;                             // Cleanup
}

interface StrategyContext {
  candles: Map<string, Candle[]>;           // Multi-symbol candles
  currentBar: Candle;                        // Current bar for symbol
  portfolio: Portfolio;                      // Position state
  buy(symbol, amount): void;                 // Place buy order
  sell(symbol, amount): void;                // Place sell order
  short(symbol, amount): void;               // Short entry
  cover(symbol, amount): void;               // Short exit
  close(symbol): void;                       // Close all positions
  fundingRate?: number;                      // For futures strategies
  indicator(name, params): unknown;          // Technical indicators
  params: Record<string, unknown>;           // User config
}
```

**Loader** (`src/strategy/loader.ts`):
- Dynamically imports strategy files
- Validates against Strategy interface
- Caches loaded strategies

### 4. Signal Adapter System

Converts strategy trading intent to standardized signals:
- Tracks strategy's perceived portfolio state ("shadow portfolio")
- Interprets buy/sell/close actions as directional signals
- Emits signals with weight (0-1) for capital allocation
- Enables strategies to work in aggregation engine

### 5. Portfolio Management

#### Portfolio (`src/core/portfolio.ts`)
Single-symbol position tracking:
- Long and short position state
- Unrealized PnL on open positions
- Cash balance management
- Fee tracking
- Trade record generation

#### LeveragedPortfolio (`src/core/leveraged-portfolio.ts`)
Futures trading with leverage:
- Applies leverage multiplier to positions
- Margin management
- Funding rate payment tracking

#### MultiPortfolio (`src/core/multi-portfolio.ts`)
Multi-symbol position tracking:
- Separate portfolios per symbol
- Capital allocation per asset
- Aggregate equity calculation

### 6. Broker Simulation (`src/core/broker.ts`)

Order execution with realistic costs:
- Market orders filled at price ± slippage
- Limit orders filled when price touched
- Fee deduction from order value
- Spot and futures commission models
- Fee and slippage tracking per trade

### 7. Authentication System

**Password** (`src/auth/password.ts`): bcryptjs hashing
**JWT** (`src/auth/jwt.ts`): Token generation/verification (24h expiry)
**Database** (`src/auth/db.ts`): User CRUD
**Auth Hook** (`src/auth/hook.ts`): Fastify middleware protecting routes

Public endpoints:
- POST /api/auth/login
- GET /api/health

All other routes require valid JWT token.

## Database Schema (PostgreSQL)

**Tables:**
- `candles` - OHLCV data (indexed by exchange, symbol, timeframe, timestamp)
- `backtest_runs` - Backtest results with metrics and equity curve
- `optimization_runs` - Optimization history with best parameters
- `funding_rates` - Futures funding rate data
- `open_interest` - Open interest history per symbol
- `long_short_ratio` - Long/short ratio data per symbol
- `paper_sessions` - Paper trading session records
- `paper_trades` - Trades executed in paper sessions
- `paper_positions` - Current open positions per session
- `paper_equity_snapshots` - Equity history for charting
- `users` - User accounts with hashed passwords
- `_migrations` - Migration tracking for schema versioning

**Key Migrations:**
- 001: Initial schema (candles, backtest_runs, etc.)
- 002: Paper trading tables (sessions, trades, positions, equity)
- 003: Authentication (users table)
- Plus additional schema changes for new features

**Connection:**
- Pooling via node-postgres (pg library)
- Max 10 connections per pool
- Automatic migration system on startup

## API Endpoints

### Backtesting Routes
- `POST /api/backtest/run` - Execute backtest (single or aggregate)
- `GET /api/backtest/:id` - Get backtest result by ID
- `GET /api/backtest/history` - List results with filtering/pagination
- `GET /api/backtest/groups` - Group results by strategy/symbol/timeframe
- `DELETE /api/backtest/:id` - Delete specific result
- `DELETE /api/backtest/all` - Clear all backtest history

### Optimization Routes
- `POST /api/optimize` - Start grid search (SSE progress stream)
- `GET /api/optimize/:strategyName/:symbol/:timeframe` - Get all runs
- `GET /api/optimize/:strategyName/:symbol/:timeframe/latest` - Latest run
- `GET /api/optimize/all` - List all optimization runs
- `DELETE /api/optimize/:strategyName/:symbol/:timeframe` - Delete runs
- `DELETE /api/optimize/id/:id` - Delete specific run

### Strategy Routes
- `GET /api/strategies` - List all strategies with metadata
- `GET /api/strategies/:name` - Get strategy details, params, defaults

### Candle Routes
- `GET /api/candles` - Fetch historical candles
- `GET /api/exchanges` - List supported exchanges
- `GET /api/symbols` - List trading pairs

### Funding Rate Routes
- `GET /api/funding-rates` - Get funding rate history

### Aggregation Routes
- `GET /api/aggregations` - List saved multi-strategy configs
- `GET /api/aggregations/:id` - Get specific aggregation
- `POST /api/aggregations` - Save new aggregation config
- `PUT /api/aggregations/:id` - Update aggregation
- `DELETE /api/aggregations/:id` - Delete aggregation
- `POST /api/aggregations/:id/run` - Execute saved aggregation

### Paper Trading Routes
- `GET /api/paper-trading/sessions` - List sessions
- `GET /api/paper-trading/sessions/:sessionId` - Get session details
- `POST /api/paper-trading/sessions` - Create new session
- `POST /api/paper-trading/sessions/:sessionId/start` - Start/resume
- `POST /api/paper-trading/sessions/:sessionId/pause` - Pause
- `POST /api/paper-trading/sessions/:sessionId/stop` - Stop
- `DELETE /api/paper-trading/sessions/:sessionId` - Delete session
- `GET /api/paper-trading/sessions/:sessionId/trades` - Get trades
- `GET /api/paper-trading/sessions/:sessionId/equity` - Get equity history
- `GET /api/paper-trading/sessions/:sessionId/events` - Event stream

### Config Export Routes
- `POST /api/config/export` - Export backtest/aggregation config as JSON
- `POST /api/config/import` - Import config from JSON

### Scanner Routes
- `POST /api/scan` - Scan symbols for strategy signals

### Auth Routes
- `POST /api/auth/login` - Authenticate with password, get JWT token
- `POST /api/auth/refresh` - Refresh expired token

### WebSocket Routes
- `WS /api/price-stream` - Real-time price feed subscription

## Performance Metrics

Calculated from trades and equity curve:

| Metric | Description |
|--------|-------------|
| Total Return | Final equity - initial capital |
| Total Return % | (Return / Initial Capital) × 100 |
| Sharpe Ratio | Risk-adjusted return (annualized, with 0% risk-free rate) |
| Sortino Ratio | Like Sharpe but only penalizes downside volatility |
| Max Drawdown | Largest peak-to-trough decline in equity |
| Max Drawdown % | Max drawdown as percentage of peak |
| Win Rate | Percentage of winning trades |
| Profit Factor | Gross profit / Gross loss |
| Total Trades | Count of closed trades |
| Average Win/Loss | Mean PnL per winning/losing trade |
| Expectancy | Expected value per trade (Total PnL / Trade Count) |
| Largest Win/Loss | Best and worst single trade |
| Average Trade Duration | Mean time in position |
| Exposure Time | % of total time in market |
| Total Fees | Sum of all trading fees |
| Total Slippage | Sum of all slippage costs |

## Supported Timeframes

- 1m, 5m, 15m, 30m (minute)
- 1h, 4h (hour)
- 1d (day)
- 1w (week)

## Supported Exchanges

**Binance** (Spot only)
- Candles: 1m-1w via CCXT
- Funding Rates: N/A

**Bybit** (Perpetuals)
- Candles: 1m-1w via CCXT
- Funding Rates: Via direct REST API
- Open Interest: Available
- Long/Short Ratio: Available

**Others via CCXT:**
- Any exchange supported by CCXT with `fetchOHLCV`

## Deployment Architecture

### Development
- API: Fastify on port 3000
- Frontend: Vite on port 5173 (host machine required)
- Database: PostgreSQL in Docker on port 5432
- Live reload via volume mounting

### Production
- API + static files: Fastify on port 3000
- Reverse proxy: nginx on port 80/443
- Database: PostgreSQL persistent volume
- Docker compose orchestration
- Deployed to 5.223.56.226 (Singapore)

## Implementation Phases

### Phase 1 (Complete)
- Single-asset backtesting
- Dashboard with equity curves
- Strategy plugin system
- Historical backtest replay

### Phase 2 (Complete)
- Multi-asset portfolio backtesting
- Signal aggregation system
- Aggregation configuration saving
- Cross-asset strategies

### Phase 3 (Complete)
- Parameter grid search (optimizer)
- Walk-forward robustness testing
- Optimization history tracking
- Parameter auto-tuning

### Phase 4 (Complete - Partial)
- Paper trading simulation (done)
- Real-time strategy signals (done)
- WebSocket event streaming (done)
- Real exchange connectors (planned - Connector abstraction)

### Current Phase: UI Polish + Trading Connector Abstraction
- Improving dashboard responsiveness
- Connector entity for paper/live trading
- Production readiness improvements
