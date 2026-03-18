/**
 * Risk Integration Tests
 *
 * Tests the integration between PaperTradingEngine and RiskManager.
 * Uses the same mock setup as engine.test.ts (mocked DB, live-data, strategy loader).
 *
 * Focused on:
 * 1. Engine works without RiskManager (backward compat)
 * 2. Trade rejected when RiskManager denies it
 * 3. Kill switch triggers on equity drop > threshold
 * 4. Kill switch pauses the engine
 * 5. Kill switch emits kill_switch_triggered event
 * 6. RiskManager tracks position count through open/close cycle
 * 7. RiskManager equity is updated on each tick
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Candle } from '../../core/types.js';
import type { PaperSession, PaperPosition, PaperTrade, PaperTradingEvent } from '../types.js';
import type { AggregateBacktestConfig } from '../../core/signal-types.js';

// ============================================================================
// Helpers (same as engine.test.ts)
// ============================================================================

function makeCandle(close: number, timestamp: number): Candle {
  return { timestamp, open: close, high: close + 5, low: close - 5, close, volume: 1000 };
}

function makeFreshCandles(count: number, closePrice: number): Candle[] {
  const tfMs = 4 * 60 * 60 * 1000;
  const now = Date.now();
  const latestTs = Math.floor(now / tfMs) * tfMs - tfMs;

  const candles: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    candles.push(makeCandle(closePrice, latestTs - i * tfMs));
  }
  return candles;
}

function makePaperSession(overrides: Partial<PaperSession> = {}): PaperSession {
  const config: AggregateBacktestConfig = {
    subStrategies: [
      {
        strategyName: 'mock-strategy',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: {},
        exchange: 'bybit',
      },
    ],
    allocationMode: 'single_strongest',
    maxPositions: 1,
    initialCapital: 10_000,
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    exchange: 'bybit',
    mode: 'spot',
  };

  return {
    id: 'test-session-risk',
    name: 'Risk Test Session',
    aggregationConfig: config,
    aggregationConfigId: null,
    strategyConfigId: null,
    status: 'stopped',
    initialCapital: 10_000,
    currentEquity: 10_000,
    currentCash: 10_000,
    tickCount: 0,
    lastTickAt: null,
    nextTickAt: null,
    errorMessage: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../db.js', () => ({
  getPaperSession: vi.fn(),
  getPaperPositions: vi.fn(),
  savePaperPosition: vi.fn(),
  deletePaperPosition: vi.fn(),
  savePaperTrade: vi.fn(),
  savePaperEquitySnapshot: vi.fn(),
  updatePaperSession: vi.fn(),
}));

vi.mock('../../strategy/loader.js', () => ({
  loadStrategy: vi.fn(),
}));

const mockFetchLatestCandles = vi.fn();
const mockFetchLatestFundingRates = vi.fn();
const mockFetchCurrentPrice = vi.fn();

vi.mock('../live-data.js', () => ({
  LiveDataFetcher: vi.fn().mockImplementation(function () {
    return {
      fetchLatestCandles: mockFetchLatestCandles,
      fetchLatestFundingRates: mockFetchLatestFundingRates,
      fetchCurrentPrice: mockFetchCurrentPrice,
    };
  }),
}));

// ============================================================================
// Imports (after vi.mock hoisting)
// ============================================================================

import { PaperTradingEngine } from '../engine.js';
import { RiskManager } from '../../risk/risk-manager.js';
import * as paperDb from '../db.js';
import * as strategyLoader from '../../strategy/loader.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';

// ============================================================================
// Test suite
// ============================================================================

describe('PaperTradingEngine — RiskManager integration', () => {
  let freshCandles: Candle[];
  let mockStrategy: Strategy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    freshCandles = makeFreshCandles(200, 50_000);

    mockStrategy = {
      name: 'mock-strategy',
      description: 'Mock',
      version: '1.0.0',
      params: [],
      onBar(_ctx: StrategyContext): void { /* no-op */ },
    };

    vi.mocked(strategyLoader.loadStrategy).mockResolvedValue(mockStrategy);

    mockFetchLatestCandles.mockResolvedValue(freshCandles);
    mockFetchLatestFundingRates.mockResolvedValue([]);
    mockFetchCurrentPrice.mockResolvedValue({ price: 50_000, timestamp: Date.now() });

    vi.mocked(paperDb.getPaperSession).mockResolvedValue(makePaperSession());
    vi.mocked(paperDb.getPaperPositions).mockResolvedValue([]);
    vi.mocked(paperDb.savePaperPosition).mockResolvedValue(undefined);
    vi.mocked(paperDb.deletePaperPosition).mockResolvedValue(undefined);
    vi.mocked(paperDb.savePaperEquitySnapshot).mockResolvedValue(undefined);
    vi.mocked(paperDb.updatePaperSession).mockResolvedValue(undefined);

    vi.mocked(paperDb.savePaperTrade).mockImplementation(async (trade) => ({
      id: 1,
      ...trade,
      pnl: trade.pnl ?? null,
      pnlPercent: trade.pnlPercent ?? null,
    } as PaperTrade));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Backward compatibility — engine works without RiskManager
  // ==========================================================================

  it('engine runs a full tick with no signals when no RiskManager is attached', async () => {
    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);
    // Deliberately do NOT call setRiskManager

    const result = await engine.forceTick();

    expect(result.tradesOpened).toHaveLength(0);
    expect(result.equity).toBeCloseTo(10_000, 2);
    // Sanity: DB snapshot was saved, no RiskManager errors
    expect(paperDb.savePaperEquitySnapshot).toHaveBeenCalledOnce();
  });

  it('engine executes trade without RiskManager attached', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);
    // No RiskManager

    const result = await engine.forceTick();

    expect(result.tradesOpened).toHaveLength(1);
    expect(result.tradesOpened[0].action).toBe('open_long');
  });

  // ==========================================================================
  // 2. Trade rejected when RiskManager denies it
  // ==========================================================================

  it('trade is rejected when kill switch is already triggered on RiskManager', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 10_000 * 0.5,
      maxPositions: 5,
      killSwitchEnabled: true,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    // Manually trigger the kill switch via equity drop
    rm.onEquityUpdate(10_000);  // set peak
    rm.onEquityUpdate(6_000);   // 40% drawdown > 30% threshold
    rm.checkKillSwitch();       // trigger

    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    const result = await engine.forceTick();

    // Trade should be rejected
    expect(result.tradesOpened).toHaveLength(0);
    expect(paperDb.savePaperTrade).not.toHaveBeenCalled();

    // trade_rejected event should have been emitted
    const rejected = events.filter(e => e.type === 'trade_rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as Extract<PaperTradingEvent, { type: 'trade_rejected' }>).symbol).toBe('BTC/USDT');
    expect((rejected[0] as Extract<PaperTradingEvent, { type: 'trade_rejected' }>).reason).toMatch(/kill switch/i);
  });

  it('trade is rejected when maxPositions limit is already reached on RiskManager', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 100_000,  // large cap so capital check doesn't trigger first
      maxTradeSize: 100_000, // large limit so size check doesn't trigger first
      maxPositions: 1,       // allow only 1 position
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    // Simulate 1 position already open — fills the maxPositions slot
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 1_000 });

    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    const result = await engine.forceTick();

    expect(result.tradesOpened).toHaveLength(0);
    const rejected = events.filter(e => e.type === 'trade_rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as Extract<PaperTradingEvent, { type: 'trade_rejected' }>).reason).toMatch(/maxPositions/i);
  });

  it('trade is rejected when maxTradeSize is exceeded', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 100,  // tiny limit — well below the ~9000 capital-per-trade
      maxPositions: 5,
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });

    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    const result = await engine.forceTick();

    expect(result.tradesOpened).toHaveLength(0);
    const rejected = events.filter(e => e.type === 'trade_rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as Extract<PaperTradingEvent, { type: 'trade_rejected' }>).reason).toMatch(/maxTradeSize/i);
  });

  // ==========================================================================
  // 3. Kill switch triggers on equity drop > threshold
  // ==========================================================================

  it('kill switch triggers when equity drops by more than threshold after a tick', async () => {
    // The engine will compute equity = initialCapital = 10_000 after the tick.
    // We pre-set RiskManager peak equity to simulate a prior high.
    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 5_000,
      maxPositions: 5,
      killSwitchEnabled: true,
      killSwitchDDPercent: 10,  // 10% drawdown threshold
      symbolWhitelist: [],
    });
    // Set peak to $15,000, current tick equity will be $10,000 => 33% drawdown
    rm.onEquityUpdate(15_000);
    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    await engine.forceTick();

    // Kill switch should have been triggered
    const ksEvents = events.filter(e => e.type === 'kill_switch_triggered');
    expect(ksEvents).toHaveLength(1);

    const ksEvent = ksEvents[0] as Extract<PaperTradingEvent, { type: 'kill_switch_triggered' }>;
    expect(ksEvent.equity).toBeCloseTo(10_000, 0);
    expect(ksEvent.reason).toMatch(/drawdown/i);
  });

  // ==========================================================================
  // 4. Kill switch pauses the engine
  // ==========================================================================

  it('engine is paused after kill switch triggers', async () => {
    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);
    await engine.start();  // put engine in running state

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 5_000,
      maxPositions: 5,
      killSwitchEnabled: true,
      killSwitchDDPercent: 10,
      symbolWhitelist: [],
    });
    rm.onEquityUpdate(15_000);  // set high peak
    engine.setRiskManager(rm);

    // Engine should be running before tick
    expect(engine.status).toBe('running');

    await engine.forceTick();

    // After kill switch, engine should be paused
    expect(engine.status).toBe('paused');
  });

  // ==========================================================================
  // 5. Kill switch emits event with correct payload
  // ==========================================================================

  it('kill_switch_triggered event has correct sessionId, reason, and equity', async () => {
    const session = makePaperSession({ id: 'ks-session-123', initialCapital: 20_000, currentEquity: 20_000, currentCash: 20_000 });
    vi.mocked(paperDb.getPaperSession).mockResolvedValue(session);

    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 20_000,
      maxTradeSize: 10_000,
      maxPositions: 5,
      killSwitchEnabled: true,
      killSwitchDDPercent: 5,   // 5% — very sensitive
      symbolWhitelist: [],
    });
    rm.onEquityUpdate(25_000);  // peak
    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    await engine.forceTick();

    const ksEvents = events.filter(e => e.type === 'kill_switch_triggered');
    expect(ksEvents).toHaveLength(1);

    const ksEvent = ksEvents[0] as Extract<PaperTradingEvent, { type: 'kill_switch_triggered' }>;
    expect(ksEvent.sessionId).toBe('ks-session-123');
    expect(ksEvent.reason).toBeTruthy();
    expect(typeof ksEvent.equity).toBe('number');
    expect(ksEvent.equity).toBeGreaterThan(0);
  });

  // ==========================================================================
  // 6. RiskManager tracks position count through open/close cycle
  // ==========================================================================

  it('RiskManager position count increments when trade opens', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 10_000,
      maxPositions: 5,
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    engine.setRiskManager(rm);

    // Before tick: 0 positions tracked by RM
    expect(rm.getState().openPositionCount).toBe(0);

    const result = await engine.forceTick();

    // After opening trade: 1 position tracked by RM
    expect(result.tradesOpened).toHaveLength(1);
    expect(rm.getState().openPositionCount).toBe(1);
  });

  it('RiskManager position count decrements when onTradeClosed is called', async () => {
    // Verify the RM state machine directly:
    // open a position, then close it, and check count transitions.
    // The engine integration (calling onTradeClosed after portfolio.closeLong/Short)
    // is tested via the engine's trade-close path above.
    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 10_000,
      maxPositions: 5,
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });

    expect(rm.getState().openPositionCount).toBe(0);

    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 9_000 });
    expect(rm.getState().openPositionCount).toBe(1);

    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: 100 });
    expect(rm.getState().openPositionCount).toBe(0);
  });

  it('engine calls onTradeClosed on RiskManager after closing a position via exit signal', async () => {
    // Test uses the same pattern as engine.test.ts's "tick with exit signal" test:
    // create an engine with a pre-existing DB position, call start() to restore
    // portfolio state, then run forceTick() with a close strategy signal.

    const entryPrice = 40_000;
    const existingPosition: PaperPosition = {
      id: 1,
      sessionId: 'test-session-risk',
      symbol: 'BTC/USDT',
      direction: 'long',
      subStrategyKey: 'mock-strategy:BTC/USDT:4h',
      entryPrice,
      amount: 0.1,
      entryTime: Date.now() - 86400000,
      unrealizedPnl: 0,
      fundingAccumulated: 0,
      stopLoss: null,
      takeProfit: null,
    };

    const sessionWithPosition = makePaperSession({ currentCash: 6_000, currentEquity: 10_000 });
    vi.mocked(paperDb.getPaperSession).mockResolvedValue(sessionWithPosition);
    vi.mocked(paperDb.getPaperPositions).mockResolvedValue([existingPosition]);

    // Strategy: close existing long
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (ctx.longPosition) ctx.closeLong();
    };

    const engine = new PaperTradingEngine(sessionWithPosition);
    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 10_000,
      maxPositions: 5,
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    // Pre-seed RM: 1 position already tracked (matches the DB position)
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 4_000 });
    expect(rm.getState().openPositionCount).toBe(1);
    engine.setRiskManager(rm);

    // start() restores portfolio from DB (so hasRealPosition = true)
    await engine.start();

    const result = await engine.forceTick();

    expect(result.tradesClosed).toHaveLength(1);
    expect(result.tradesClosed[0].action).toBe('close_long');
    // RM should now report 0 open positions
    expect(rm.getState().openPositionCount).toBe(0);
  });

  // ==========================================================================
  // 7. RiskManager equity is updated on each tick
  // ==========================================================================

  it('RiskManager currentEquity matches portfolio equity after each tick', async () => {
    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 5_000,
      maxPositions: 5,
      killSwitchEnabled: false,
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    engine.setRiskManager(rm);

    // Before any tick, equity is 0 (never updated)
    expect(rm.getState().currentEquity).toBe(0);

    await engine.forceTick();

    // After tick, equity should match the session's initial capital
    // (no trades, no PnL change => equity = initialCapital)
    expect(rm.getState().currentEquity).toBeCloseTo(10_000, 0);
  });

  // ==========================================================================
  // 8. Trade allowed when RiskManager permits it
  // ==========================================================================

  it('trade proceeds normally when RiskManager permits it', async () => {
    mockStrategy.onBar = (ctx: StrategyContext) => {
      if (!ctx.longPosition) ctx.openLong(1);
    };

    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 10_000,  // large limit — allows trade
      maxPositions: 5,
      killSwitchEnabled: false,  // kill switch off
      killSwitchDDPercent: 30,
      symbolWhitelist: [],
    });
    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    const result = await engine.forceTick();

    expect(result.tradesOpened).toHaveLength(1);
    expect(events.filter(e => e.type === 'trade_rejected')).toHaveLength(0);
    expect(rm.getState().openPositionCount).toBe(1);
  });

  // ==========================================================================
  // 9. Kill switch does NOT trigger when disabled
  // ==========================================================================

  it('kill switch does not trigger when killSwitchEnabled is false, even with huge drawdown', async () => {
    const session = makePaperSession();
    const engine = new PaperTradingEngine(session);

    const rm = new RiskManager({
      maxCapital: 10_000,
      maxTradeSize: 5_000,
      maxPositions: 5,
      killSwitchEnabled: false,  // disabled
      killSwitchDDPercent: 1,    // would normally trigger at 1% DD
      symbolWhitelist: [],
    });
    rm.onEquityUpdate(1_000_000);  // set absurdly high peak
    engine.setRiskManager(rm);

    const events: PaperTradingEvent[] = [];
    engine.on('paper-event', (e: PaperTradingEvent) => events.push(e));

    await engine.forceTick();

    // No kill switch event should be emitted
    expect(events.filter(e => e.type === 'kill_switch_triggered')).toHaveLength(0);
    // Engine should still be in stopped state (forceTick doesn't change status)
    expect(engine.status).toBe('stopped');
  });
});
