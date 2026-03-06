-- Add stop_loss and take_profit columns to paper_positions
ALTER TABLE paper_positions
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC,
  ADD COLUMN IF NOT EXISTS take_profit NUMERIC;
