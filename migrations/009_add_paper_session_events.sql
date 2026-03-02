CREATE TABLE IF NOT EXISTS paper_session_events (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_session_events_session_ts
  ON paper_session_events(session_id, created_at DESC);
