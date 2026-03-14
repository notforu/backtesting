/**
 * Strategy Config CRUD Service
 *
 * Provides find-or-create deduplication, listing with stats, and
 * cascading deletion for strategy_configs rows.
 */

import { getPool } from './db.js';
import { computeStrategyConfigHash } from '../utils/content-hash.js';
import { loadStrategy } from '../strategy/loader.js';
import { getDefaultParams } from '../strategy/base.js';

// ============================================================================
// Types
// ============================================================================

export interface StrategyConfigRecord {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
  contentHash: string;
  name: string;
  userId?: string;
  createdAt: number;
}

export interface StrategyConfigListItem extends StrategyConfigRecord {
  runCount: number;
  paperSessionCount: number;
  latestRunAt?: number;
  latestRunSharpe?: number;
  latestRunReturn?: number;
}

// ============================================================================
// Internal row type
// ============================================================================

interface StrategyConfigRow {
  id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown> | string;
  content_hash: string;
  name: string;
  user_id: string | null;
  created_at: string | number;
}

interface StrategyConfigListRow extends StrategyConfigRow {
  run_count: string | number;
  paper_session_count: string | number;
  latest_run_at: string | number | null;
  latest_run_sharpe: string | number | null;
  latest_run_return: string | number | null;
}

// ============================================================================
// Helpers
// ============================================================================

function rowToRecord(row: StrategyConfigRow): StrategyConfigRecord {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    timeframe: row.timeframe,
    params: (typeof row.params === 'string'
      ? JSON.parse(row.params)
      : row.params) as Record<string, unknown>,
    contentHash: row.content_hash,
    name: row.name,
    userId: row.user_id ?? undefined,
    createdAt: Number(row.created_at),
  };
}

function rowToListItem(row: StrategyConfigListRow): StrategyConfigListItem {
  return {
    ...rowToRecord(row),
    runCount: Number(row.run_count),
    paperSessionCount: Number(row.paper_session_count),
    latestRunAt: row.latest_run_at != null ? Number(row.latest_run_at) : undefined,
    latestRunSharpe: row.latest_run_sharpe != null ? Number(row.latest_run_sharpe) : undefined,
    latestRunReturn: row.latest_run_return != null ? Number(row.latest_run_return) : undefined,
  };
}

/**
 * Format a timestamp (ms) as YYYY-MM-DD-HHmmss for use in auto-generated names.
 */
function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

// ============================================================================
// find-or-create
// ============================================================================

/**
 * Find an existing strategy config by content hash, or create a new one.
 * Returns the record and a boolean indicating whether it was just created.
 */
