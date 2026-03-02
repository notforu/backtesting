-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Add user_id to existing tables (nullable for backward compat)
ALTER TABLE paper_sessions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
ALTER TABLE aggregation_configs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);

-- Insert root user with placeholder hash (real hash set at startup via ensureRootUser)
INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
VALUES ('root', 'root', 'PLACEHOLDER', 'admin', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (id) DO NOTHING;

-- Backfill existing rows to root user
UPDATE paper_sessions SET user_id = 'root' WHERE user_id IS NULL;
UPDATE backtest_runs SET user_id = 'root' WHERE user_id IS NULL;
UPDATE aggregation_configs SET user_id = 'root' WHERE user_id IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_paper_sessions_user ON paper_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_user ON backtest_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_aggregation_configs_user ON aggregation_configs(user_id);
