-- Migration: 016_link_paper_sessions_to_configs
-- Purpose: Link all paper_sessions to their aggregation_configs.
--   1. For sessions whose sub_strategies match an existing aggregation_config, set the FK.
--   2. For sessions with no matching config, create a new aggregation_config from the
--      session's frozen JSONB snapshot, then link.
--   3. Populate sub_strategy_config_ids and content_hash for all aggregation_configs
--      that are missing them.
--
-- Idempotent: uses WHERE ... IS NULL guards and ON CONFLICT DO NOTHING.

-- ---------------------------------------------------------------------------
-- 1. Link paper_sessions to existing aggregation_configs by sub_strategies hash
-- ---------------------------------------------------------------------------
UPDATE paper_sessions ps
SET aggregation_config_id = ac.id
FROM aggregation_configs ac
WHERE ps.aggregation_config_id IS NULL
  AND ac.allocation_mode = ps.aggregation_config->>'allocationMode'
  AND ac.max_positions = (ps.aggregation_config->>'maxPositions')::int
  AND encode(digest(ac.sub_strategies::text::bytea, 'sha256'), 'hex')
    = encode(digest((ps.aggregation_config->'subStrategies')::text::bytea, 'sha256'), 'hex');

-- ---------------------------------------------------------------------------
-- 2. Create new aggregation_configs for sessions that still have no match
-- ---------------------------------------------------------------------------
INSERT INTO aggregation_configs
  (id, name, allocation_mode, max_positions, sub_strategies,
   initial_capital, exchange, mode, created_at, updated_at, user_id)
SELECT
  gen_random_uuid()::text,
  ps.name,
  ps.aggregation_config->>'allocationMode',
  (ps.aggregation_config->>'maxPositions')::int,
  ps.aggregation_config->'subStrategies',
  COALESCE((ps.aggregation_config->>'initialCapital')::numeric, ps.initial_capital),
  COALESCE(ps.aggregation_config->>'exchange', 'bybit'),
  COALESCE(ps.aggregation_config->>'mode', 'backtest'),
  ps.created_at,
  ps.created_at,
  ps.user_id
FROM paper_sessions ps
WHERE ps.aggregation_config_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Link those newly-created aggregation_configs to their sessions
-- ---------------------------------------------------------------------------
UPDATE paper_sessions ps
SET aggregation_config_id = ac.id
FROM aggregation_configs ac
WHERE ps.aggregation_config_id IS NULL
  AND ac.allocation_mode = ps.aggregation_config->>'allocationMode'
  AND ac.max_positions = (ps.aggregation_config->>'maxPositions')::int
  AND encode(digest(ac.sub_strategies::text::bytea, 'sha256'), 'hex')
    = encode(digest((ps.aggregation_config->'subStrategies')::text::bytea, 'sha256'), 'hex');

-- ---------------------------------------------------------------------------
-- 4. Ensure strategy_configs exist for all aggregation_config sub-strategies
-- ---------------------------------------------------------------------------
INSERT INTO strategy_configs (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
SELECT DISTINCT ON (content_hash)
  gen_random_uuid()::text                                                    AS id,
  (sub->>'strategyName')                                                     AS strategy_name,
  (sub->>'symbol')                                                           AS symbol,
  COALESCE(sub->>'timeframe', '1h')                                         AS timeframe,
  COALESCE(sub->'params', '{}')                                             AS params,
  encode(
    digest(
      jsonb_build_object(
        'params',          COALESCE(sub->'params', '{}'),
        'strategy_name',   (sub->>'strategyName'),
        'symbol',          (sub->>'symbol'),
        'timeframe',       COALESCE(sub->>'timeframe', '1h')
      )::TEXT::bytea,
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
-- 5. Populate sub_strategy_config_ids for all aggregation_configs missing them
-- ---------------------------------------------------------------------------
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
      )::TEXT::bytea,
      'sha256'
    ),
    'hex'
  )
)
WHERE sub_strategy_config_ids IS NULL
   OR array_length(sub_strategy_config_ids, 1) IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Populate content_hash for aggregation_configs missing it
-- ---------------------------------------------------------------------------
UPDATE aggregation_configs ac
SET content_hash = encode(
  digest(
    (
      SELECT array_to_string(
        array_agg(sc_id ORDER BY sc_id),
        ','
      )
      FROM unnest(ac.sub_strategy_config_ids) AS sc_id
    )::bytea,
    'sha256'
  ),
  'hex'
)
WHERE content_hash IS NULL
  AND sub_strategy_config_ids IS NOT NULL
  AND array_length(sub_strategy_config_ids, 1) > 0;
