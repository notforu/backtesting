#!/usr/bin/env node
/**
 * One-time migration script: SQLite -> PostgreSQL
 *
 * Reads ALL data from the SQLite database and inserts it into PostgreSQL.
 * Safe to re-run: uses ON CONFLICT DO NOTHING for idempotency.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/db npx tsx scripts/migrate-sqlite-to-pg.ts
 *   DATABASE_URL=postgresql://user:pass@host:5432/db npx tsx scripts/migrate-sqlite-to-pg.ts /path/to/backtesting.db
 */

import Database from 'better-sqlite3';
import * as pg from 'pg';
import path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SQLITE_PATH = process.argv[2] || path.join(process.cwd(), 'data', 'backtesting.db');
const PG_URL =
  process.env.DATABASE_URL || 'postgresql://backtesting:backtesting@localhost:5432/backtesting';

// Rows per batch insert. 5000 is a good balance between memory and speed.
// PostgreSQL has a max-parameters limit of 65535, so keep:
//   BATCH_SIZE * columns_per_row < 65535
const BATCH_SIZE = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Print an in-place progress line. */
function progress(table: string, done: number, total: number): void {
  const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
  process.stdout.write(`\r  ${table}: ${formatNumber(done)}/${formatNumber(total)} (${pct}%)`);
}

/** Clear the progress line and print a summary. */
function progressDone(table: string, done: number, elapsed: number): void {
  process.stdout.write(`\r  ${table}: ${formatNumber(done)} rows migrated in ${formatDuration(elapsed)}\n`);
}

// ---------------------------------------------------------------------------
// Table migrators
// ---------------------------------------------------------------------------

/**
 * Migrate the `candles` table.
 * Columns: exchange, symbol, timeframe, timestamp, open, high, low, close, volume
 * Max params per row: 9  -> safe batch size: floor(65535/9) = 7281, we use BATCH_SIZE
 */
async function migrateCandles(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const countRow = sqlite.prepare('SELECT COUNT(*) as n FROM candles').get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  candles: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // Adjust batch size so we never exceed 65535 params (9 cols per row)
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 9));

  const stmt = sqlite.prepare(
    'SELECT exchange, symbol, timeframe, timestamp, open, high, low, close, volume FROM candles ORDER BY id LIMIT ? OFFSET ?'
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      exchange: string;
      symbol: string;
      timeframe: string;
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8})`
      );
      values.push(
        row.exchange,
        row.symbol,
        row.timeframe,
        row.timestamp,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume
      );
      paramIdx += 9;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (exchange, symbol, timeframe, timestamp) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('candles', done, total);
  }

  progressDone('candles', done, Date.now() - startTime);
}

/**
 * Migrate the `backtest_runs` table.
 * Columns: id, strategy_name, config, metrics, equity, created_at
 * config/metrics/equity are JSON text in SQLite, JSONB in PG — pass raw text and PG casts it.
 */
async function migrateBacktestRuns(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const countRow = sqlite
    .prepare('SELECT COUNT(*) as n FROM backtest_runs')
    .get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  backtest_runs: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 6 cols per row -> safe batch: floor(65535/6) = 10922
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 6));

  const stmt = sqlite.prepare(
    'SELECT id, strategy_name, config, metrics, equity, created_at FROM backtest_runs ORDER BY rowid LIMIT ? OFFSET ?'
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      strategy_name: string;
      config: string;
      metrics: string;
      equity: string;
      created_at: number;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}::jsonb, $${paramIdx + 3}::jsonb, $${paramIdx + 4}::jsonb, $${paramIdx + 5})`
      );
      values.push(
        row.id,
        row.strategy_name,
        row.config,
        row.metrics,
        row.equity,
        row.created_at
      );
      paramIdx += 6;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO backtest_runs (id, strategy_name, config, metrics, equity, created_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('backtest_runs', done, total);
  }

  progressDone('backtest_runs', done, Date.now() - startTime);
}

