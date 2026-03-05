/**
 * PostgreSQL database connection and operations
 * Uses node-postgres (pg) with a connection pool for async, non-blocking access
 */

import fs from 'fs';
import path from 'path';
import * as pg from 'pg';
import type {
  Candle,
  Timeframe,
  BacktestResult,
  Trade,
  BacktestConfig,
  PerformanceMetrics,
  EquityPoint,
  TradeAction,
  FundingRate,
  RollingMetrics,
} from '../core/types.js';

const { Pool } = pg;

// Connection string - override with DATABASE_URL env var
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://backtesting:backtesting@localhost:5432/backtesting';

// ============================================================================
// Connection Management
// ============================================================================

let pool: pg.Pool | null = null;

/**
 * Get or create the shared connection pool
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }
  return pool;
}

/**
 * Initialize the database by running pending migrations
 */
export async function initDb(): Promise<void> {
  const p = getPool();
  await runMigrations(p);
}

/**
 * Close the database connection pool
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ============================================================================
// Migration Runner
// ============================================================================

async function runMigrations(p: pg.Pool): Promise<void> {
  // Ensure _migrations table exists
  await p.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Read migration files from the migrations/ directory
  const migrationsDir = path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Check if already applied
    const { rows } = await p.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length > 0) {
      continue;
    }

    // Apply migration in a transaction
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [file]);
      await client.query('COMMIT');
      console.log(`Applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ============================================================================
// Candle Operations
// ============================================================================

interface CandleRow {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Save candles to the database.
 * Uses INSERT ... ON CONFLICT DO UPDATE to handle duplicates.
 * Returns the number of rows upserted.
 */
export async function saveCandles(
  candles: Candle[],
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): Promise<number> {
  if (candles.length === 0) {
    return 0;
  }

  const p = getPool();
  const client = await p.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const candle of candles) {
      const result = await client.query(
        `INSERT INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (exchange, symbol, timeframe, timestamp)
         DO UPDATE SET open = $5, high = $6, low = $7, close = $8, volume = $9`,
        [
          exchange,
          symbol,
          timeframe,
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        ]
      );
      count += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return count;
}

/**
 * Bulk insert candles for high-performance caching.
 * Uses multi-row INSERT with batches of 1000 for ~5x speedup over single-row inserts.
 * ON CONFLICT DO NOTHING (skips duplicates).
 */
export async function saveCandlesBulk(
  candles: Candle[],
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): Promise<number> {
  if (candles.length === 0) return 0;

  const p = getPool();
  const client = await p.connect();
  const BATCH_SIZE = 1000;
  let totalInserted = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
      const batch = candles.slice(i, i + BATCH_SIZE);

      // Build multi-row VALUES clause: ($1,$2,$3,$4,$5,$6,$7,$8,$9), ($10,$11,...)
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        const offset = j * 9;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
        );
        values.push(exchange, symbol, timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.volume);
      }

      const result = await client.query(
        `INSERT INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (exchange, symbol, timeframe, timestamp) DO NOTHING`,
        values
      );
      totalInserted += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return totalInserted;
}

/**
 * Get candles from the database
 */
