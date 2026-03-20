-- Add connector_type to paper_sessions
-- Tracks which trading connector backend was used for the session.
-- Defaults to 'paper' for backward compatibility with existing sessions.
ALTER TABLE paper_sessions
  ADD COLUMN IF NOT EXISTS connector_type TEXT NOT NULL DEFAULT 'paper';
