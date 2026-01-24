# Backtesting System Architecture

## Overview

A modular crypto backtesting platform with plugin-based strategies, multi-exchange support, and real-time visualization.

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Language | TypeScript | Type safety, single language across stack |
| Backend | Fastify | Faster than Express, good TS support |
| Frontend | React + Vite | Fast DX, component ecosystem |
| Database | SQLite (better-sqlite3) | Zero setup, portable, sufficient for 1-2 years data |
| Charting | TradingView Lightweight Charts | Free, professional-grade, lightweight |
| Exchange API | CCXT | Unified API for 100+ exchanges |
| Indicators | technicalindicators | Pure JS, no native dependencies |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Chart     │  │  Dashboard  │  │  Strategy   │             │
│  │  Component  │  │  Component  │  │   Config    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └────────────────┴────────────────┘                     │
│                          │ REST API                             │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    BACKEND (Fastify)                             │
│                          │                                       │
│  ┌───────────────────────▼───────────────────────┐              │
│  │              API Routes                        │              │
│  └───────────────────────┬───────────────────────┘              │
│                          │                                       │
│  ┌───────────┬───────────┼───────────┬───────────┐              │
│  │           │           │           │           │              │
│  ▼           ▼           ▼           ▼           ▼              │
│ Strategy   Backtest    Data       Risk       Analysis           │
│ Loader     Engine    Provider   Manager     Module              │
│  │           │           │           │           │              │
│  │           └─────┬─────┘           │           │              │
│  │                 │                 │           │              │
│  └────────────────►│◄────────────────┘           │              │
│                    │                             │              │
│                    ▼                             │              │
│              ┌─────────────┐                     │              │
│              │   SQLite    │◄────────────────────┘              │
│              │  Database   │                                    │
│              └─────────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │    Exchanges (CCXT)     │
              │  Binance │ Bybit │ ...  │
              └─────────────────────────┘
```

## Directory Structure

```
backtesting/
├── src/
│   ├── core/                    # Backtesting engine
│   │   ├── engine.ts            # Main backtest loop
│   │   ├── portfolio.ts         # Position & balance management
│   │   ├── order.ts             # Order execution simulation
│   │   ├── broker.ts            # Broker abstraction (backtest/live)
│   │   └── types.ts             # Core type definitions
│   │
│   ├── data/                    # Data layer
│   │   ├── providers/           # Exchange data providers
│   │   │   ├── base.ts          # Provider interface
│   │   │   ├── binance.ts       # Binance implementation
│   │   │   └── index.ts         # Provider factory
│   │   ├── cache.ts             # Candle caching logic
│   │   ├── db.ts                # SQLite connection & migrations
│   │   └── models/              # Database models
│   │       ├── candle.ts        # OHLCV storage
│   │       ├── backtest.ts      # Backtest run records
│   │       └── trade.ts         # Trade history
│   │
│   ├── strategy/                # Strategy system
│   │   ├── base.ts              # Base strategy interface
│   │   ├── context.ts           # Strategy execution context
│   │   ├── loader.ts            # Dynamic strategy loader
│   │   └── registry.ts          # Strategy registration
│   │
│   ├── indicators/              # Technical indicators wrapper
│   │   └── index.ts             # Indicator registry
│   │
│   ├── risk/                    # Risk management module
│   │   ├── manager.ts           # Risk manager orchestrator
│   │   ├── rules/               # Risk rules
│   │   │   ├── maxDrawdown.ts   # Max drawdown limit
│   │   │   ├── dailyLoss.ts     # Daily loss limit
│   │   │   ├── positionSize.ts  # Position sizing rules
│   │   │   └── tradeRisk.ts     # Per-trade risk limit
│   │   └── killswitch.ts        # Emergency stop logic
│   │
│   ├── analysis/                # Results analysis
│   │   ├── metrics.ts           # Performance metrics calculator
│   │   ├── correlation.ts       # Asset correlation analysis
│   │   └── report.ts            # Report generation
│   │
│   ├── api/                     # REST API
│   │   ├── server.ts            # Fastify server setup
│   │   └── routes/
│   │       ├── backtest.ts      # Backtest endpoints
│   │       ├── strategy.ts      # Strategy management
│   │       ├── data.ts          # Candle data endpoints
│   │       └── history.ts       # Run history endpoints
│   │
│   └── web/                     # React frontend
│       ├── main.tsx             # Entry point
│       ├── App.tsx              # Main app component
│       ├── components/
│       │   ├── Chart/           # TradingView chart wrapper
│       │   ├── Dashboard/       # Results dashboard
│       │   ├── StrategyConfig/  # Strategy parameter editor
│       │   ├── RiskConfig/      # Risk management config
│       │   └── History/         # Backtest history browser
│       ├── hooks/               # React hooks
│       ├── stores/              # State management (Zustand)
│       └── api/                 # API client
│
├── strategies/                  # User strategy plugins
│   ├── sma-crossover.ts         # Example: SMA crossover
│   └── rsi-oversold.ts          # Example: RSI strategy
│
├── data/                        # Runtime data (gitignored)
│   └── backtesting.db           # SQLite database
│
├── config/                      # Configuration
│   └── default.json             # Default settings
│
├── docs/                        # Documentation
├── chat_logs/                   # AI session logs
└── .claude/                     # Claude Code config
    └── agents/                  # Custom agents
