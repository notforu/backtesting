/**
 * Paper Trading - Database CRUD Functions
 *
 * All functions use the shared PostgreSQL pool from src/data/db.ts.
 * BIGINT columns (timestamps) are returned as strings by pg and must be
 * converted with Number(). JSONB columns are auto-parsed by the pg driver.
 */

import { getPool } from '../data/db.js';
import type {
  PaperSession,
  PaperPosition,
  PaperTrade,
  PaperEquitySnapshot,
} from './types.js';
import type { AggregateBacktestConfig } from '../core/signal-types.js';

// ============================================================================
// Row types (snake_case from DB → camelCase TypeScript)
// ============================================================================

interface PaperSessionRow {
  id: string;
  name: string;
  aggregation_config: AggregateBacktestConfig; // JSONB auto-parsed
  aggregation_config_id: string | null;
  strategy_config_id: string | null;
  status: string;
  connector_type: string;
  initial_capital: number | string;
  current_equity: number | string;
  current_cash: number | string;
  tick_count: number;
  last_tick_at: string | null;
  next_tick_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
}

interface PaperPositionRow {
  id: number;
  session_id: string;
  symbol: string;
  direction: string;
  sub_strategy_key: string;
  entry_price: number | string;
  amount: number | string;
  entry_time: string;
  unrealized_pnl: number | string;
  funding_accumulated: number | string;
  stop_loss: number | string | null;
  take_profit: number | string | null;
}

interface PaperTradeRow {
  id: number;
  session_id: string;
  symbol: string;
  action: string;
  price: number | string;
  amount: number | string;
  timestamp: string;
  pnl: number | string | null;
  pnl_percent: number | string | null;
  fee: number | string;
  funding_income: number | string;
  balance_after: number | string;
}

interface PaperEquitySnapshotRow {
  id: number;
  session_id: string;
  timestamp: string;
  equity: number | string;
  cash: number | string;
  positions_value: number | string;
}

// ============================================================================
// Row mappers
// ============================================================================

function rowToSession(row: PaperSessionRow): PaperSession {
  return {
    id: row.id,
    name: row.name,
    aggregationConfig: row.aggregation_config,
    aggregationConfigId: row.aggregation_config_id,
    strategyConfigId: row.strategy_config_id,
    status: row.status as PaperSession['status'],
    connectorType: (row.connector_type ?? 'paper') as PaperSession['connectorType'],
    initialCapital: Number(row.initial_capital),
    currentEquity: Number(row.current_equity),
    currentCash: Number(row.current_cash),
    tickCount: row.tick_count,
    lastTickAt: row.last_tick_at != null ? Number(row.last_tick_at) : null,
    nextTickAt: row.next_tick_at != null ? Number(row.next_tick_at) : null,
    errorMessage: row.error_message,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    userId: row.user_id ?? undefined,
  };
}

function rowToPosition(row: PaperPositionRow): PaperPosition {
  return {
    id: row.id,
    sessionId: row.session_id,
    symbol: row.symbol,
    direction: row.direction as 'long' | 'short',
    subStrategyKey: row.sub_strategy_key,
    entryPrice: Number(row.entry_price),
    amount: Number(row.amount),
    entryTime: Number(row.entry_time),
    unrealizedPnl: Number(row.unrealized_pnl),
    fundingAccumulated: Number(row.funding_accumulated),
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
    takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
  };
}

function rowToTrade(row: PaperTradeRow): PaperTrade {
  return {
    id: row.id,
    sessionId: row.session_id,
    symbol: row.symbol,
    action: row.action as PaperTrade['action'],
    price: Number(row.price),
    amount: Number(row.amount),
    timestamp: Number(row.timestamp),
    pnl: row.pnl != null ? Number(row.pnl) : null,
    pnlPercent: row.pnl_percent != null ? Number(row.pnl_percent) : null,
    fee: Number(row.fee),
    fundingIncome: Number(row.funding_income),
    balanceAfter: Number(row.balance_after),
  };
}

function rowToSnapshot(row: PaperEquitySnapshotRow): PaperEquitySnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: Number(row.timestamp),
    equity: Number(row.equity),
    cash: Number(row.cash),
    positionsValue: Number(row.positions_value),
  };
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Create a new paper trading session.
 * The caller provides a pre-generated id and the aggregation config snapshot.
 * connectorType defaults to 'paper' if not provided.
 */
export async function createPaperSession(
  session: Pick<PaperSession, 'id' | 'name' | 'aggregationConfig' | 'aggregationConfigId' | 'initialCapital'> & { userId?: string; connectorType?: PaperSession['connectorType'] }
): Promise<PaperSession> {
  const p = getPool();
  const now = Date.now();
  const connectorType = session.connectorType ?? 'paper';

  const { rows } = await p.query<PaperSessionRow>(
    `INSERT INTO paper_sessions
     (id, name, aggregation_config, aggregation_config_id, status,
      connector_type, initial_capital, current_equity, current_cash,
      tick_count, last_tick_at, next_tick_at, error_message,
      created_at, updated_at, user_id)
     VALUES ($1, $2, $3, $4, 'stopped', $5, $6, $6, $6, 0, NULL, NULL, NULL, $7, $7, $8)
     RETURNING *`,
    [
      session.id,
      session.name,
      JSON.stringify(session.aggregationConfig),
      session.aggregationConfigId ?? null,
      connectorType,
      session.initialCapital,
      now,
      session.userId ?? null,
    ]
  );

  return rowToSession(rows[0]);
}

