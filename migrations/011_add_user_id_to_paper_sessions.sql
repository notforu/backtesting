-- Add user_id to paper_sessions for ownership-based access control
ALTER TABLE paper_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
