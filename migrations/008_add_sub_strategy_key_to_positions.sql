-- Add sub_strategy_key column to paper_positions to disambiguate positions
-- when two sub-strategies trade the same symbol (e.g. different timeframes).
-- The key format is: "strategyName:symbol:timeframe"
ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS sub_strategy_key TEXT NOT NULL DEFAULT '';

-- Drop the old UNIQUE constraint on (session_id, symbol, direction)
-- and replace it with one on (session_id, sub_strategy_key, direction).
-- This allows two sub-strategies on the same symbol to each hold a position.
ALTER TABLE paper_positions DROP CONSTRAINT IF EXISTS paper_positions_session_id_symbol_direction_key;

ALTER TABLE paper_positions
  ADD CONSTRAINT paper_positions_session_id_sub_strategy_key_direction_key
  UNIQUE (session_id, sub_strategy_key, direction);