export async function getCandles(
  exchange: string,
  symbol: string,
  timeframe: Timeframe,
  start: number,
  end: number
): Promise<Candle[]> {
  const p = getPool();
  const { rows } = await p.query<CandleRow>(
    `SELECT timestamp, open, high, low, close, volume
     FROM candles
     WHERE exchange = $1 AND symbol = $2 AND timeframe = $3
       AND timestamp >= $4 AND timestamp <= $5
     ORDER BY timestamp ASC`,
    [exchange, symbol, timeframe, start, end]
  );

  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

/**
 * Get the date range of cached candles
 */
export async function getCandleDateRange(
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): Promise<{ start: number | null; end: number | null }> {
  const p = getPool();
  const { rows } = await p.query<{ min_ts: string | null; max_ts: string | null }>(
    `SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
     FROM candles
     WHERE exchange = $1 AND symbol = $2 AND timeframe = $3`,
    [exchange, symbol, timeframe]
  );

  const row = rows[0];
  return {
    start: row?.min_ts != null ? Number(row.min_ts) : null,
    end: row?.max_ts != null ? Number(row.max_ts) : null,
  };
}

/**
 * Delete candles from the database
 */
export async function deleteCandles(
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): Promise<number> {
  const p = getPool();
  const result = await p.query(
    'DELETE FROM candles WHERE exchange = $1 AND symbol = $2 AND timeframe = $3',
    [exchange, symbol, timeframe]
  );
  return result.rowCount ?? 0;
}

// ============================================================================
// Backtest Run Operations
// ============================================================================

interface BacktestRunRow {
  id: string;
  strategy_name: string;
  config: BacktestConfig | string;
  metrics: PerformanceMetrics | string;
  equity: EquityPoint[] | string;
  rolling_metrics?: RollingMetrics | string | null;
  created_at: string | number;
  per_asset_results?: Record<string, unknown> | null;
  signal_history?: unknown[] | null;
  aggregation_id?: string | null;
  aggregation_name?: string | null;
}

/**
 * Save a backtest run to the database (using new trades_v2 schema)
 */
export async function saveBacktestRun(result: BacktestResult, aggregationId?: string): Promise<void> {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    // Insert the run
    await client.query(
      `INSERT INTO backtest_runs (id, strategy_name, config, metrics, equity, rolling_metrics, created_at, per_asset_results, signal_history, aggregation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        result.id,
        result.config.strategyName,
        JSON.stringify(result.config),
        JSON.stringify(result.metrics),
        JSON.stringify(result.equity),
        result.rollingMetrics != null ? JSON.stringify(result.rollingMetrics) : null,
        result.createdAt,
        (result as any).perAssetResults != null ? JSON.stringify((result as any).perAssetResults) : null,
        (result as any).signalHistory != null ? JSON.stringify((result as any).signalHistory) : null,
        aggregationId ?? null,
      ]
    );

    // Insert all trades
    for (const trade of result.trades) {
      await client.query(
        `INSERT INTO trades_v2
         (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
          closed_position_id, balance_after, fee, fee_rate, funding_rate, funding_income)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          trade.id,
          result.id,
          trade.symbol,
          trade.action,
          trade.price,
          trade.amount,
          trade.timestamp,
          trade.pnl ?? null,
          trade.pnlPercent ?? null,
          trade.closedPositionId ?? null,
          trade.balanceAfter,
          trade.fee ?? null,
          trade.feeRate ?? null,
          trade.fundingRate ?? null,
          trade.fundingIncome ?? null,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get a backtest run by ID
 */
export async function getBacktestRun(id: string): Promise<BacktestResult | null> {
  const p = getPool();
  const { rows } = await p.query<BacktestRunRow>(
    `SELECT id, strategy_name, config, metrics, equity, rolling_metrics, created_at, per_asset_results, signal_history, aggregation_id
     FROM backtest_runs
     WHERE id = $1`,
    [id]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const trades = await getTrades(id);

  const backtest: BacktestResult = {
    id: row.id,
    config: (typeof row.config === 'string'
      ? JSON.parse(row.config)
      : row.config) as BacktestConfig,
    metrics: (typeof row.metrics === 'string'
      ? JSON.parse(row.metrics)
      : row.metrics) as PerformanceMetrics,
    equity: (typeof row.equity === 'string'
      ? JSON.parse(row.equity)
      : row.equity) as EquityPoint[],
    rollingMetrics: row.rolling_metrics
      ? (typeof row.rolling_metrics === 'string'
        ? JSON.parse(row.rolling_metrics)
        : row.rolling_metrics) as RollingMetrics
      : undefined,
    trades,
    createdAt: Number(row.created_at),
  };

  // Add aggregate-specific fields if they exist (PG returns parsed JSONB directly)
  if (row.per_asset_results != null) {
    (backtest as any).perAssetResults = row.per_asset_results;
  }
  if (row.signal_history != null) {
    (backtest as any).signalHistory = row.signal_history;
  }
  if (row.aggregation_id != null) {
    (backtest as any).aggregationId = row.aggregation_id;
  }

  return backtest;
}

/**
 * BacktestSummary type for efficient history listing
 * Contains only essential fields without trades and equity arrays
 */
export interface BacktestSummary {
  id: string;
  config: {
    strategyName: string;
    symbol: string;
    timeframe: string;
    exchange?: string;
    startDate?: number;
    endDate?: number;
    params?: Record<string, unknown>;
    mode?: string;
  };
  metrics: {
    totalReturnPercent: number;
    sharpeRatio: number;
    maxDrawdownPercent?: number;
    winRate?: number;
    profitFactor?: number;
    totalTrades?: number;
    totalFees?: number;
  };
  createdAt: number;
  aggregationId?: string;
  aggregationName?: string;
}

/**
 * Filters for querying backtest history
 */
export interface HistoryFilters {
  strategy?: string;
  symbol?: string;
  timeframe?: string;
  exchange?: string;
  mode?: string;
  fromDate?: number;
  toDate?: number;
  minSharpe?: number;
  maxSharpe?: number;
  minReturn?: number;
  maxReturn?: number;
  sortBy?: 'runAt' | 'sharpeRatio' | 'totalReturnPercent' | 'maxDrawdownPercent' | 'winRate' | 'totalTrades';
  sortDir?: 'asc' | 'desc';
  runType?: 'strategies' | 'aggregations';
}

/**
 * Get backtest summaries (optimized for history list)
 * Only loads essential fields without trades and equity arrays.
 * Supports rich filtering and sorting via optional filters parameter.
 */
export async function getBacktestSummaries(
  limit: number = 10,
  offset: number = 0,
  filters: HistoryFilters = {}
): Promise<{ summaries: BacktestSummary[]; total: number }> {
  const p = getPool();

  // Build WHERE conditions dynamically using parameterized values
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.strategy) {
    params.push(filters.strategy);
    conditions.push(`br.strategy_name = $${params.length}`);
  }

  if (filters.symbol) {
    params.push(filters.symbol);
    conditions.push(`br.config->>'symbol' = $${params.length}`);
  }

  if (filters.timeframe) {
    params.push(filters.timeframe);
    conditions.push(`br.config->>'timeframe' = $${params.length}`);
  }

  if (filters.exchange) {
    params.push(filters.exchange);
    conditions.push(`br.config->>'exchange' = $${params.length}`);
  }

  if (filters.mode) {
    params.push(filters.mode);
    conditions.push(`br.config->>'mode' = $${params.length}`);
  }

  if (filters.fromDate !== undefined) {
    params.push(filters.fromDate);
    conditions.push(`br.created_at >= $${params.length}`);
  }

  if (filters.toDate !== undefined) {
    params.push(filters.toDate);
    conditions.push(`br.created_at <= $${params.length}`);
  }

  if (filters.minSharpe !== undefined) {
    params.push(filters.minSharpe);
    conditions.push(`(br.metrics->>'sharpeRatio')::float >= $${params.length}`);
  }

  if (filters.maxSharpe !== undefined) {
    params.push(filters.maxSharpe);
    conditions.push(`(br.metrics->>'sharpeRatio')::float <= $${params.length}`);
  }

  if (filters.minReturn !== undefined) {
    params.push(filters.minReturn);
    conditions.push(`(br.metrics->>'totalReturnPercent')::float >= $${params.length}`);
  }

  if (filters.maxReturn !== undefined) {
    params.push(filters.maxReturn);
    conditions.push(`(br.metrics->>'totalReturnPercent')::float <= $${params.length}`);
  }

  if (filters.runType === 'strategies') {
    conditions.push(`br.aggregation_id IS NULL AND br.config->>'symbol' != 'MULTI'`);
  } else if (filters.runType === 'aggregations') {
    conditions.push(`(br.aggregation_id IS NOT NULL OR br.config->>'symbol' = 'MULTI')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Determine ORDER BY clause - whitelist allowed columns to prevent injection
  const sortByMap: Record<string, string> = {
    runAt: 'br.created_at',
    sharpeRatio: "(br.metrics->>'sharpeRatio')::float",
    totalReturnPercent: "(br.metrics->>'totalReturnPercent')::float",
    maxDrawdownPercent: "(br.metrics->>'maxDrawdownPercent')::float",
    winRate: "(br.metrics->>'winRate')::float",
    totalTrades: "(br.metrics->>'totalTrades')::float",
  };

  const sortColumn = (filters.sortBy && sortByMap[filters.sortBy]) || 'br.created_at';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  const orderClause = `ORDER BY ${sortColumn} ${sortDir}`;

  // Count query (uses same WHERE but no LIMIT/OFFSET)
  const countResult = await p.query<{ count: string }>(
    `SELECT COUNT(*) FROM backtest_runs br
     LEFT JOIN aggregation_configs ac ON br.aggregation_id = ac.id
     ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0].count);

  // Data query - add LIMIT/OFFSET as additional params
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const { rows } = await p.query<BacktestRunRow>(
    `SELECT br.id, br.config, br.metrics, br.created_at,
            br.aggregation_id, ac.name AS aggregation_name
     FROM backtest_runs br
     LEFT JOIN aggregation_configs ac ON br.aggregation_id = ac.id
     ${whereClause}
     ${orderClause}
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...params, limit, offset]
  );

  const summaries = rows.map((row) => {
    const fullConfig = (typeof row.config === 'string'
      ? JSON.parse(row.config)
      : row.config) as BacktestConfig & { exchange?: string; mode?: string; params?: Record<string, unknown> };
    const fullMetrics = (typeof row.metrics === 'string'
      ? JSON.parse(row.metrics)
      : row.metrics) as PerformanceMetrics;

    const summary: BacktestSummary = {
      id: row.id,
      config: {
        strategyName: fullConfig.strategyName,
        symbol: fullConfig.symbol,
        timeframe: fullConfig.timeframe,
        exchange: fullConfig.exchange,
        startDate: typeof fullConfig.startDate === 'number' ? fullConfig.startDate : undefined,
        endDate: typeof fullConfig.endDate === 'number' ? fullConfig.endDate : undefined,
        params: fullConfig.params,
        mode: fullConfig.mode,
      },
      metrics: {
        totalReturnPercent: fullMetrics.totalReturnPercent,
        sharpeRatio: fullMetrics.sharpeRatio,
        maxDrawdownPercent: fullMetrics.maxDrawdownPercent,
        winRate: fullMetrics.winRate,
        profitFactor: fullMetrics.profitFactor,
        totalTrades: fullMetrics.totalTrades,
        totalFees: fullMetrics.totalFees,
      },
      createdAt: Number(row.created_at),
    };

    if (row.aggregation_id) {
      summary.aggregationId = row.aggregation_id;
    }
    if (row.aggregation_name) {
      summary.aggregationName = row.aggregation_name;
    }

    return summary;
  });

  return { summaries, total };
}

/**
 * Get backtest runs grouped by symbol with aggregate stats.
 * Used for the "Group by Asset" view in the explorer.
 */
export interface BacktestGroup {
  symbol: string;
  count: number;
  bestSharpe: number;
  bestReturn: number;
  timeframes: string[];
}

export async function getBacktestGroups(
  filters: HistoryFilters = {}
): Promise<BacktestGroup[]> {
  const p = getPool();

  // Build WHERE conditions (reuse same filter logic)
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.strategy) {
    params.push(filters.strategy);
    conditions.push(`strategy_name = $${params.length}`);
  }
  if (filters.timeframe) {
    params.push(filters.timeframe);
    conditions.push(`config->>'timeframe' = $${params.length}`);
  }
  if (filters.exchange) {
    params.push(filters.exchange);
    conditions.push(`config->>'exchange' = $${params.length}`);
  }
  if (filters.mode) {
    params.push(filters.mode);
    conditions.push(`config->>'mode' = $${params.length}`);
  }
  if (filters.minSharpe !== undefined) {
    params.push(filters.minSharpe);
    conditions.push(`(metrics->>'sharpeRatio')::float >= $${params.length}`);
  }
  if (filters.minReturn !== undefined) {
    params.push(filters.minReturn);
    conditions.push(`(metrics->>'totalReturnPercent')::float >= $${params.length}`);
  }
  if (filters.runType === 'strategies') {
    conditions.push(`aggregation_id IS NULL AND config->>'symbol' != 'MULTI'`);
  } else if (filters.runType === 'aggregations') {
    conditions.push(`(aggregation_id IS NOT NULL OR config->>'symbol' = 'MULTI')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await p.query<{
    symbol: string;
    count: string;
    best_sharpe: number;
    best_return: number;
    timeframes: string[];
  }>(
    `SELECT
       config->>'symbol' AS symbol,
       COUNT(*) AS count,
       MAX((metrics->>'sharpeRatio')::float) AS best_sharpe,
       MAX((metrics->>'totalReturnPercent')::float) AS best_return,
       ARRAY_AGG(DISTINCT config->>'timeframe') AS timeframes
     FROM backtest_runs
     ${whereClause}
     GROUP BY config->>'symbol'
     ORDER BY MAX((metrics->>'sharpeRatio')::float) DESC`,
    params
  );

  return rows.map(row => ({
    symbol: row.symbol,
    count: Number(row.count),
    bestSharpe: row.best_sharpe ?? 0,
    bestReturn: row.best_return ?? 0,
    timeframes: row.timeframes || [],
  }));
}

/**
 * Get backtest history (most recent first)
 */
export async function getBacktestHistory(limit: number = 50): Promise<BacktestResult[]> {
  const p = getPool();
  const { rows } = await p.query<BacktestRunRow>(
    `SELECT id, strategy_name, config, metrics, equity, created_at
     FROM backtest_runs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  const results: BacktestResult[] = [];
  for (const row of rows) {
    const trades = await getTrades(row.id);
    results.push({
      id: row.id,
      config: (typeof row.config === 'string'
        ? JSON.parse(row.config)
        : row.config) as BacktestConfig,
      metrics: (typeof row.metrics === 'string'
        ? JSON.parse(row.metrics)
        : row.metrics) as PerformanceMetrics,
      equity: (typeof row.equity === 'string'
        ? JSON.parse(row.equity)
        : row.equity) as EquityPoint[],
      trades,
      createdAt: Number(row.created_at),
    });
  }
  return results;
}

/**
 * Delete a backtest run and its trades
 */
export async function deleteBacktestRun(id: string): Promise<boolean> {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');
    // Foreign key cascade will handle trades deletion if FK constraints are enabled,
    // but we delete explicitly from both tables for safety
    await client.query('DELETE FROM trades WHERE backtest_id = $1', [id]);
    await client.query('DELETE FROM trades_v2 WHERE backtest_id = $1', [id]);
    const result = await client.query('DELETE FROM backtest_runs WHERE id = $1', [id]);
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Delete all backtest runs and their trades
 */
export async function deleteAllBacktestRuns(): Promise<number> {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');
    const countResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM backtest_runs'
    );
    const count = Number(countResult.rows[0]?.count ?? 0);
    await client.query('DELETE FROM trades');
    await client.query('DELETE FROM trades_v2');
    await client.query('DELETE FROM backtest_runs');
    await client.query('COMMIT');
    return count;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// Trade Operations
// ============================================================================

interface TradeV2Row {
  id: string;
  backtest_id: string;
  symbol: string;
  action: string;
  price: number;
  amount: number;
  timestamp: string | number;
  pnl: number | null;
  pnl_percent: number | null;
  closed_position_id: string | null;
  balance_after: number;
  fee: number | null;
  fee_rate: number | null;
  funding_rate: number | null;
  funding_income: number | null;
}

interface LegacyTradeRow {
  id: string;
  backtest_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  amount: number;
  pnl: number;
  pnl_percent: number;
  entry_time: string | number;
  exit_time: string | number;
}

/**
 * Get trades for a backtest run.
 * Tries trades_v2 first, falls back to legacy trades table.
 */
export async function getTrades(backtestId: string): Promise<Trade[]> {
  const p = getPool();

  // Try new format first
  const { rows: v2Rows } = await p.query<TradeV2Row>(
    `SELECT id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
            closed_position_id, balance_after, fee, fee_rate, funding_rate, funding_income
     FROM trades_v2
     WHERE backtest_id = $1
     ORDER BY timestamp ASC`,
    [backtestId]
  );

  if (v2Rows.length > 0) {
    return v2Rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      action: row.action as TradeAction,
      price: row.price,
      amount: row.amount,
      timestamp: Number(row.timestamp),
      pnl: row.pnl ?? undefined,
      pnlPercent: row.pnl_percent ?? undefined,
      closedPositionId: row.closed_position_id ?? undefined,
      balanceAfter: row.balance_after,
      fee: row.fee ?? undefined,
      feeRate: row.fee_rate ?? undefined,
      fundingRate: row.funding_rate ?? undefined,
      fundingIncome: row.funding_income ?? undefined,
    }));
  }

  // Fall back to legacy format and convert
  const { rows: legacyRows } = await p.query<LegacyTradeRow>(
    `SELECT id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent,
            entry_time, exit_time
     FROM trades
     WHERE backtest_id = $1
     ORDER BY entry_time ASC`,
    [backtestId]
  );

  // Convert legacy trades to new format (each legacy trade becomes open + close)
  const convertedTrades: Trade[] = [];
  let runningBalance = 10000; // Estimate initial capital

  for (const row of legacyRows) {
    const isLong = row.side === 'buy';

    // Open trade
    const cost = row.amount * row.entry_price;
    if (isLong) {
      runningBalance -= cost;
    }

    convertedTrades.push({
      id: `${row.id}-open`,
      symbol: row.symbol,
      action: isLong ? 'OPEN_LONG' : 'OPEN_SHORT',
      price: row.entry_price,
      amount: row.amount,
      timestamp: Number(row.entry_time),
      balanceAfter: runningBalance,
    });

    // Close trade
    if (isLong) {
      runningBalance += row.amount * row.exit_price;
    } else {
      runningBalance += row.pnl;
    }

    convertedTrades.push({
      id: `${row.id}-close`,
      symbol: row.symbol,
      action: isLong ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      price: row.exit_price,
      amount: row.amount,
      timestamp: Number(row.exit_time),
      pnl: row.pnl,
      pnlPercent: row.pnl_percent,
      closedPositionId: `${row.id}-open`,
      balanceAfter: runningBalance,
    });
  }

  return convertedTrades;
}

/**
 * Save trades for a backtest run (new format)
 */
export async function saveTrades(backtestId: string, trades: Trade[]): Promise<number> {
  if (trades.length === 0) {
    return 0;
  }

  const p = getPool();
  const client = await p.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const trade of trades) {
      const result = await client.query(
        `INSERT INTO trades_v2
         (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
          closed_position_id, balance_after, fee, fee_rate, funding_rate, funding_income)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          trade.id,
          backtestId,
          trade.symbol,
          trade.action,
          trade.price,
          trade.amount,
          trade.timestamp,
          trade.pnl ?? null,
          trade.pnlPercent ?? null,
          trade.closedPositionId ?? null,
          trade.balanceAfter,
          trade.fee ?? null,
          trade.feeRate ?? null,
          trade.fundingRate ?? null,
          trade.fundingIncome ?? null,
        ]
      );
      count += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return count;
}

// ============================================================================
// Optimized Parameters Operations
// ============================================================================

interface OptimizedParamsRow {
  id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown> | string;
  metrics: PerformanceMetrics | string;
  optimized_at: string | number;
  config: Array<{ params: Record<string, unknown>; metrics: PerformanceMetrics }> | string;
  total_combinations: number;
  tested_combinations: number;
  start_date: string | number | null;
  end_date: string | number | null;
}

/**
 * OptimizationResult type
 * Represents the result of a parameter optimization run
 */
export interface OptimizationResult {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  bestParams: Record<string, unknown>;
  bestMetrics: PerformanceMetrics;
  totalCombinations: number;
  testedCombinations: number;
  optimizedAt: number;
  startDate?: number;
  endDate?: number;
  allResults?: Array<{
    params: Record<string, unknown>;
    metrics: PerformanceMetrics;
  }>;
}

function rowToOptimizationResult(row: OptimizedParamsRow): OptimizationResult {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    timeframe: row.timeframe,
    bestParams: (typeof row.params === 'string'
      ? JSON.parse(row.params)
      : row.params) as Record<string, unknown>,
    bestMetrics: (typeof row.metrics === 'string'
      ? JSON.parse(row.metrics)
      : row.metrics) as PerformanceMetrics,
    optimizedAt: Number(row.optimized_at),
    totalCombinations: row.total_combinations,
    testedCombinations: row.tested_combinations,
    startDate: row.start_date != null ? Number(row.start_date) : undefined,
    endDate: row.end_date != null ? Number(row.end_date) : undefined,
    allResults: (typeof row.config === 'string'
      ? JSON.parse(row.config)
      : row.config) as Array<{
      params: Record<string, unknown>;
      metrics: PerformanceMetrics;
    }>,
  };
}

/**
 * Save optimized parameters to the database.
 * Creates a new record for each optimization run (does not replace existing).
 */
export async function saveOptimizedParams(result: OptimizationResult): Promise<void> {
  const p = getPool();

  await p.query(
    `INSERT INTO optimized_params
     (id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
      total_combinations, tested_combinations, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      result.id,
      result.strategyName,
      result.symbol,
      result.timeframe,
      JSON.stringify(result.bestParams),
      JSON.stringify(result.bestMetrics),
      result.optimizedAt,
      JSON.stringify(result.allResults ?? []),
      result.totalCombinations,
      result.testedCombinations,
      result.startDate ?? null,
      result.endDate ?? null,
    ]
  );
}

/**
 * Get optimized parameters by strategy name, symbol, and timeframe.
 * Returns the most recent optimization run.
 * @deprecated Use getOptimizationHistory() to get all runs
 */
export async function getOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult | null> {
  const p = getPool();
  const { rows } = await p.query<OptimizedParamsRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
            total_combinations, tested_combinations, start_date, end_date
     FROM optimized_params
     WHERE strategy_name = $1 AND symbol = $2 AND timeframe = $3
     ORDER BY optimized_at DESC
     LIMIT 1`,
    [strategyName, symbol, timeframe]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return rowToOptimizationResult(row);
}

/**
 * Get all optimization runs for a strategy/symbol/timeframe combination.
 * Sorted by most recent first.
 */
export async function getOptimizationHistory(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<OptimizationResult[]> {
  const p = getPool();
  const { rows } = await p.query<OptimizedParamsRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
            total_combinations, tested_combinations, start_date, end_date
     FROM optimized_params
     WHERE strategy_name = $1 AND symbol = $2 AND timeframe = $3
     ORDER BY optimized_at DESC`,
    [strategyName, symbol, timeframe]
  );

  return rows.map(rowToOptimizationResult);
}

/**
 * Get all optimized parameters
 */
export async function getAllOptimizedParams(): Promise<OptimizationResult[]> {
  const p = getPool();
  const { rows } = await p.query<OptimizedParamsRow>(
    `SELECT id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
            total_combinations, tested_combinations, start_date, end_date
     FROM optimized_params
     ORDER BY optimized_at DESC`
  );

  return rows.map(rowToOptimizationResult);
}

/**
 * Delete optimized parameters by strategy/symbol/timeframe.
 * Deletes ALL optimization runs for this combination.
 */
export async function deleteOptimizedParams(
  strategyName: string,
  symbol: string,
  timeframe: string
): Promise<boolean> {
  const p = getPool();
  const result = await p.query(
    'DELETE FROM optimized_params WHERE strategy_name = $1 AND symbol = $2 AND timeframe = $3',
    [strategyName, symbol, timeframe]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete a specific optimization run by ID
 */
export async function deleteOptimizationById(id: string): Promise<boolean> {
  const p = getPool();
  const result = await p.query('DELETE FROM optimized_params WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Aggregation Config Operations
// ============================================================================

export interface AggregationConfig {
  id: string;
  name: string;
  allocationMode: string;  // 'single_strongest' | 'weighted_multi' | 'top_n'
  maxPositions: number;
  subStrategies: SubStrategyConfigDB[];
  initialCapital: number;
  exchange: string;
  mode: string;  // 'spot' | 'futures'
  createdAt: number;
  updatedAt: number;
}

interface SubStrategyConfigDB {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params?: Record<string, unknown>;
  exchange?: string;
}

interface AggregationConfigRow {
  id: string;
  name: string;
  allocation_mode: string;
  max_positions: number;
  sub_strategies: SubStrategyConfigDB[] | string;
  initial_capital: number | string;
  exchange: string;
  mode: string;
  created_at: string | number;
  updated_at: string | number;
}

function rowToAggregationConfig(row: AggregationConfigRow): AggregationConfig {
  return {
    id: row.id,
    name: row.name,
    allocationMode: row.allocation_mode,
    maxPositions: row.max_positions,
    subStrategies: (typeof row.sub_strategies === 'string'
      ? JSON.parse(row.sub_strategies)
      : row.sub_strategies) as SubStrategyConfigDB[],
    initialCapital: Number(row.initial_capital),
    exchange: row.exchange,
    mode: row.mode,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Save an aggregation config to the database (upsert by id).
 */
export async function saveAggregationConfig(config: AggregationConfig): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO aggregation_configs
     (id, name, allocation_mode, max_positions, sub_strategies, initial_capital, exchange, mode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       name = $2,
       allocation_mode = $3,
       max_positions = $4,
       sub_strategies = $5,
       initial_capital = $6,
       exchange = $7,
       mode = $8,
       updated_at = $10`,
    [
      config.id,
      config.name,
      config.allocationMode,
      config.maxPositions,
      JSON.stringify(config.subStrategies),
      config.initialCapital,
      config.exchange,
      config.mode,
      config.createdAt,
      config.updatedAt,
    ]
  );
}

/**
 * Get a single aggregation config by id.
 */
export async function getAggregationConfig(id: string): Promise<AggregationConfig | null> {
  const p = getPool();
  const { rows } = await p.query<AggregationConfigRow>(
    `SELECT id, name, allocation_mode, max_positions, sub_strategies, initial_capital, exchange, mode, created_at, updated_at
     FROM aggregation_configs
     WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? rowToAggregationConfig(row) : null;
}

/**
 * Get all aggregation configs, ordered by most recently updated.
 */
export async function getAggregationConfigs(): Promise<AggregationConfig[]> {
  const p = getPool();
  const { rows } = await p.query<AggregationConfigRow>(
    `SELECT id, name, allocation_mode, max_positions, sub_strategies, initial_capital, exchange, mode, created_at, updated_at
     FROM aggregation_configs
     ORDER BY updated_at DESC`
  );
  return rows.map(rowToAggregationConfig);
}

/**
 * Update an existing aggregation config by id.
 * Returns the updated config, or null if not found.
 */
export async function updateAggregationConfig(
  id: string,
  updates: Partial<Pick<AggregationConfig, 'name' | 'allocationMode' | 'maxPositions' | 'subStrategies' | 'initialCapital' | 'exchange' | 'mode'>>
): Promise<AggregationConfig | null> {
  const p = getPool();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    params.push(updates.name);
    setClauses.push(`name = $${params.length}`);
  }
  if (updates.allocationMode !== undefined) {
    params.push(updates.allocationMode);
    setClauses.push(`allocation_mode = $${params.length}`);
  }
  if (updates.maxPositions !== undefined) {
    params.push(updates.maxPositions);
    setClauses.push(`max_positions = $${params.length}`);
  }
  if (updates.subStrategies !== undefined) {
    params.push(JSON.stringify(updates.subStrategies));
    setClauses.push(`sub_strategies = $${params.length}`);
  }
  if (updates.initialCapital !== undefined) {
    params.push(updates.initialCapital);
    setClauses.push(`initial_capital = $${params.length}`);
  }
  if (updates.exchange !== undefined) {
    params.push(updates.exchange);
    setClauses.push(`exchange = $${params.length}`);
  }
  if (updates.mode !== undefined) {
    params.push(updates.mode);
    setClauses.push(`mode = $${params.length}`);
  }

  if (setClauses.length === 0) {
    // Nothing to update, just return existing
    return getAggregationConfig(id);
  }

  // Always update updated_at
  params.push(Date.now());
  setClauses.push(`updated_at = $${params.length}`);

  // Add id as final param
  params.push(id);

  const { rows } = await p.query<AggregationConfigRow>(
    `UPDATE aggregation_configs
     SET ${setClauses.join(', ')}
     WHERE id = $${params.length}
     RETURNING id, name, allocation_mode, max_positions, sub_strategies, initial_capital, exchange, mode, created_at, updated_at`,
    params
  );

  const row = rows[0];
  return row ? rowToAggregationConfig(row) : null;
}

/**
 * Delete an aggregation config by id.
 * Returns true if deleted, false if not found.
 */
export async function deleteAggregationConfig(id: string): Promise<boolean> {
  const p = getPool();
  const result = await p.query('DELETE FROM aggregation_configs WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Config Export/Import Operations
// ============================================================================

/**
 * Get backtest runs by IDs, with aggregation config data joined in.
 * Used by the config export feature.
 */
export async function getBacktestRunsByIds(ids: string[]): Promise<Array<{
  id: string;
  config: unknown;
  metrics: unknown;
  aggregation_id: string | null;
  agg_name: string | null;
  agg_allocation_mode: string | null;
  agg_max_positions: number | null;
  agg_sub_strategies: unknown;
  agg_exchange: string | null;
  agg_mode: string | null;
}>> {
  if (ids.length === 0) return [];
  const p = getPool();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await p.query(
    `SELECT br.id, br.config, br.metrics, br.aggregation_id,
            ac.name AS agg_name,
            ac.allocation_mode AS agg_allocation_mode,
            ac.max_positions AS agg_max_positions,
            ac.sub_strategies AS agg_sub_strategies,
            ac.exchange AS agg_exchange,
            ac.mode AS agg_mode
     FROM backtest_runs br
     LEFT JOIN aggregation_configs ac ON br.aggregation_id = ac.id
     WHERE br.id IN (${placeholders})`,
    ids
  );
  return rows;
}

/**
 * Get all backtest run IDs, with optional filters.
 * Used by the CLI export script.
 */
export async function getBacktestRunIds(filters?: {
  strategy?: string;
  minSharpe?: number;
}): Promise<string[]> {
  const p = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.strategy) {
    params.push(filters.strategy);
    conditions.push(`strategy_name = $${params.length}`);
  }
  if (filters?.minSharpe != null) {
    params.push(filters.minSharpe);
    conditions.push(`(metrics->>'sharpeRatio')::float >= $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await p.query<{ id: string }>(
    `SELECT id FROM backtest_runs ${whereClause} ORDER BY created_at DESC`,
    params
  );
  return rows.map((r) => r.id);
}

// ============================================================================
// Funding Rate Operations
// ============================================================================

interface FundingRateRow {
  timestamp: string | number;
  funding_rate: number;
  mark_price: number | null;
}

/**
 * Save funding rates to the database.
 * Uses ON CONFLICT DO UPDATE to handle duplicates.
 * Returns the number of rows inserted/updated.
 */
export async function saveFundingRates(
  rates: FundingRate[],
  exchange: string,
  symbol: string
): Promise<number> {
  if (rates.length === 0) {
    return 0;
  }

  const p = getPool();
  const client = await p.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const r of rates) {
      const result = await client.query(
        `INSERT INTO funding_rates (exchange, symbol, timestamp, funding_rate, mark_price)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (exchange, symbol, timestamp)
         DO UPDATE SET funding_rate = $4, mark_price = $5`,
        [exchange, symbol, r.timestamp, r.fundingRate, r.markPrice ?? null]
      );
      count += result.rowCount ?? 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return count;
}

/**
 * Get funding rates from the database for a given exchange/symbol/date range.
 * Returns rates in ascending timestamp order.
 */
export async function getFundingRates(
  exchange: string,
  symbol: string,
  start: number,
  end: number
): Promise<FundingRate[]> {
  const p = getPool();
  const { rows } = await p.query<FundingRateRow>(
    `SELECT timestamp, funding_rate, mark_price
     FROM funding_rates
     WHERE exchange = $1 AND symbol = $2 AND timestamp >= $3 AND timestamp <= $4
     ORDER BY timestamp ASC`,
    [exchange, symbol, start, end]
  );

  return rows.map((row) => ({
    timestamp: Number(row.timestamp),
    fundingRate: row.funding_rate,
    markPrice: row.mark_price ?? undefined,
  }));
}

/**
 * Get the cached date range for funding rates of an exchange/symbol pair.
 */
export async function getFundingRateDateRange(
  exchange: string,
  symbol: string
): Promise<{ start: number | null; end: number | null }> {
  const p = getPool();
  const { rows } = await p.query<{ min_ts: string | null; max_ts: string | null }>(
    `SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
     FROM funding_rates
     WHERE exchange = $1 AND symbol = $2`,
    [exchange, symbol]
  );

  const row = rows[0];
  return {
    start: row?.min_ts != null ? Number(row.min_ts) : null,
    end: row?.max_ts != null ? Number(row.max_ts) : null,
  };
}
