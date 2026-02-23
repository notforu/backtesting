ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS per_asset_results JSONB;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS signal_history JSONB;
