-- Migration: 001_initial_schema
-- Converts SQLite schema to PostgreSQL
-- Changes:
--   INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
--   REAL -> DOUBLE PRECISION
--   JSON -> JSONB (better indexing and querying)
--   INTEGER booleans -> BOOLEAN
--   Timestamps remain INTEGER (Unix ms) for compatibility with existing code

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Candles cache
CREATE TABLE IF NOT EXISTS candles (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  UNIQUE (exchange, symbol, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup
  ON candles (exchange, symbol, timeframe, timestamp);

-- Backtest runs
CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  config JSONB NOT NULL,
  metrics JSONB NOT NULL,
  equity JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy
  ON backtest_runs (strategy_name);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at
  ON backtest_runs (created_at);

-- Legacy trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  backtest_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  pnl DOUBLE PRECISION NOT NULL,
  pnl_percent DOUBLE PRECISION NOT NULL,
  entry_time BIGINT NOT NULL,
  exit_time BIGINT NOT NULL,
  FOREIGN KEY (backtest_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trades_backtest_id
  ON trades (backtest_id);

-- New trades table with open/close model
CREATE TABLE IF NOT EXISTS trades_v2 (
  id TEXT PRIMARY KEY,
  backtest_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  timestamp BIGINT NOT NULL,
  pnl DOUBLE PRECISION,
  pnl_percent DOUBLE PRECISION,
  closed_position_id TEXT,
  balance_after DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION,
  fee_rate DOUBLE PRECISION,
  FOREIGN KEY (backtest_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trades_v2_backtest_id
  ON trades_v2 (backtest_id);

CREATE INDEX IF NOT EXISTS idx_trades_v2_timestamp
  ON trades_v2 (timestamp);

-- Optimization results (legacy)
CREATE TABLE IF NOT EXISTS optimization_results (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  best_params JSONB NOT NULL,
  best_metric_value DOUBLE PRECISION NOT NULL,
  metric_name TEXT NOT NULL,
  config JSONB NOT NULL,
  all_results JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (strategy_name, symbol)
);

CREATE INDEX IF NOT EXISTS idx_optimization_results_strategy
  ON optimization_results (strategy_name);

-- Optimized parameters
CREATE TABLE IF NOT EXISTS optimized_params (
  id TEXT PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  params JSONB NOT NULL,
  metrics JSONB NOT NULL,
  optimized_at BIGINT NOT NULL,
  config JSONB NOT NULL,
  total_combinations INTEGER NOT NULL,
  tested_combinations INTEGER NOT NULL,
  start_date BIGINT,
  end_date BIGINT
);

CREATE INDEX IF NOT EXISTS idx_optimized_params_strategy_symbol
  ON optimized_params (strategy_name, symbol, timeframe);

-- Polymarket markets
CREATE TABLE IF NOT EXISTS polymarket_markets (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  condition_id TEXT NOT NULL,
  clob_token_ids TEXT NOT NULL,
  end_date TEXT,
  category TEXT,
  liquidity TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  volume TEXT,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_polymarket_markets_active
  ON polymarket_markets (active, closed);

CREATE INDEX IF NOT EXISTS idx_polymarket_markets_category
  ON polymarket_markets (category);

-- Funding rates
CREATE TABLE IF NOT EXISTS funding_rates (
  id SERIAL PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  funding_rate DOUBLE PRECISION NOT NULL,
  mark_price DOUBLE PRECISION,
  UNIQUE (exchange, symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_funding_rates_lookup
  ON funding_rates (exchange, symbol, timestamp);

-- Record this migration as applied
INSERT INTO _migrations (name) VALUES ('001_initial_schema')
  ON CONFLICT (name) DO NOTHING;
