-- Migration: 003_add_funding_income_to_trades
-- Adds funding_income column to trades_v2 for per-trade funding tracking

ALTER TABLE trades_v2 ADD COLUMN IF NOT EXISTS funding_income DOUBLE PRECISION;

-- Record this migration as applied
INSERT INTO _migrations (name) VALUES ('003_add_funding_income_to_trades')
  ON CONFLICT (name) DO NOTHING;