/**
 * Get a single paper session by id.
 * Returns null if not found.
 */
export async function getPaperSession(id: string): Promise<PaperSession | null> {
  const p = getPool();
  const { rows } = await p.query<PaperSessionRow>(
    `SELECT * FROM paper_sessions WHERE id = $1`,
    [id]
  );

  const row = rows[0];
  return row ? rowToSession(row) : null;
}

/**
 * List all paper sessions, most recently created first.
 */
export async function listPaperSessions(): Promise<PaperSession[]> {
  const p = getPool();
  const { rows } = await p.query<PaperSessionRow>(
    `SELECT * FROM paper_sessions ORDER BY created_at DESC`
  );

  return rows.map(rowToSession);
}

/**
 * Update mutable fields on a paper session.
 * Automatically sets updated_at to now.
 */
export async function updatePaperSession(
  id: string,
  updates: Partial<Pick<
    PaperSession,
    'status' | 'currentEquity' | 'currentCash' | 'tickCount' | 'lastTickAt' | 'nextTickAt' | 'errorMessage'
  >>
): Promise<void> {
  const p = getPool();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    params.push(updates.status);
    setClauses.push(`status = $${params.length}`);
  }
  if (updates.currentEquity !== undefined) {
    params.push(updates.currentEquity);
    setClauses.push(`current_equity = $${params.length}`);
  }
  if (updates.currentCash !== undefined) {
    params.push(updates.currentCash);
    setClauses.push(`current_cash = $${params.length}`);
  }
  if (updates.tickCount !== undefined) {
    params.push(updates.tickCount);
    setClauses.push(`tick_count = $${params.length}`);
  }
  if (updates.lastTickAt !== undefined) {
    params.push(updates.lastTickAt);
    setClauses.push(`last_tick_at = $${params.length}`);
  }
  if (updates.nextTickAt !== undefined) {
    params.push(updates.nextTickAt);
    setClauses.push(`next_tick_at = $${params.length}`);
  }
  if (updates.errorMessage !== undefined) {
    params.push(updates.errorMessage);
    setClauses.push(`error_message = $${params.length}`);
  }

  if (setClauses.length === 0) {
    return;
  }

  // Always update updated_at
  params.push(Date.now());
  setClauses.push(`updated_at = $${params.length}`);

  // id as final param
  params.push(id);

  await p.query(
    `UPDATE paper_sessions SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
    params
  );
}

/**
 * Delete a paper session by id.
 * Cascades to paper_positions, paper_trades, and paper_equity_snapshots.
 */
export async function deletePaperSession(id: string): Promise<boolean> {
  const p = getPool();
  const result = await p.query('DELETE FROM paper_sessions WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Position Operations
// ============================================================================

/**
 * Upsert an open position for a session.
 * If a position with the same (session_id, symbol, direction) already exists,
 * it is updated in place (e.g., after adding to a position or marking-to-market).
 */
export async function savePaperPosition(
  position: Omit<PaperPosition, 'id'>
): Promise<void> {
  const p = getPool();

  await p.query(
    `INSERT INTO paper_positions
     (session_id, symbol, direction, sub_strategy_key, entry_price, amount, entry_time,
      unrealized_pnl, funding_accumulated, stop_loss, take_profit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (session_id, sub_strategy_key, direction) DO UPDATE SET
       entry_price = EXCLUDED.entry_price,
       amount = EXCLUDED.amount,
       entry_time = EXCLUDED.entry_time,
       unrealized_pnl = EXCLUDED.unrealized_pnl,
       funding_accumulated = EXCLUDED.funding_accumulated,
       stop_loss = EXCLUDED.stop_loss,
       take_profit = EXCLUDED.take_profit`,
    [
      position.sessionId,
      position.symbol,
      position.direction,
      position.subStrategyKey,
      position.entryPrice,
      position.amount,
      position.entryTime,
      position.unrealizedPnl,
      position.fundingAccumulated,
      position.stopLoss ?? null,
      position.takeProfit ?? null,
    ]
  );
}

/**
 * Get all open positions for a session.
 */
export async function getPaperPositions(sessionId: string): Promise<PaperPosition[]> {
  const p = getPool();
  const { rows } = await p.query<PaperPositionRow>(
    `SELECT * FROM paper_positions WHERE session_id = $1 ORDER BY entry_time ASC`,
    [sessionId]
  );

  return rows.map(rowToPosition);
}

/**
 * Delete a specific open position by session + subStrategyKey + direction.
 * Called when a position is closed.
 * The second argument is the sub-strategy key (e.g. "funding-rate-spike:BTC/USDT:4h"),
 * not the plain symbol.
 */
export async function deletePaperPosition(
  sessionId: string,
  subStrategyKey: string,
  direction: string
): Promise<void> {
  const p = getPool();
  await p.query(
    `DELETE FROM paper_positions WHERE session_id = $1 AND sub_strategy_key = $2 AND direction = $3`,
    [sessionId, subStrategyKey, direction]
  );
}

/**
 * Delete all open positions for a session (e.g., on reset or stop).
 */
export async function deleteAllPaperPositions(sessionId: string): Promise<void> {
  const p = getPool();
  await p.query('DELETE FROM paper_positions WHERE session_id = $1', [sessionId]);
}

// ============================================================================
// Trade Operations
// ============================================================================

/**
 * Save a paper trade (open or close event) and return it with its generated id.
 */
export async function savePaperTrade(
  trade: Omit<PaperTrade, 'id'>
): Promise<PaperTrade> {
  const p = getPool();

  const { rows } = await p.query<PaperTradeRow>(
    `INSERT INTO paper_trades
     (session_id, symbol, action, price, amount, timestamp,
      pnl, pnl_percent, fee, funding_income, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      trade.sessionId,
      trade.symbol,
      trade.action,
      trade.price,
      trade.amount,
      trade.timestamp,
      trade.pnl ?? null,
      trade.pnlPercent ?? null,
      trade.fee,
      trade.fundingIncome,
      trade.balanceAfter,
    ]
  );

  return rowToTrade(rows[0]);
}