/**
 * Migrate the legacy `trades` table.
 * Columns: id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent, entry_time, exit_time
 * FK to backtest_runs — must migrate backtest_runs first.
 * Only insert rows whose backtest_id exists in PG (orphaned rows are skipped).
 */
async function migrateTrades(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  // Check if legacy trades table exists
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trades'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  trades: table does not exist, skipping');
    return;
  }

  const countRow = sqlite.prepare('SELECT COUNT(*) as n FROM trades').get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  trades: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 11 cols per row -> safe batch: floor(65535/11) = 5957, capped at BATCH_SIZE
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 11));

  const stmt = sqlite.prepare(
    `SELECT id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent,
            entry_time, exit_time
     FROM trades ORDER BY rowid LIMIT ? OFFSET ?`
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      backtest_id: string;
      symbol: string;
      side: string;
      entry_price: number;
      exit_price: number;
      amount: number;
      pnl: number;
      pnl_percent: number;
      entry_time: number;
      exit_time: number;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10})`
      );
      values.push(
        row.id,
        row.backtest_id,
        row.symbol,
        row.side,
        row.entry_price,
        row.exit_price,
        row.amount,
        row.pnl,
        row.pnl_percent,
        row.entry_time,
        row.exit_time
      );
      paramIdx += 11;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Use a subquery to skip rows whose backtest_id no longer exists in PG.
      // This handles orphaned trade rows that reference deleted backtest runs.
      await client.query(
        `INSERT INTO trades (id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent, entry_time, exit_time)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // If FK violation, fall back to row-by-row insert so we can skip orphans
      const client2 = await pool.connect();
      let batchDone = 0;
      try {
        await client2.query('BEGIN');
        for (const row of batch) {
          try {
            await client2.query(
              `INSERT INTO trades (id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent, entry_time, exit_time)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (id) DO NOTHING`,
              [
                row.id, row.backtest_id, row.symbol, row.side,
                row.entry_price, row.exit_price, row.amount,
                row.pnl, row.pnl_percent, row.entry_time, row.exit_time,
              ]
            );
            batchDone++;
          } catch {
            // Skip FK violations (orphaned trade)
          }
        }
        await client2.query('COMMIT');
      } catch (err2) {
        await client2.query('ROLLBACK');
        throw err2;
      } finally {
        client2.release();
      }
    } finally {
      client.release();
    }

    done += batch.length;
    progress('trades', done, total);
  }

  progressDone('trades', done, Date.now() - startTime);
}

/**
 * Migrate the `trades_v2` table.
 * Columns: id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
 *          closed_position_id, balance_after, fee, fee_rate
 * FK to backtest_runs.
 */
