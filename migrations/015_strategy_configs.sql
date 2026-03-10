-- Migration: 015_strategy_configs
-- Purpose: Introduce strategy_configs as a deduplicated, referenceable entity.
-- Each unique (strategy_name, symbol, timeframe, params) combination gets one row.
-- backtest_runs, paper_sessions, optimized_params, and aggregation_configs all
-- gain a strategy_config_id FK so the UI can group and navigate by config.
--
-- Idempotent: every DDL uses IF NOT EXISTS / IF EXISTS / ON CONFLICT guards.
-- NOT wrapped in a transaction by design — each statement runs independently
-- so a partial failure leaves the schema in a known, inspectable state.

-- ---------------------------------------------------------------------------
-- 1. Enable pgcrypto for gen_random_uuid() and digest()
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. New table: strategy_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_configs (
  id            TEXT    PRIMARY KEY,
  strategy_name TEXT    NOT NULL,
  symbol        TEXT    NOT NULL,
  timeframe     TEXT    NOT NULL,
  params        JSONB   NOT NULL DEFAULT '{}',
  content_hash  TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  user_id       TEXT    REFERENCES users(id) ON DELETE SET NULL,
  created_at    BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_content_hash
  ON strategy_configs (content_hash);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_strategy_name
  ON strategy_configs (strategy_name);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_symbol
  ON strategy_configs (symbol);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_strategy_symbol_timeframe
  ON strategy_configs (strategy_name, symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_strategy_configs_user_id
  ON strategy_configs (user_id);

-- ---------------------------------------------------------------------------
-- 3. Modify backtest_runs
-- ---------------------------------------------------------------------------
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS strategy_config_id TEXT REFERENCES strategy_configs(id) ON DELETE SET NULL;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS initial_capital NUMERIC;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS exchange TEXT;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS start_date BIGINT;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS end_date BIGINT;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_config_id
  ON backtest_runs (strategy_config_id);

-- ---------------------------------------------------------------------------
-- 4. Modify aggregation_configs
-- ---------------------------------------------------------------------------
ALTER TABLE aggregation_configs ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE aggregation_configs ADD COLUMN IF NOT EXISTS sub_strategy_config_ids TEXT[];

ALTER TABLE aggregation_configs DROP COLUMN IF EXISTS initial_capital;
ALTER TABLE aggregation_configs DROP COLUMN IF EXISTS exchange;

-- mode column is dropped in step 13 after backfilling

-- ---------------------------------------------------------------------------
-- 5. Modify paper_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE paper_sessions ADD COLUMN IF NOT EXISTS strategy_config_id TEXT REFERENCES strategy_configs(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 6. Modify optimized_params
-- ---------------------------------------------------------------------------
ALTER TABLE optimized_params ADD COLUMN IF NOT EXISTS strategy_config_id TEXT REFERENCES strategy_configs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_optimized_params_strategy_config_id
  ON optimized_params (strategy_config_id);

-- ---------------------------------------------------------------------------
-- 7. Backfill strategy_configs from single-asset backtest_runs
--    (aggregation_id IS NULL, symbol != 'MULTI')
-- ---------------------------------------------------------------------------
INSERT INTO strategy_configs (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
SELECT
  gen_random_uuid()::TEXT                                                   AS id,
  (config->>'strategyName')                                                 AS strategy_name,
  (config->>'symbol')                                                        AS symbol,
  COALESCE(config->>'timeframe', '1h')                                      AS timeframe,
  COALESCE(config->'params', '{}')                                          AS params,
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(config->'params', '{}'),
        'strategy_name',   (config->>'strategyName'),
        'symbol',          (config->>'symbol'),
        'timeframe',       COALESCE(config->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  )                                                                          AS content_hash,
  (config->>'strategyName') || ' / ' || (config->>'symbol') || ' / ' || COALESCE(config->>'timeframe', '1h') AS name,
  user_id                                                                    AS user_id,
  MIN(created_at)                                                            AS created_at
FROM backtest_runs
WHERE aggregation_id IS NULL
  AND config->>'symbol' != 'MULTI'
  AND config->>'strategyName' IS NOT NULL
GROUP BY
  (config->>'strategyName'),
  (config->>'symbol'),
  COALESCE(config->>'timeframe', '1h'),
  COALESCE(config->'params', '{}'),
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(config->'params', '{}'),
        'strategy_name',   (config->>'strategyName'),
        'symbol',          (config->>'symbol'),
        'timeframe',       COALESCE(config->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  ),
  user_id
ON CONFLICT (content_hash) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Backfill strategy_configs from aggregation_configs.sub_strategies
--    Each element in the sub_strategies JSONB array becomes a strategy_config.
-- ---------------------------------------------------------------------------
INSERT INTO strategy_configs (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
SELECT DISTINCT ON (content_hash)
  gen_random_uuid()::TEXT                                                    AS id,
  (sub->>'strategyName')                                                     AS strategy_name,
  (sub->>'symbol')                                                            AS symbol,
  COALESCE(sub->>'timeframe', '1h')                                         AS timeframe,
  COALESCE(sub->'params', '{}')                                             AS params,
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(sub->'params', '{}'),
        'strategy_name',   (sub->>'strategyName'),
        'symbol',          (sub->>'symbol'),
        'timeframe',       COALESCE(sub->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  )                                                                          AS content_hash,
  (sub->>'strategyName') || ' / ' || (sub->>'symbol') || ' / ' || COALESCE(sub->>'timeframe', '1h') AS name,
  ac.user_id                                                                 AS user_id,
  ac.created_at                                                              AS created_at
FROM aggregation_configs ac,
     jsonb_array_elements(ac.sub_strategies) AS sub
WHERE (sub->>'strategyName') IS NOT NULL
  AND (sub->>'symbol') IS NOT NULL
ORDER BY content_hash, ac.created_at
ON CONFLICT (content_hash) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Backfill strategy_configs from MULTI backtest_runs
--    Sub-strategies may live at config->'subStrategies' OR
--    config->'params'->'subStrategies'.
-- ---------------------------------------------------------------------------

-- Path 1: config->'subStrategies'
INSERT INTO strategy_configs (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
SELECT DISTINCT ON (content_hash)
  gen_random_uuid()::TEXT                                                    AS id,
  (sub->>'strategyName')                                                     AS strategy_name,
  (sub->>'symbol')                                                            AS symbol,
  COALESCE(sub->>'timeframe', '1h')                                         AS timeframe,
  COALESCE(sub->'params', '{}')                                             AS params,
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(sub->'params', '{}'),
        'strategy_name',   (sub->>'strategyName'),
        'symbol',          (sub->>'symbol'),
        'timeframe',       COALESCE(sub->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  )                                                                          AS content_hash,
  (sub->>'strategyName') || ' / ' || (sub->>'symbol') || ' / ' || COALESCE(sub->>'timeframe', '1h') AS name,
  br.user_id                                                                 AS user_id,
  br.created_at                                                              AS created_at
FROM backtest_runs br,
     jsonb_array_elements(br.config->'subStrategies') AS sub
WHERE br.config->'subStrategies' IS NOT NULL
  AND jsonb_typeof(br.config->'subStrategies') = 'array'
  AND (sub->>'strategyName') IS NOT NULL
  AND (sub->>'symbol') IS NOT NULL
ORDER BY content_hash, br.created_at
ON CONFLICT (content_hash) DO NOTHING;

-- Path 2: config->'params'->'subStrategies'
INSERT INTO strategy_configs (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
SELECT DISTINCT ON (content_hash)
  gen_random_uuid()::TEXT                                                    AS id,
  (sub->>'strategyName')                                                     AS strategy_name,
  (sub->>'symbol')                                                            AS symbol,
  COALESCE(sub->>'timeframe', '1h')                                         AS timeframe,
  COALESCE(sub->'params', '{}')                                             AS params,
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(sub->'params', '{}'),
        'strategy_name',   (sub->>'strategyName'),
        'symbol',          (sub->>'symbol'),
        'timeframe',       COALESCE(sub->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  )                                                                          AS content_hash,
  (sub->>'strategyName') || ' / ' || (sub->>'symbol') || ' / ' || COALESCE(sub->>'timeframe', '1h') AS name,
  br.user_id                                                                 AS user_id,
  br.created_at                                                              AS created_at
FROM backtest_runs br,
     jsonb_array_elements(br.config->'params'->'subStrategies') AS sub
WHERE br.config->'params'->'subStrategies' IS NOT NULL
  AND jsonb_typeof(br.config->'params'->'subStrategies') = 'array'
  AND (sub->>'strategyName') IS NOT NULL
  AND (sub->>'symbol') IS NOT NULL
ORDER BY content_hash, br.created_at
ON CONFLICT (content_hash) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. Link backtest_runs to strategy_configs
--     Also populate the denormalized scalar columns from config JSONB.
-- ---------------------------------------------------------------------------

-- Link single-asset runs
UPDATE backtest_runs br
SET strategy_config_id = sc.id
FROM strategy_configs sc
WHERE br.aggregation_id IS NULL
  AND br.config->>'symbol' != 'MULTI'
  AND br.strategy_config_id IS NULL
  AND sc.content_hash = encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(br.config->'params', '{}'),
        'strategy_name',   (br.config->>'strategyName'),
        'symbol',          (br.config->>'symbol'),
        'timeframe',       COALESCE(br.config->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  );

-- Populate scalar columns from config JSONB for all runs
UPDATE backtest_runs
SET
  initial_capital = (config->>'initialCapital')::NUMERIC,
  exchange        = config->>'exchange',
  start_date      = (config->>'startDate')::BIGINT,
  end_date        = (config->>'endDate')::BIGINT
WHERE initial_capital IS NULL
  AND config->>'initialCapital' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 11. Link aggregation_configs to strategy_configs
--     Build sub_strategy_config_ids array and content_hash for each aggregation.
-- ---------------------------------------------------------------------------

-- Populate sub_strategy_config_ids
UPDATE aggregation_configs ac
SET sub_strategy_config_ids = (
  SELECT array_agg(sc.id ORDER BY sc.strategy_name, sc.symbol, sc.timeframe)
  FROM jsonb_array_elements(ac.sub_strategies) AS sub
  JOIN strategy_configs sc ON sc.content_hash = encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(sub->'params', '{}'),
        'strategy_name',   (sub->>'strategyName'),
        'symbol',          (sub->>'symbol'),
        'timeframe',       COALESCE(sub->>'timeframe', '1h')
      )::TEXT,
      'sha256'
    ),
    'hex'
  )
)
WHERE sub_strategy_config_ids IS NULL;

-- Populate content_hash for aggregation_configs
-- Hash is built from the sorted sub_strategy_config_ids array
UPDATE aggregation_configs ac
SET content_hash = encode(
  digest(
    (
      SELECT array_to_string(
        array_agg(sc_id ORDER BY sc_id),
        ','
      )
      FROM unnest(ac.sub_strategy_config_ids) AS sc_id
    ),
    'sha256'
  ),
  'hex'
)
WHERE content_hash IS NULL
  AND sub_strategy_config_ids IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 12. Link optimized_params to strategy_configs
--     Match by strategy_name, symbol, timeframe, params.
-- ---------------------------------------------------------------------------
UPDATE optimized_params op
SET strategy_config_id = sc.id
FROM strategy_configs sc
WHERE op.strategy_config_id IS NULL
  AND sc.strategy_name = op.strategy_name
  AND sc.symbol        = op.symbol
  AND sc.timeframe     = op.timeframe
  AND sc.params        = op.params;

-- ---------------------------------------------------------------------------
-- 13. Remove mode column from aggregation_configs
-- ---------------------------------------------------------------------------
ALTER TABLE aggregation_configs DROP COLUMN IF EXISTS mode;

-- ---------------------------------------------------------------------------
-- 14. Record migration
-- ---------------------------------------------------------------------------
INSERT INTO _migrations (name) VALUES ('015_strategy_configs.sql')
  ON CONFLICT (name) DO NOTHING;
