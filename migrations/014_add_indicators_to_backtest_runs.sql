-- Add indicators column to backtest_runs for persisting per-bar strategy indicator values
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS indicators JSONB;
