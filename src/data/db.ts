/**
 * SQLite database connection and operations
 * Uses better-sqlite3 for synchronous, fast database access
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  Candle,
  Timeframe,
  BacktestResult,
  Trade,
  BacktestConfig,
  PerformanceMetrics,
  EquityPoint,
  TradeAction,
} from '../core/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/backtesting.db');

// ============================================================================
// Database Connection
// ============================================================================

let db: Database.Database | null = null;

/**
 * Get or create database connection
 */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeTables(db);
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================================================
// Schema Initialization
// ============================================================================

/**
 * Create database tables if they don't exist
 */
function initializeTables(database: Database.Database): void {
  database.exec(`
    -- Candles cache
    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exchange TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      UNIQUE(exchange, symbol, timeframe, timestamp)
    );

    -- Backtest runs
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      config JSON NOT NULL,
      metrics JSON NOT NULL,
      equity JSON NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Legacy trades table (for backward compatibility)
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      backtest_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      amount REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_percent REAL NOT NULL,
      entry_time INTEGER NOT NULL,
      exit_time INTEGER NOT NULL,
      FOREIGN KEY (backtest_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
    );

    -- New trades table with open/close model
    CREATE TABLE IF NOT EXISTS trades_v2 (
      id TEXT PRIMARY KEY,
      backtest_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      pnl REAL,
      pnl_percent REAL,
      closed_position_id TEXT,
      balance_after REAL NOT NULL,
      fee REAL,
      fee_rate REAL,
      FOREIGN KEY (backtest_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
    );

    -- Indexes for efficient lookups
    CREATE INDEX IF NOT EXISTS idx_candles_lookup
      ON candles(exchange, symbol, timeframe, timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_backtest
      ON trades(backtest_id);
    CREATE INDEX IF NOT EXISTS idx_trades_v2_backtest
      ON trades_v2(backtest_id);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_created
      ON backtest_runs(created_at DESC);
  `);

  // Run migrations for existing databases
  runMigrations(database);
}

/**
 * Run database migrations for schema updates
 */
function runMigrations(database: Database.Database): void {
  // Check if fee columns exist in trades_v2
  const tableInfo = database.prepare("PRAGMA table_info(trades_v2)").all() as { name: string }[];
  const columnNames = tableInfo.map((col) => col.name);

  // Add fee column if it doesn't exist
  if (!columnNames.includes('fee')) {
    database.exec('ALTER TABLE trades_v2 ADD COLUMN fee REAL');
  }

  // Add fee_rate column if it doesn't exist
  if (!columnNames.includes('fee_rate')) {
    database.exec('ALTER TABLE trades_v2 ADD COLUMN fee_rate REAL');
  }
}

// ============================================================================
// Candle Operations
// ============================================================================

