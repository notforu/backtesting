/**
 * State Persistence Tests (6D)
 *
 * Tests the save/restore cycle for paper trading data. Mocks the PostgreSQL
 * pool so no real DB connection is needed. Verifies that the row-to-domain
 * mapping functions produce correct domain objects.
 *
 * We test the DB module (paperDb) directly by mocking getPool() and
 * verifying the SQL + domain object shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperPosition } from '../types.js';

// ============================================================================
// Mock the pg pool
// ============================================================================

// We mock the data/db.js module to return a fake pool with a query() stub
const mockQuery = vi.fn();
vi.mock('../../data/db.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Now import the module under test — imports run after mock hoisting
import * as paperDb from '../db.js';

// ============================================================================
// Row fixtures (what PostgreSQL would actually return)
// ============================================================================

function makeSessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sess-001',
    name: 'Test Session',
    aggregation_config: {
      subStrategies: [],
      allocationMode: 'single_strongest',
      maxPositions: 1,
      initialCapital: 10000,
      startDate: 0,
      endDate: 1,
      exchange: 'bybit',
    },
    aggregation_config_id: null,
    status: 'stopped',
    initial_capital: '10000',
    current_equity: '10000',
    current_cash: '10000',
    tick_count: 0,
    last_tick_at: null,
    next_tick_at: null,
    error_message: null,
    created_at: '1700000000000',
    updated_at: '1700000000000',
    ...overrides,
  };
}

function makePositionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    session_id: 'sess-001',
    symbol: 'BTC/USDT',
    direction: 'long',
    entry_price: '50000',
    amount: '0.1',
    entry_time: '1700000000000',
    unrealized_pnl: '500',
    funding_accumulated: '10.5',
    ...overrides,
  };
}

function makeTradeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 99,
    session_id: 'sess-001',
    symbol: 'BTC/USDT',
    action: 'open_long',
    price: '50000',
    amount: '0.1',
    timestamp: '1700000000000',
    pnl: null,
    pnl_percent: null,
    fee: '27.5',
    funding_income: '0',
    balance_after: '4972.5',
    ...overrides,
  };
}

function makeSnapshotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    session_id: 'sess-001',
    timestamp: '1700000000000',
    equity: '10500',
    cash: '4972.5',
    positions_value: '5527.5',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Paper Trading DB Persistence', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. Session get roundtrip: row mapping produces correct domain object
  // ==========================================================================

  describe('getPaperSession', () => {
    it('maps all fields correctly including BIGINT timestamp conversion', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });

      const session = await paperDb.getPaperSession('sess-001');

      expect(session).not.toBeNull();
      expect(session!.id).toBe('sess-001');
      expect(session!.name).toBe('Test Session');
      expect(session!.status).toBe('stopped');
      expect(session!.initialCapital).toBe(10_000);
      expect(session!.currentEquity).toBe(10_000);
      expect(session!.currentCash).toBe(10_000);
      expect(session!.tickCount).toBe(0);
      expect(session!.lastTickAt).toBeNull();
      expect(session!.nextTickAt).toBeNull();
      expect(session!.errorMessage).toBeNull();
      expect(session!.createdAt).toBe(1_700_000_000_000);
      expect(session!.updatedAt).toBe(1_700_000_000_000);
    });

    it('returns null when session not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const session = await paperDb.getPaperSession('does-not-exist');
      expect(session).toBeNull();
    });

    it('converts lastTickAt and nextTickAt from string to number', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeSessionRow({
          last_tick_at: '1700000001000',
          next_tick_at: '1700000005000',
        })],
      });

      const session = await paperDb.getPaperSession('sess-001');
      expect(session!.lastTickAt).toBe(1_700_000_001_000);
      expect(session!.nextTickAt).toBe(1_700_000_005_000);
    });
  });

  // ==========================================================================
  // 2. Position save/restore: fields round-trip correctly
  // ==========================================================================

  describe('getPaperPositions', () => {
    it('maps position row fields correctly with type conversions', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makePositionRow()] });

      const positions = await paperDb.getPaperPositions('sess-001');

      expect(positions).toHaveLength(1);
      const pos = positions[0];
      expect(pos.id).toBe(42);
      expect(pos.sessionId).toBe('sess-001');
      expect(pos.symbol).toBe('BTC/USDT');
      expect(pos.direction).toBe('long');
      expect(pos.entryPrice).toBe(50_000);
      expect(pos.amount).toBe(0.1);
      expect(pos.entryTime).toBe(1_700_000_000_000);
      expect(pos.unrealizedPnl).toBe(500);
      expect(pos.fundingAccumulated).toBe(10.5);
    });

    it('returns empty array when no positions exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const positions = await paperDb.getPaperPositions('sess-001');
      expect(positions).toHaveLength(0);
    });

    it('maps multiple positions preserving order', async () => {
      const rows = [
        makePositionRow({ id: 1, symbol: 'BTC/USDT' }),
        makePositionRow({ id: 2, symbol: 'ETH/USDT', direction: 'short' }),
      ];
      mockQuery.mockResolvedValueOnce({ rows });

      const positions = await paperDb.getPaperPositions('sess-001');
      expect(positions).toHaveLength(2);
      expect(positions[0].symbol).toBe('BTC/USDT');
      expect(positions[0].direction).toBe('long');
      expect(positions[1].symbol).toBe('ETH/USDT');
      expect(positions[1].direction).toBe('short');
    });
  });

  // ==========================================================================
  // 3. Equity snapshots: save and retrieve in order
  // ==========================================================================

  describe('getPaperEquitySnapshots', () => {
    it('maps equity snapshot row fields with type conversions', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeSnapshotRow()] });

      const snapshots = await paperDb.getPaperEquitySnapshots('sess-001');

      expect(snapshots).toHaveLength(1);
      const snap = snapshots[0];
      expect(snap.id).toBe(7);
      expect(snap.sessionId).toBe('sess-001');
      expect(snap.timestamp).toBe(1_700_000_000_000);
      expect(snap.equity).toBe(10_500);
      expect(snap.cash).toBe(4_972.5);
      expect(snap.positionsValue).toBe(5_527.5);
    });

    it('returns multiple snapshots ordered by timestamp', async () => {
      const rows = [
        makeSnapshotRow({ id: 1, timestamp: '1700000001000', equity: '10100' }),
        makeSnapshotRow({ id: 2, timestamp: '1700000002000', equity: '10200' }),
        makeSnapshotRow({ id: 3, timestamp: '1700000003000', equity: '10300' }),
      ];
      mockQuery.mockResolvedValueOnce({ rows });

      const snapshots = await paperDb.getPaperEquitySnapshots('sess-001');
      expect(snapshots).toHaveLength(3);
      expect(snapshots[0].timestamp).toBe(1_700_000_001_000);
      expect(snapshots[1].timestamp).toBe(1_700_000_002_000);
      expect(snapshots[2].timestamp).toBe(1_700_000_003_000);
      // Equity ascending
      expect(snapshots[0].equity).toBe(10_100);
      expect(snapshots[2].equity).toBe(10_300);
    });
  });

  // ==========================================================================
  // 4. Trade pagination: limit and offset applied correctly
  // ==========================================================================

  describe('getPaperTrades', () => {
    it('maps trade row fields with correct type conversions', async () => {
      // First call: COUNT(*), second call: SELECT
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [makeTradeRow()] });

      const result = await paperDb.getPaperTrades('sess-001', 50, 0);

      expect(result.total).toBe(1);
      expect(result.trades).toHaveLength(1);

      const trade = result.trades[0];
      expect(trade.id).toBe(99);
      expect(trade.sessionId).toBe('sess-001');
      expect(trade.action).toBe('open_long');
      expect(trade.price).toBe(50_000);
      expect(trade.amount).toBe(0.1);
      expect(trade.timestamp).toBe(1_700_000_000_000);
      expect(trade.pnl).toBeNull();
      expect(trade.pnlPercent).toBeNull();
      expect(trade.fee).toBe(27.5);
      expect(trade.fundingIncome).toBe(0);
      expect(trade.balanceAfter).toBe(4_972.5);
    });

    it('respects limit and offset parameters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })  // total = 10
        .mockResolvedValueOnce({ rows: Array.from({ length: 5 }, (_, i) => makeTradeRow({ id: i + 1 })) });

      const result = await paperDb.getPaperTrades('sess-001', 5, 0);

      expect(result.total).toBe(10);
      expect(result.trades).toHaveLength(5);

      // Verify the query was called with correct LIMIT and OFFSET
      const secondCall = mockQuery.mock.calls[1];
      expect(secondCall[1]).toContain(5);  // limit
      expect(secondCall[1]).toContain(0);  // offset
    });

    it('with offset: skips first N trades', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '10' }] })
        .mockResolvedValueOnce({ rows: Array.from({ length: 5 }, (_, i) => makeTradeRow({ id: i + 6 })) });

      const result = await paperDb.getPaperTrades('sess-001', 5, 5);

      expect(result.total).toBe(10);
      expect(result.trades).toHaveLength(5);

      // Check offset was passed to query
      const secondCall = mockQuery.mock.calls[1];
      expect(secondCall[1]).toContain(5);  // offset value
    });

    it('returns empty trades array with correct total when offset exceeds total', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await paperDb.getPaperTrades('sess-001', 50, 100);

      expect(result.total).toBe(3);
      expect(result.trades).toHaveLength(0);
    });

    it('maps pnl and pnlPercent when present', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [makeTradeRow({ pnl: '125.50', pnl_percent: '2.5' })],
        });

      const result = await paperDb.getPaperTrades('sess-001', 50, 0);
      const trade = result.trades[0];

      expect(trade.pnl).toBe(125.5);
      expect(trade.pnlPercent).toBe(2.5);
    });
  });

  // ==========================================================================
  // 5. savePaperPosition: calls SQL with correct params
  // ==========================================================================

  describe('savePaperPosition', () => {
    it('calls INSERT with correct field order', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const position: Omit<PaperPosition, 'id'> = {
        sessionId: 'sess-001',
        symbol: 'BTC/USDT',
        direction: 'long',
        subStrategyKey: 'mock-strategy:BTC/USDT:4h',
        entryPrice: 50_000,
        amount: 0.1,
        entryTime: 1_700_000_000_000,
        unrealizedPnl: 0,
        fundingAccumulated: 0,
      };

      await paperDb.savePaperPosition(position);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO paper_positions');
      expect(params).toContain('sess-001');
      expect(params).toContain('BTC/USDT');
      expect(params).toContain('long');
      expect(params).toContain(50_000);
    });
  });

  // ==========================================================================
  // 6. savePaperTrade: returns trade with generated id
  // ==========================================================================

  describe('savePaperTrade', () => {
    it('returns trade with id from DB response', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeTradeRow({ id: 555 })],
      });

      const saved = await paperDb.savePaperTrade({
        sessionId: 'sess-001',
        symbol: 'BTC/USDT',
        action: 'open_long',
        price: 50_000,
        amount: 0.1,
        timestamp: 1_700_000_000_000,
        pnl: null,
        pnlPercent: null,
        fee: 27.5,
        fundingIncome: 0,
        balanceAfter: 4_972.5,
      });

      expect(saved.id).toBe(555);
      expect(saved.action).toBe('open_long');
      expect(saved.price).toBe(50_000);
    });
  });

  // ==========================================================================
  // 7. updatePaperSession: sends correct SET clause with provided updates
  // ==========================================================================

  describe('updatePaperSession', () => {
    it('does nothing if no updates provided', async () => {
      await paperDb.updatePaperSession('sess-001', {});
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('includes only provided fields in SET clause', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await paperDb.updatePaperSession('sess-001', {
        status: 'running',
        currentEquity: 10_500,
      });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('status');
      expect(sql).toContain('current_equity');
      expect(sql).not.toContain('current_cash');
      expect(params).toContain('running');
      expect(params).toContain(10_500);
    });

    it('always includes updated_at in SET clause', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await paperDb.updatePaperSession('sess-001', { status: 'paused' });

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('updated_at');
    });
  });

  // ==========================================================================
  // 8. deletePaperSession: returns true when row deleted, false when not found
  // ==========================================================================

  describe('deletePaperSession', () => {
    it('returns true when session was deleted', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      const result = await paperDb.deletePaperSession('sess-001');
      expect(result).toBe(true);
    });

    it('returns false when session not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });
      const result = await paperDb.deletePaperSession('does-not-exist');
      expect(result).toBe(false);
    });
  });
});