async function migrateTradesV2(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  // Check if table exists
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trades_v2'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  trades_v2: table does not exist, skipping');
    return;
  }

  const countRow = sqlite.prepare('SELECT COUNT(*) as n FROM trades_v2').get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  trades_v2: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 13 cols per row -> safe batch: floor(65535/13) = 5041, capped at BATCH_SIZE
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 13));

  const stmt = sqlite.prepare(
    `SELECT id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
            closed_position_id, balance_after, fee, fee_rate
     FROM trades_v2 ORDER BY rowid LIMIT ? OFFSET ?`
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      backtest_id: string;
      symbol: string;
      action: string;
      price: number;
      amount: number;
      timestamp: number;
      pnl: number | null;
      pnl_percent: number | null;
      closed_position_id: string | null;
      balance_after: number;
      fee: number | null;
      fee_rate: number | null;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12})`
      );
      values.push(
        row.id,
        row.backtest_id,
        row.symbol,
        row.action,
        row.price,
        row.amount,
        row.timestamp,
        row.pnl ?? null,
        row.pnl_percent ?? null,
        row.closed_position_id ?? null,
        row.balance_after,
        row.fee ?? null,
        row.fee_rate ?? null
      );
      paramIdx += 13;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO trades_v2 (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
          closed_position_id, balance_after, fee, fee_rate)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // FK violation fallback: row-by-row, skip orphans
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        for (const row of batch) {
          try {
            await client2.query(
              `INSERT INTO trades_v2 (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent,
                closed_position_id, balance_after, fee, fee_rate)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               ON CONFLICT (id) DO NOTHING`,
              [
                row.id, row.backtest_id, row.symbol, row.action,
                row.price, row.amount, row.timestamp,
                row.pnl ?? null, row.pnl_percent ?? null,
                row.closed_position_id ?? null, row.balance_after,
                row.fee ?? null, row.fee_rate ?? null,
              ]
            );
          } catch {
            // Skip FK violations
          }
        }
        await client2.query('COMMIT');
      } catch (err2) {
        await client2.query('ROLLBACK');
        throw err2;
      } finally {
        client2.release();
      }
    } finally {
      client.release();
    }

    done += batch.length;
    progress('trades_v2', done, total);
  }

  progressDone('trades_v2', done, Date.now() - startTime);
}

/**
 * Migrate the legacy `optimization_results` table.
 * Columns: id, strategy_name, symbol, best_params, best_metric_value, metric_name,
 *          config, all_results, created_at
 */
async function migrateOptimizationResults(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='optimization_results'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  optimization_results: table does not exist, skipping');
    return;
  }

  const countRow = sqlite
    .prepare('SELECT COUNT(*) as n FROM optimization_results')
    .get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  optimization_results: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 9 cols per row -> safe batch: floor(65535/9) = 7281
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 9));

  const stmt = sqlite.prepare(
    `SELECT id, strategy_name, symbol, best_params, best_metric_value, metric_name,
            config, all_results, created_at
     FROM optimization_results ORDER BY rowid LIMIT ? OFFSET ?`
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      strategy_name: string;
      symbol: string;
      best_params: string;
      best_metric_value: number;
      metric_name: string;
      config: string;
      all_results: string;
      created_at: number;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}::jsonb, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}::jsonb, $${paramIdx + 7}::jsonb, $${paramIdx + 8})`
      );
      values.push(
        row.id,
        row.strategy_name,
        row.symbol,
        row.best_params,
        row.best_metric_value,
        row.metric_name,
        row.config,
        row.all_results,
        row.created_at
      );
      paramIdx += 9;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO optimization_results (id, strategy_name, symbol, best_params, best_metric_value, metric_name, config, all_results, created_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('optimization_results', done, total);
  }

  progressDone('optimization_results', done, Date.now() - startTime);
}

/**
 * Migrate the `optimized_params` table.
 * Columns: id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
 *          total_combinations, tested_combinations, start_date, end_date
 */
