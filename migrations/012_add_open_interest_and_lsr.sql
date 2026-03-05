-- Open Interest
CREATE TABLE IF NOT EXISTS open_interest (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  open_interest_amount DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (exchange, symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_open_interest_lookup
  ON open_interest (exchange, symbol, timestamp);

-- Long/Short Ratio
CREATE TABLE IF NOT EXISTS long_short_ratio (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  long_ratio DOUBLE PRECISION NOT NULL,
  short_ratio DOUBLE PRECISION NOT NULL,
  long_short_ratio DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (exchange, symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_long_short_ratio_lookup
  ON long_short_ratio (exchange, symbol, timestamp);

-- Record this migration as applied
INSERT INTO _migrations (name) VALUES ('012_add_open_interest_and_lsr')
  ON CONFLICT (name) DO NOTHING;
