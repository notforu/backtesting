-- Migration: 002_add_funding_rate_to_trades
-- Adds funding_rate column to trades_v2 for futures mode tracking

ALTER TABLE trades_v2 ADD COLUMN IF NOT EXISTS funding_rate DOUBLE PRECISION;

-- Record this migration as applied
INSERT INTO _migrations (name) VALUES ('002_add_funding_rate_to_trades')
  ON CONFLICT (name) DO NOTHING;