async function migrateOptimizedParams(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='optimized_params'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  optimized_params: table does not exist, skipping');
    return;
  }

  const countRow = sqlite
    .prepare('SELECT COUNT(*) as n FROM optimized_params')
    .get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  optimized_params: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 12 cols per row -> safe batch: floor(65535/12) = 5461
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 12));

  const stmt = sqlite.prepare(
    `SELECT id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
            total_combinations, tested_combinations, start_date, end_date
     FROM optimized_params ORDER BY rowid LIMIT ? OFFSET ?`
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      strategy_name: string;
      symbol: string;
      timeframe: string;
      params: string;
      metrics: string;
      optimized_at: number;
      config: string;
      total_combinations: number;
      tested_combinations: number;
      start_date: number | null;
      end_date: number | null;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}::jsonb, $${paramIdx + 5}::jsonb, $${paramIdx + 6}, $${paramIdx + 7}::jsonb, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11})`
      );
      values.push(
        row.id,
        row.strategy_name,
        row.symbol,
        row.timeframe,
        row.params,
        row.metrics,
        row.optimized_at,
        row.config,
        row.total_combinations,
        row.tested_combinations,
        row.start_date ?? null,
        row.end_date ?? null
      );
      paramIdx += 12;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO optimized_params (id, strategy_name, symbol, timeframe, params, metrics, optimized_at, config,
          total_combinations, tested_combinations, start_date, end_date)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('optimized_params', done, total);
  }

  progressDone('optimized_params', done, Date.now() - startTime);
}

/**
 * Migrate the `polymarket_markets` table.
 * Columns: id, question, slug, condition_id, clob_token_ids, end_date, category,
 *          liquidity, active, closed, image, volume, updated_at
 *
 * SQLite stores active/closed as INTEGER (0/1). PG expects BOOLEAN.
 */
async function migratePolymarketMarkets(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='polymarket_markets'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  polymarket_markets: table does not exist, skipping');
    return;
  }

  const countRow = sqlite
    .prepare('SELECT COUNT(*) as n FROM polymarket_markets')
    .get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  polymarket_markets: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 13 cols per row -> safe batch: floor(65535/13) = 5041
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 13));

  const stmt = sqlite.prepare(
    `SELECT id, question, slug, condition_id, clob_token_ids, end_date, category,
            liquidity, active, closed, image, volume, updated_at
     FROM polymarket_markets ORDER BY rowid LIMIT ? OFFSET ?`
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      id: string;
      question: string;
      slug: string;
      condition_id: string;
      clob_token_ids: string;
      end_date: string | null;
      category: string | null;
      liquidity: string | null;
      active: number;  // SQLite INTEGER 0/1
      closed: number;  // SQLite INTEGER 0/1
      image: string | null;
      volume: string | null;
      updated_at: number;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12})`
      );
      values.push(
        row.id,
        row.question,
        row.slug,
        row.condition_id,
        row.clob_token_ids,
        row.end_date ?? null,
        row.category ?? null,
        row.liquidity ?? null,
        row.active === 1,   // Convert INTEGER -> BOOLEAN
        row.closed === 1,   // Convert INTEGER -> BOOLEAN
        row.image ?? null,
        row.volume ?? null,
        row.updated_at
      );
      paramIdx += 13;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO polymarket_markets (id, question, slug, condition_id, clob_token_ids, end_date, category,
          liquidity, active, closed, image, volume, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('polymarket_markets', done, total);
  }

  progressDone('polymarket_markets', done, Date.now() - startTime);
}

/**
 * Migrate the `funding_rates` table.
 * Columns: exchange, symbol, timestamp, funding_rate, mark_price
 * id is SERIAL in PG — skip it and let PG auto-generate.
 */
async function migrateFundingRates(sqlite: Database.Database, pool: pg.Pool): Promise<void> {
  const tableCheck = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='funding_rates'")
    .get() as { name: string } | undefined;

  if (!tableCheck) {
    console.log('  funding_rates: table does not exist, skipping');
    return;
  }

  const countRow = sqlite
    .prepare('SELECT COUNT(*) as n FROM funding_rates')
    .get() as { n: number };
  const total = countRow.n;

  if (total === 0) {
    console.log('  funding_rates: empty table, skipping');
    return;
  }

  const startTime = Date.now();
  let done = 0;

  // 5 cols per row -> safe batch: floor(65535/5) = 13107, capped at BATCH_SIZE
  const batchSize = Math.min(BATCH_SIZE, Math.floor(65535 / 5));

  const stmt = sqlite.prepare(
    'SELECT exchange, symbol, timestamp, funding_rate, mark_price FROM funding_rates ORDER BY id LIMIT ? OFFSET ?'
  );

  while (done < total) {
    const batch = stmt.all(batchSize, done) as Array<{
      exchange: string;
      symbol: string;
      timestamp: number;
      funding_rate: number;
      mark_price: number | null;
    }>;

    if (batch.length === 0) break;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`
      );
      values.push(
        row.exchange,
        row.symbol,
        row.timestamp,
        row.funding_rate,
        row.mark_price ?? null
      );
      paramIdx += 5;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO funding_rates (exchange, symbol, timestamp, funding_rate, mark_price)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (exchange, symbol, timestamp) DO NOTHING`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    progress('funding_rates', done, total);
  }

  progressDone('funding_rates', done, Date.now() - startTime);
}

