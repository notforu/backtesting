-- Paper trading sessions (one session = one running aggregation config)
CREATE TABLE IF NOT EXISTS paper_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aggregation_config JSONB NOT NULL,           -- frozen snapshot at creation
  aggregation_config_id TEXT REFERENCES aggregation_configs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'stopped',       -- running, paused, stopped, error
  initial_capital NUMERIC NOT NULL DEFAULT 10000,
  current_equity NUMERIC NOT NULL DEFAULT 10000,
  current_cash NUMERIC NOT NULL DEFAULT 10000,
  tick_count INTEGER NOT NULL DEFAULT 0,
  last_tick_at BIGINT,
  next_tick_at BIGINT,
  error_message TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Open positions per paper trading session
CREATE TABLE IF NOT EXISTS paper_positions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,                      -- 'long' or 'short'
  entry_price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  entry_time BIGINT NOT NULL,
  unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  funding_accumulated NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(session_id, symbol, direction)
);

-- Closed trades history per paper trading session
CREATE TABLE IF NOT EXISTS paper_trades (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,                         -- 'open_long', 'open_short', 'close_long', 'close_short'
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  timestamp BIGINT NOT NULL,
  pnl NUMERIC,
  pnl_percent NUMERIC,
  fee NUMERIC NOT NULL DEFAULT 0,
  funding_income NUMERIC NOT NULL DEFAULT 0,
  balance_after NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_session_ts ON paper_trades(session_id, timestamp);

-- Equity curve snapshots for paper trading sessions
CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  timestamp BIGINT NOT NULL,
  equity NUMERIC NOT NULL,
  cash NUMERIC NOT NULL,
  positions_value NUMERIC NOT NULL,
  UNIQUE(session_id, timestamp)
);