```

## Core Components

### 1. Backtesting Engine

The engine processes candles bar-by-bar:

```typescript
interface BacktestConfig {
  strategy: string;
  params: Record<string, unknown>;
  symbols: string[];           // e.g., ['BTCUSDT', 'ETHUSDT']
  timeframes: Timeframe[];     // e.g., ['1h', '4h']
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  exchange: string;
}

interface BacktestResult {
  id: string;
  config: BacktestConfig;
  trades: Trade[];
  metrics: PerformanceMetrics;
  equity: EquityPoint[];
  runAt: Date;
}
```

**Execution Flow:**
1. Load strategy from plugins
2. Fetch/cache candles for all symbols and timeframes
3. Align candles by timestamp
4. For each bar:
   - Update strategy context with new candles
   - Call `strategy.onBar(context)`
   - Process orders through broker
   - Apply risk management checks
   - Record equity point
5. Calculate final metrics
6. Save run to database

### 2. Strategy Plugin Interface

```typescript
interface Strategy {
  name: string;
  description: string;
  version: string;

  // Parameter schema for UI generation
  params: StrategyParamSchema[];

  // Lifecycle hooks
  onInit(context: StrategyContext): void;
  onBar(context: StrategyContext): void;
  onOrderFilled(context: StrategyContext, order: Order): void;
  onEnd(context: StrategyContext): void;
}

interface StrategyContext {
  // Multi-asset, multi-timeframe data access
  candles(symbol: string, timeframe: Timeframe, lookback?: number): Candle[];

  // Current bar for primary symbol/timeframe
  currentBar: Candle;

  // Portfolio state
  portfolio: Portfolio;

  // Order placement
  buy(symbol: string, amount: number): Order;
  sell(symbol: string, amount: number): Order;

  // Indicators
  indicator<T>(name: string, params: unknown[]): T;

  // Strategy parameters (user-configured)
  params: Record<string, unknown>;

  // Logging
  log(message: string): void;
}
```

### 3. Risk Management

```typescript
interface RiskConfig {
  maxDrawdownPercent: number;      // e.g., 20% max drawdown
  maxDailyLossPercent: number;     // e.g., 5% daily loss limit
  maxPositionSizePercent: number;  // e.g., 10% per position
  maxRiskPerTradePercent: number;  // e.g., 2% risk per trade
  killSwitchEnabled: boolean;
}

interface RiskManager {
  check(order: Order, portfolio: Portfolio): RiskCheckResult;
  onTradeClosed(trade: Trade): void;
  isKillSwitchTriggered(): boolean;
  reset(): void;
}
```

### 4. Data Provider

```typescript
interface DataProvider {
  exchange: string;

  fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    start: Date,
    end: Date
  ): Promise<Candle[]>;

  getAvailableSymbols(): Promise<string[]>;
}
```

## Database Schema

```sql
-- Candles cache
CREATE TABLE candles (
  id INTEGER PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  UNIQUE(exchange, symbol, timeframe, timestamp)
);

-- Backtest runs
CREATE TABLE backtest_runs (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  config JSON NOT NULL,
  metrics JSON NOT NULL,
  equity JSON NOT NULL,
  created_at INTEGER NOT NULL
);

-- Trades
CREATE TABLE trades (
  id INTEGER PRIMARY KEY,
  backtest_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  amount REAL NOT NULL,
  pnl REAL,
  entry_time INTEGER NOT NULL,
  exit_time INTEGER,
  FOREIGN KEY (backtest_id) REFERENCES backtest_runs(id)
);

CREATE INDEX idx_candles_lookup ON candles(exchange, symbol, timeframe, timestamp);
CREATE INDEX idx_trades_backtest ON trades(backtest_id);
```

## API Endpoints

### Backtesting
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backtest/run` | Start a new backtest |
| GET | `/api/backtest/:id` | Get backtest result |
| GET | `/api/backtest/history` | List past runs |
| DELETE | `/api/backtest/:id` | Delete a run |

### Strategies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/strategies` | List available strategies |
| GET | `/api/strategies/:name` | Get strategy details |

### Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/candles` | Get candles (cached) |
| GET | `/api/symbols` | List symbols |
| GET | `/api/exchanges` | List exchanges |

## Performance Metrics

| Metric | Description |
|--------|-------------|
| Total Return | (Final - Initial) / Initial * 100 |
| CAGR | Compound Annual Growth Rate |
| Max Drawdown | Largest peak-to-trough decline |
| Sharpe Ratio | Risk-adjusted return |
| Sortino Ratio | Downside risk-adjusted return |
| Win Rate | Winning trades / Total trades |
| Profit Factor | Gross profit / Gross loss |
| Expectancy | Average profit per trade |

## Timeframes

Supported resolutions:
- `1m` - 1 minute
- `5m` - 5 minutes
- `15m` - 15 minutes
- `30m` - 30 minutes
- `1h` - 1 hour
- `4h` - 4 hours
- `1d` - 1 day
- `1w` - 1 week

## Future Extensions

### Phase 2: Multi-Asset
- Cross-asset correlation analysis
- Portfolio-level strategies
- BTC/ETH beta calculations

### Phase 3: Advanced Analysis
- Walk-forward optimization
- Monte Carlo simulation
- Rolling correlations

### Phase 4: Live Trading
- Real exchange connectors
- Paper trading mode
- WebSocket feeds