// ---------------------------------------------------------------------------
// Verify tables exist in PG before migrating
// ---------------------------------------------------------------------------

async function verifyPgTables(pool: pg.Pool): Promise<void> {
  const required = [
    'candles',
    'backtest_runs',
    'trades',
    'trades_v2',
    'optimization_results',
    'optimized_params',
    'polymarket_markets',
    'funding_rates',
  ];

  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`
  );
  const existing = new Set(rows.map((r) => r.tablename));

  const missing = required.filter((t) => !existing.has(t));
  if (missing.length > 0) {
    throw new Error(
      `PostgreSQL is missing required tables: ${missing.join(', ')}.\n` +
        'Run migrations first: npx tsx src/data/db.ts or start the server once to apply migrations.'
    );
  }
}

// ---------------------------------------------------------------------------
// List SQLite tables
// ---------------------------------------------------------------------------

function listSqliteTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== SQLite -> PostgreSQL Migration ===');
  console.log(`SQLite:     ${SQLITE_PATH}`);
  console.log(`PostgreSQL: ${PG_URL.replace(/:([^:@]+)@/, ':***@')}`);
  console.log('');

  // Open SQLite (read-only)
  let sqlite: Database.Database;
  try {
    sqlite = new Database(SQLITE_PATH, { readonly: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to open SQLite database at "${SQLITE_PATH}": ${msg}`);
    process.exit(1);
  }

  // Open PG pool
  const { Pool } = pg;
  const pool = new Pool({ connectionString: PG_URL, max: 5 });

  // Test PG connection
  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to PostgreSQL: ${msg}`);
    sqlite.close();
    await pool.end();
    process.exit(1);
  }

  try {
    // Show SQLite tables
    const sqliteTables = listSqliteTables(sqlite);
    console.log(`SQLite tables found: ${sqliteTables.join(', ')}`);
    console.log('');

    // Verify PG has required tables
    await verifyPgTables(pool);
    console.log('PostgreSQL schema verified OK');
    console.log('');

    const globalStart = Date.now();

    // ----- Migrate in FK-safe order -----

    console.log('[1/8] Migrating candles...');
    await migrateCandles(sqlite, pool);

    console.log('[2/8] Migrating backtest_runs...');
    await migrateBacktestRuns(sqlite, pool);

    console.log('[3/8] Migrating trades (legacy)...');
    await migrateTrades(sqlite, pool);

    console.log('[4/8] Migrating trades_v2...');
    await migrateTradesV2(sqlite, pool);

    console.log('[5/8] Migrating optimization_results (legacy)...');
    await migrateOptimizationResults(sqlite, pool);

    console.log('[6/8] Migrating optimized_params...');
    await migrateOptimizedParams(sqlite, pool);

    console.log('[7/8] Migrating polymarket_markets...');
    await migratePolymarketMarkets(sqlite, pool);

    console.log('[8/8] Migrating funding_rates...');
    await migrateFundingRates(sqlite, pool);

    // ----- Summary -----
    const totalElapsed = Date.now() - globalStart;
    console.log('');
    console.log('=== Migration Complete ===');
    console.log(`Total time: ${formatDuration(totalElapsed)}`);
    console.log('');

    // Print row counts in PG for confirmation
    console.log('Row counts in PostgreSQL:');
    const tables = [
      'candles',
      'backtest_runs',
      'trades',
      'trades_v2',
      'optimization_results',
      'optimized_params',
      'polymarket_markets',
      'funding_rates',
    ];
    for (const table of tables) {
      const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) as count FROM ${table}`);
      const count = Number(rows[0]?.count ?? 0);
      console.log(`  ${table.padEnd(25)} ${formatNumber(count)}`);
    }
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nFatal migration error:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