interface CandleRow {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Save candles to the database
 * Uses INSERT OR REPLACE to handle duplicates
 */
export function saveCandles(
  candles: Candle[],
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): number {
  const database = getDb();
  const insert = database.prepare(`
    INSERT OR REPLACE INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((candleList: Candle[]) => {
    let count = 0;
    for (const candle of candleList) {
      insert.run(
        exchange,
        symbol,
        timeframe,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume
      );
      count++;
    }
    return count;
  });

  return insertMany(candles);
}

/**
 * Get candles from the database
 */
export function getCandles(
  exchange: string,
  symbol: string,
  timeframe: Timeframe,
  start: number,
  end: number
): Candle[] {
  const database = getDb();
  const select = database.prepare<[string, string, string, number, number], CandleRow>(`
    SELECT timestamp, open, high, low, close, volume
    FROM candles
    WHERE exchange = ? AND symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const rows = select.all(exchange, symbol, timeframe, start, end);
  return rows.map((row) => ({
    timestamp: row.timestamp,
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
export function getCandleDateRange(
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): { start: number | null; end: number | null } {
  const database = getDb();
  const select = database.prepare<[string, string, string], { min_ts: number | null; max_ts: number | null }>(`
    SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
    FROM candles
    WHERE exchange = ? AND symbol = ? AND timeframe = ?
  `);

  const row = select.get(exchange, symbol, timeframe);
  return {
    start: row?.min_ts ?? null,
    end: row?.max_ts ?? null,
  };
}

/**
 * Delete candles from the database
 */
export function deleteCandles(
  exchange: string,
  symbol: string,
  timeframe: Timeframe
): number {
  const database = getDb();
  const result = database
    .prepare('DELETE FROM candles WHERE exchange = ? AND symbol = ? AND timeframe = ?')
    .run(exchange, symbol, timeframe);
  return result.changes;
}

// ============================================================================
// Backtest Run Operations
// ============================================================================

interface BacktestRunRow {
  id: string;
  strategy_name: string;
  config: string;
  metrics: string;
  equity: string;
  created_at: number;
}

/**
 * Save a backtest run to the database (using new trades_v2 schema)
 */
export function saveBacktestRun(result: BacktestResult): void {
  const database = getDb();

  const insertRun = database.prepare(`
    INSERT INTO backtest_runs (id, strategy_name, config, metrics, equity, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertTrade = database.prepare(`
    INSERT INTO trades_v2 (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent, closed_position_id, balance_after, fee, fee_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = database.transaction(() => {
    // Insert the run
    insertRun.run(
      result.id,
      result.config.strategyName,
      JSON.stringify(result.config),
      JSON.stringify(result.metrics),
      JSON.stringify(result.equity),
      result.createdAt
    );

    // Insert all trades
    for (const trade of result.trades) {
      insertTrade.run(
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
        trade.feeRate ?? null
      );
    }
  });

  saveAll();
}

/**
 * Get a backtest run by ID
 */
export function getBacktestRun(id: string): BacktestResult | null {
  const database = getDb();
  const select = database.prepare<[string], BacktestRunRow>(`
    SELECT id, strategy_name, config, metrics, equity, created_at
    FROM backtest_runs
    WHERE id = ?
  `);

  const row = select.get(id);
  if (!row) {
    return null;
  }

  const trades = getTrades(id);

  return {
    id: row.id,
    config: JSON.parse(row.config) as BacktestConfig,
    metrics: JSON.parse(row.metrics) as PerformanceMetrics,
    equity: JSON.parse(row.equity) as EquityPoint[],
    trades,
    createdAt: row.created_at,
  };
}

/**
 * Get backtest history (most recent first)
 */
export function getBacktestHistory(limit: number = 50): BacktestResult[] {
  const database = getDb();
  const select = database.prepare<[number], BacktestRunRow>(`
    SELECT id, strategy_name, config, metrics, equity, created_at
    FROM backtest_runs
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = select.all(limit);
  return rows.map((row) => {
    const trades = getTrades(row.id);
    return {
      id: row.id,
      config: JSON.parse(row.config) as BacktestConfig,
      metrics: JSON.parse(row.metrics) as PerformanceMetrics,
      equity: JSON.parse(row.equity) as EquityPoint[],
      trades,
      createdAt: row.created_at,
    };
  });
}

/**
 * Delete a backtest run and its trades
 */
export function deleteBacktestRun(id: string): boolean {
  const database = getDb();
  // Delete from both trade tables
  database.prepare('DELETE FROM trades WHERE backtest_id = ?').run(id);
  database.prepare('DELETE FROM trades_v2 WHERE backtest_id = ?').run(id);
  const result = database.prepare('DELETE FROM backtest_runs WHERE id = ?').run(id);
  return result.changes > 0;
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
  timestamp: number;
  pnl: number | null;
  pnl_percent: number | null;
  closed_position_id: string | null;
  balance_after: number;
  fee: number | null;
  fee_rate: number | null;
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
  entry_time: number;
  exit_time: number;
}

/**
 * Get trades for a backtest run
 * Tries trades_v2 first, falls back to legacy trades table
 */
export function getTrades(backtestId: string): Trade[] {
  const database = getDb();

  // Try new format first
  const selectV2 = database.prepare<[string], TradeV2Row>(`
    SELECT id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent, closed_position_id, balance_after, fee, fee_rate
    FROM trades_v2
    WHERE backtest_id = ?
    ORDER BY timestamp ASC
  `);

  const v2Rows = selectV2.all(backtestId);

  if (v2Rows.length > 0) {
    return v2Rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      action: row.action as TradeAction,
      price: row.price,
      amount: row.amount,
      timestamp: row.timestamp,
      pnl: row.pnl ?? undefined,
      pnlPercent: row.pnl_percent ?? undefined,
      closedPositionId: row.closed_position_id ?? undefined,
      balanceAfter: row.balance_after,
      fee: row.fee ?? undefined,
      feeRate: row.fee_rate ?? undefined,
    }));
  }

  // Fall back to legacy format and convert
  const selectLegacy = database.prepare<[string], LegacyTradeRow>(`
    SELECT id, backtest_id, symbol, side, entry_price, exit_price, amount, pnl, pnl_percent, entry_time, exit_time
    FROM trades
    WHERE backtest_id = ?
    ORDER BY entry_time ASC
  `);

  const legacyRows = selectLegacy.all(backtestId);

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
      timestamp: row.entry_time,
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
      timestamp: row.exit_time,
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
export function saveTrades(backtestId: string, trades: Trade[]): number {
  const database = getDb();
  const insert = database.prepare(`
    INSERT INTO trades_v2 (id, backtest_id, symbol, action, price, amount, timestamp, pnl, pnl_percent, closed_position_id, balance_after, fee, fee_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((tradeList: Trade[]) => {
    let count = 0;
    for (const trade of tradeList) {
      insert.run(
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
        trade.feeRate ?? null
      );
      count++;
    }
    return count;
  });

  return insertMany(trades);
}