/**
 * Get trades for a session with optional pagination.
 * Returns trades ordered by timestamp descending (most recent first)
 * and the total count for pagination.
 */
export async function getPaperTrades(
  sessionId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ trades: PaperTrade[]; total: number }> {
  const p = getPool();

  const countResult = await p.query<{ count: string }>(
    `SELECT COUNT(*) FROM paper_trades WHERE session_id = $1`,
    [sessionId]
  );
  const total = Number(countResult.rows[0].count);

  const { rows } = await p.query<PaperTradeRow>(
    `SELECT * FROM paper_trades
     WHERE session_id = $1
     ORDER BY timestamp DESC
     LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset]
  );

  return { trades: rows.map(rowToTrade), total };
}

// ============================================================================
// Equity Snapshot Operations
// ============================================================================

/**
 * Upsert an equity snapshot for a session at a given timestamp.
 * If a snapshot already exists for (session_id, timestamp), it is updated.
 */
export async function savePaperEquitySnapshot(
  snapshot: Omit<PaperEquitySnapshot, 'id'>
): Promise<void> {
  const p = getPool();

  await p.query(
    `INSERT INTO paper_equity_snapshots
     (session_id, timestamp, equity, cash, positions_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, timestamp) DO UPDATE SET
       equity = EXCLUDED.equity,
       cash = EXCLUDED.cash,
       positions_value = EXCLUDED.positions_value`,
    [
      snapshot.sessionId,
      snapshot.timestamp,
      snapshot.equity,
      snapshot.cash,
      snapshot.positionsValue,
    ]
  );
}

/**
 * Get all equity snapshots for a session, ordered chronologically.
 * Used for rendering the equity curve.
 */
export async function getPaperEquitySnapshots(
  sessionId: string
): Promise<PaperEquitySnapshot[]> {
  const p = getPool();
  const { rows } = await p.query<PaperEquitySnapshotRow>(
    `SELECT * FROM paper_equity_snapshots
     WHERE session_id = $1
     ORDER BY timestamp ASC`,
    [sessionId]
  );

  return rows.map(rowToSnapshot);
}

// ============================================================================
// Session Event Operations
// ============================================================================

export interface PaperSessionEventRow {
  id: number;
  session_id: string;
  type: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface PaperSessionEvent {
  id: number;
  sessionId: string;
  type: string;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: number;
}

function rowToEvent(row: PaperSessionEventRow): PaperSessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    message: row.message,
    details: row.details,
    createdAt: Number(row.created_at),
  };
}

/**
 * Save a paper session event (trade, error, status change, etc.).
 * Fire-and-forget — callers should not await this.
 */
export async function savePaperSessionEvent(event: {
  sessionId: string;
  type: string;
  message: string;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO paper_session_events (session_id, type, message, details, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [event.sessionId, event.type, event.message, event.details ? JSON.stringify(event.details) : null, Date.now()]
  );
}

/**
 * Get events for a session with pagination (most recent first).
 */
export async function getPaperSessionEvents(
  sessionId: string,
  limit: number = 100,
  offset: number = 0,
): Promise<{ events: PaperSessionEvent[]; total: number }> {
  const p = getPool();

  const countResult = await p.query<{ count: string }>(
    'SELECT COUNT(*) FROM paper_session_events WHERE session_id = $1',
    [sessionId],
  );
  const total = Number(countResult.rows[0].count);

  const { rows } = await p.query<PaperSessionEventRow>(
    `SELECT * FROM paper_session_events
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset],
  );

  return { events: rows.map(rowToEvent), total };
}
