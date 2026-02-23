-- Aggregation config definitions (saved, re-runnable)
CREATE TABLE IF NOT EXISTS aggregation_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  allocation_mode TEXT NOT NULL DEFAULT 'single_strongest',
  max_positions INTEGER NOT NULL DEFAULT 3,
  sub_strategies JSONB NOT NULL,
  initial_capital NUMERIC NOT NULL DEFAULT 10000,
  exchange TEXT NOT NULL DEFAULT 'bybit',
  mode TEXT NOT NULL DEFAULT 'futures',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Link aggregation runs to their config
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS aggregation_id TEXT REFERENCES aggregation_configs(id) ON DELETE SET NULL;