export async function findOrCreateStrategyConfig(config: {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
  userId?: string;
}): Promise<{ config: StrategyConfigRecord; created: boolean }> {
  const pool = getPool();

  // Fill in default params from the strategy definition when params is empty.
  // This ensures strategy configs always have complete parameter values.
  let finalParams = config.params;
  if (Object.keys(finalParams).length === 0) {
    try {
      const strategy = await loadStrategy(config.strategyName);
      finalParams = getDefaultParams(strategy);
    } catch {
      // Strategy not found
    }
    if (Object.keys(finalParams).length === 0) {
      throw new Error(
        `Cannot create strategy config for "${config.strategyName}" with empty params. ` +
        `Either provide params explicitly or ensure the strategy defines default parameters.`
      );
    }
  }

  const hash = computeStrategyConfigHash({
    strategyName: config.strategyName,
    symbol: config.symbol,
    timeframe: config.timeframe,
    params: finalParams,
  });

  // Try to find existing
  const existing = await pool.query<StrategyConfigRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at
     FROM strategy_configs
     WHERE content_hash = $1`,
    [hash]
  );

  if (existing.rows.length > 0) {
    return { config: rowToRecord(existing.rows[0]), created: false };
  }

  // Create new
  const id = crypto.randomUUID();
  const now = Date.now();
  const autoName =
    `${config.strategyName} / ${config.symbol} / ${config.timeframe} / ${formatTimestamp(now)}`;

  const inserted = await pool.query<StrategyConfigRow>(
    `INSERT INTO strategy_configs
       (id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (content_hash) DO UPDATE
       SET id = strategy_configs.id
     RETURNING id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at`,
    [
      id,
      config.strategyName,
      config.symbol,
      config.timeframe,
      JSON.stringify(finalParams),
      hash,
      autoName,
      config.userId ?? null,
      now,
    ]
  );

  const returned = inserted.rows[0];
  // If a concurrent insert won the race the ON CONFLICT clause returns the
  // existing row — detect this by comparing the returned id with what we tried
  // to insert.
  const wasCreated = returned.id === id;

  return { config: rowToRecord(returned), created: wasCreated };
}

// ============================================================================
// List
// ============================================================================

/**
 * List strategy configs with optional filters.
 * Includes aggregated stats: run count, paper session count, latest run metrics.
 */
export async function listStrategyConfigs(filters?: {
  strategyName?: string;
  symbol?: string;
  timeframe?: string;
  userId?: string;
}): Promise<StrategyConfigListItem[]> {
  const pool = getPool();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.strategyName) {
    params.push(filters.strategyName);
    conditions.push(`sc.strategy_name = $${params.length}`);
  }

  if (filters?.symbol) {
    params.push(filters.symbol);
    conditions.push(`sc.symbol = $${params.length}`);
  }

  if (filters?.timeframe) {
    params.push(filters.timeframe);
    conditions.push(`sc.timeframe = $${params.length}`);
  }

  if (filters?.userId) {
    params.push(filters.userId);
    conditions.push(`sc.user_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query<StrategyConfigListRow>(
    `SELECT
       sc.id,
       sc.strategy_name,
       sc.symbol,
       sc.timeframe,
       sc.params,
       sc.content_hash,
       sc.name,
       sc.user_id,
       sc.created_at,
       COUNT(DISTINCT br.id)::BIGINT                                       AS run_count,
       COUNT(DISTINCT ps.id)::BIGINT                                       AS paper_session_count,
       MAX(br.created_at)                                                  AS latest_run_at,
       (
         SELECT (br2.metrics->>'sharpeRatio')::FLOAT
         FROM backtest_runs br2
         WHERE br2.strategy_config_id = sc.id
         ORDER BY br2.created_at DESC
         LIMIT 1
       )                                                                   AS latest_run_sharpe,
       (
         SELECT (br3.metrics->>'totalReturnPercent')::FLOAT
         FROM backtest_runs br3
         WHERE br3.strategy_config_id = sc.id
         ORDER BY br3.created_at DESC
         LIMIT 1
       )                                                                   AS latest_run_return
     FROM strategy_configs sc
     LEFT JOIN backtest_runs br
            ON br.strategy_config_id = sc.id
     LEFT JOIN paper_sessions ps
            ON ps.strategy_config_id = sc.id
            OR ps.aggregation_config_id IN (
                 SELECT ac.id
                 FROM aggregation_configs ac
                 WHERE sc.id = ANY(ac.sub_strategy_config_ids)
               )
     ${whereClause}
     GROUP BY sc.id
     ORDER BY sc.created_at DESC`,
    params
  );

  return rows.map(rowToListItem);
}

// ============================================================================
// Get by ID
// ============================================================================

/**
 * Get a single strategy config by primary key.
 * Returns null when not found.
 */
export async function getStrategyConfig(id: string): Promise<StrategyConfigRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query<StrategyConfigRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at
     FROM strategy_configs
     WHERE id = $1`,
    [id]
  );
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

// ============================================================================
// Versions (same strategy+symbol+timeframe, different params)
// ============================================================================

/**
 * Return all configs for the same (strategy_name, symbol, timeframe) combination,
 * ordered oldest-first so callers can display a version history.
 */
export async function getStrategyConfigVersions(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<StrategyConfigRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query<StrategyConfigRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, content_hash, name, user_id, created_at
     FROM strategy_configs
     WHERE strategy_name = $1
       AND symbol        = $2
       AND timeframe     = $3
     ORDER BY created_at ASC`,
    [strategyName, symbol, timeframe]
  );
  return rows.map(rowToRecord);
}

// ============================================================================
// Deletion info
// ============================================================================

/**
 * Return counts of linked entities so the UI can show a confirmation dialog
 * before deleting a config.
 */
export async function getStrategyConfigDeletionInfo(id: string): Promise<{
  runCount: number;
  paperSessionCount: number;
  optimizationCount: number;
}> {
  const pool = getPool();

  const [runsResult, sessionsResult, optsResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::BIGINT AS count FROM backtest_runs WHERE strategy_config_id = $1`,
      [id]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::BIGINT AS count FROM paper_sessions WHERE strategy_config_id = $1`,
      [id]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::BIGINT AS count FROM optimized_params WHERE strategy_config_id = $1`,
      [id]
    ),
  ]);

  return {
    runCount: Number(runsResult.rows[0].count),
    paperSessionCount: Number(sessionsResult.rows[0].count),
    optimizationCount: Number(optsResult.rows[0].count),
  };
}

// ============================================================================
// Delete (cascade)
// ============================================================================

/**
 * Delete a strategy config and cascade the effects:
 * 1. Delete trades_v2 rows belonging to linked backtest_runs.
 * 2. Delete linked backtest_runs.
 * 3. Nullify strategy_config_id on paper_sessions (keep sessions).
 * 4. Nullify strategy_config_id on optimized_params (keep optimizations).
 * 5. Delete the strategy_config row itself.
 *
 * All steps run inside a single transaction.
 */
export async function deleteStrategyConfig(id: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Delete trades for all runs belonging to this config
    await client.query(
      `DELETE FROM trades_v2
       WHERE backtest_id IN (
         SELECT id FROM backtest_runs WHERE strategy_config_id = $1
       )`,
      [id]
    );

    // 2. Delete the runs themselves
    await client.query(
      `DELETE FROM backtest_runs WHERE strategy_config_id = $1`,
      [id]
    );

    // 3. Unlink paper sessions
    await client.query(
      `UPDATE paper_sessions SET strategy_config_id = NULL WHERE strategy_config_id = $1`,
      [id]
    );

    // 4. Unlink optimized_params
    await client.query(
      `UPDATE optimized_params SET strategy_config_id = NULL WHERE strategy_config_id = $1`,
      [id]
    );

    // 5. Delete the config itself
    await client.query(`DELETE FROM strategy_configs WHERE id = $1`, [id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
