ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS rolling_metrics JSONB;
