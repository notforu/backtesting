/**
 * Integration tests for intra-bar SL/TP in the backtesting engine.
 *
 * These tests exercise the engine's SL/TP tracking by running runBacktest()
 * with mock strategies that call ctx.setStopLoss / ctx.setTakeProfit.
 *
 * All DB/network calls are mocked via vi.mock so no real I/O occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBacktest, createBacktestConfig } from '../engine.js';
import type { StrategyContext } from '../../strategy/base.js';
import type { Strategy } from '../../strategy/base.js';
import type { Order } from '../types.js';

// ============================================================================
// Mocks — DB, providers, strategy loader
// ============================================================================

// Mock the db module (getCandles, saveCandles, getCandleDateRange, saveBacktestRun, getFundingRates)
vi.mock('../../data/db.js', () => ({
  getCandles: vi.fn().mockResolvedValue([]),
  saveCandles: vi.fn().mockResolvedValue(undefined),
  saveBacktestRun: vi.fn().mockResolvedValue(undefined),
  getCandleDateRange: vi.fn().mockResolvedValue({ start: null, end: null }),
  getFundingRates: vi.fn().mockResolvedValue([]),
}));

// Mock the providers/index so no real exchange calls happen
vi.mock('../../data/providers/index.js', () => ({
  getProvider: vi.fn().mockReturnValue({
    fetchCandles: vi.fn().mockResolvedValue([]),
    fetchTradingFees: vi.fn().mockResolvedValue({ taker: 0.001, maker: 0.001 }),
  }),
}));

// Mock the strategy loader — we inject the strategy via preloadedStrategy
vi.mock('../../strategy/loader.js', () => ({
  loadStrategy: vi.fn().mockResolvedValue(null),
}));

// ============================================================================
// Helpers
// ============================================================================

import type { Candle } from '../types.js';

function makeCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number
): Candle {
  return { timestamp, open, high, low, close, volume: 1000 };
}

/**
 * Build a minimal engine config for testing.
 */
function makeConfig(overrides?: { symbol?: string; timeframe?: Candle['timestamp'] }) {
  return createBacktestConfig({
    strategyName: 'test-strategy',
    symbol: overrides?.symbol ?? 'BTC/USDT',
    startDate: 0,
    endDate: 1_000_000,
    initialCapital: 10_000,
    exchange: 'binance',
    mode: 'spot',
  });
}

/**
 * Minimal strategy that does nothing by default.
 */
function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    name: 'test-strategy',
    description: 'Test',
    version: '1.0.0',
    params: [],
    onBar: vi.fn(),
    ...overrides,
  };
}

/**
 * Common engine options: skip DB/fee/validation overhead.
 */
const FAST_ENGINE = {
  saveResults: false,
  skipFeeFetch: true,
  skipFundingRateValidation: true,
  skipCandleValidation: true,
  broker: { slippagePercent: 0, feeRate: 0.001 },
};

// ============================================================================
// Test 25: SL triggered on next bar — position closed at SL price
// ============================================================================

describe('Engine SL/TP integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test 25: SL triggered on next bar: position closed at SL price not close', async () => {
    // Bar 0: open long at 100
    // Bar 1: candle goes low=85 (hits SL=90), close=95 → should exit at 90, not 95
    const candles: Candle[] = [
      makeCandle(0, 100, 105, 98, 100),  // bar 0: open long, set SL=90
      makeCandle(60000, 95, 98, 85, 95), // bar 1: low=85 triggers SL=90
      makeCandle(120000, 95, 98, 93, 96), // bar 2: should not trigger
    ];

    const positionAmount = 0.5; // amount to trade
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          // Bar 0: open long and set SL
          ctx.openLong(positionAmount);
          ctx.setStopLoss(90);
        }
        // bar 2 onwards: nothing
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // Should have 2 trades: OPEN_LONG + CLOSE_LONG
    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90); // closed at SL, not at bar 1 close (95)
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('test 26: TP triggered on next bar: position closed at TP price not close', async () => {
    // Bar 0: open long at 100, set TP=115
    // Bar 1: candle goes high=120 (hits TP=115), close=110 → exit at 115
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 120, 98, 110),
      makeCandle(120000, 110, 112, 108, 111),
    ];

    const positionAmount = 0.5;
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(positionAmount);
          ctx.setTakeProfit(115);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(115); // closed at TP
    expect(closeTrade!.exitReason).toBe('take_profit');
  });

  it('test 27: neither triggered: position stays open, strategy onBar sees position', async () => {
    // SL=85, TP=120; bar 1 has low=90 > SL=85 and high=110 < TP=120 → no exit
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 110, 90, 105), // not triggering
    ];

    const seenLongPosition: Array<boolean> = [];
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(85);
          ctx.setTakeProfit(120);
        } else {
          seenLongPosition.push(ctx.longPosition !== null);
        }
      },
    });

    await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // Strategy saw position still open on bar 2
    expect(seenLongPosition).toHaveLength(1);
    expect(seenLongPosition[0]).toBe(true);
  });

  it('test 28: strategy updates SL (trailing stop): new SL used on next bar', async () => {
    // Bar 0: open long at 100, set SL=90
    // Bar 1: price rises, update SL=98 (trailing), candle is fine (low=99)
    // Bar 2: candle low=97 triggers updated SL=98
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 110, 99, 108),  // update SL to 98
      makeCandle(120000, 108, 110, 97, 100), // low=97 triggers SL=98
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        } else if (callCount === 2) {
          // Trailing stop update
          ctx.setStopLoss(98);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(98); // closed at updated SL=98
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('test 29: strategy clears SL/TP (null): no engine exit', async () => {
    // Bar 0: open long, set SL=90
    // Bar 1: clear SL, candle low=85 would have triggered it
    // Bar 2: manually close
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 85, 95),  // would trigger SL=90, but we clear it on bar 0→1
      makeCandle(120000, 95, 98, 93, 96),   // manual close
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
          // Immediately clear SL (simulate changed mind)
          ctx.setStopLoss(null);
        } else if (callCount === 3 && ctx.longPosition) {
          ctx.closeLong();
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // 2 trades: open + close; no stop_loss exit
    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.exitReason).toBeUndefined(); // normal signal close
    // Closed at bar 3's close price (96), not at 90
    expect(closeTrade!.price).toBe(96);
  });

  it('test 30: position closed by strategy, SL/TP automatically cleared', async () => {
    // Bar 0: open long, set SL=90
    // Bar 1: strategy manually closes long
    // Bar 2: candle would have triggered SL=90 but position is gone
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 105, 98, 102),
      makeCandle(120000, 100, 102, 85, 95), // SL would hit if position open
    ];

    let callCount = 0;
    const closedTrades: number[] = [];
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        } else if (callCount === 2 && ctx.longPosition) {
          ctx.closeLong();
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrades = result.trades.filter(t => t.action === 'CLOSE_LONG');
    // Only 1 close trade (the strategy-initiated one), no SL exit on bar 2
    expect(closeTrades).toHaveLength(1);
    expect(closeTrades[0].price).toBe(102); // bar 1 close price
    expect(closeTrades[0].exitReason).toBeUndefined();
  });

  it('test 31: SL triggered → strategy onBar sees no position → can open new position same bar', async () => {
    // Bar 0: open long, set SL=90
    // Bar 1: SL triggered at 90; strategy.onBar should see no position and can open new one
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 85, 95), // SL=90 hit
      makeCandle(120000, 95, 98, 93, 96),
    ];

    let seenPositionOnBar2: boolean | null = null;
    let openedNewOnBar2 = false;
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        } else if (callCount === 2) {
          // After engine-managed SL exit, ctx should show no position
          seenPositionOnBar2 = ctx.longPosition !== null;
          if (ctx.longPosition === null) {
            // Open a new position
            ctx.openLong(0.3);
            openedNewOnBar2 = true;
          }
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    expect(seenPositionOnBar2).toBe(false); // no position after SL exit
    expect(openedNewOnBar2).toBe(true);

    const openTrades = result.trades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(2); // original + re-entry
  });

  it('test 32: strategy.onOrderFilled called after engine-managed SL exit', async () => {
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 85, 95), // SL=90 hit
    ];

    const filledOrders: Order[] = [];
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        }
      },
      onOrderFilled(ctx: StrategyContext, order: Order) {
        filledOrders.push(order);
      },
    });

    await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // onOrderFilled should have been called for:
    // 1. OPEN_LONG (bar 0)
    // 2. CLOSE_LONG from SL exit (bar 1)
    expect(filledOrders.length).toBeGreaterThanOrEqual(1);
    // At minimum, there should be a close order
    const closeOrders = filledOrders.filter(o => o.side === 'sell');
    expect(closeOrders.length).toBeGreaterThanOrEqual(1);
  });

  it('test 33: equity recorded correctly after engine-managed SL exit', async () => {
    // Position at 100, SL at 90, bar 1 hits SL → equity should reflect exit at 90
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 85, 95), // SL=90 hit
    ];

    const posAmount = 0.5;
    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(posAmount);
          ctx.setStopLoss(90);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // Check that equity curve has data points for both bars
    expect(result.equity.length).toBeGreaterThanOrEqual(1);

    // The CLOSE_LONG trade should reflect the SL exit price
    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90);

    // PnL should be negative (bought at 100, sold at 90 minus fee)
    expect(closeTrade!.pnl).toBeDefined();
    expect(closeTrade!.pnl!).toBeLessThan(0);
  });

  it('test 34: slippage applied to SL/TP fill price', async () => {
    // SL=90, slippage=0.1% → actual fill should be 90 * (1 - 0.001) = 89.91 for long (selling worse)
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 85, 95), // SL=90 hit
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      broker: { slippagePercent: 0.1, feeRate: 0 }, // 0.1% slippage
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    // SL=90, slippage 0.1% on sell → 90 * (1 - 0.001) = 89.91
    const expectedFillPrice = 90 * (1 - 0.001);
    expect(closeTrade!.price).toBeCloseTo(expectedFillPrice, 5);
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('test 35: both SL and TP triggered, no sub-candles: pessimistic fill (SL wins)', async () => {
    // Bar 1: low=85 (SL=90 hit) AND high=115 (TP=112 hit) on same bar
    // No sub-candles → pessimistic: SL wins
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 115, 85, 100), // both triggered
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
          ctx.setTakeProfit(112);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
      // null disables sub-candle fetching → pessimistic fill
      intraBarTimeframe: null,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90); // SL wins
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('test 36: both triggered with sub-candles: correct resolution', async () => {
    // Bar 1 (timestamp=60000, timeframe=1h so duration=3600000ms):
    // both SL=90 and TP=112 triggered on main bar (low=85, high=115)
    // Sub-candles show TP hits first: sub1 has high=113 (TP hit), sub2 has low=88 (SL hit)

    // Use 1h main timeframe so getSubTimeframe gives '1m'
    const config = createBacktestConfig({
      strategyName: 'test-strategy',
      symbol: 'BTC/USDT',
      startDate: 0,
      endDate: 1_000_000,
      initialCapital: 10_000,
      exchange: 'binance',
      mode: 'spot',
      timeframe: '1h',
    });

    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 115, 85, 100), // both triggered on main bar
    ];

    // Sub-candles for bar 1's range. TP (112) is hit first chronologically.
    const subCandles: Candle[] = [
      makeCandle(3_600_000, 100, 113, 100, 112), // high=113 >= TP=112 → TP hit
      makeCandle(3_660_000, 112, 112, 88, 90),   // low=88 <= SL=90 → SL hit (later)
    ];

    // Mock getCandles: sub-candle query returns the sub-candles on the first call
    const { getCandles } = await import('../../data/db.js');
    vi.mocked(getCandles).mockResolvedValueOnce(subCandles);

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
          ctx.setTakeProfit(112);
        }
      },
    });

    const result = await runBacktest(config, {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(112); // TP wins (hit first per sub-candles)
    expect(closeTrade!.exitReason).toBe('take_profit');
  });

  it('short position SL triggered: closed at SL price', async () => {
    // Open short at 100, SL=115 (above entry)
    // Bar 1: high=118 triggers SL
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 118, 95, 100), // high=118 triggers SL=115
      makeCandle(120000, 100, 102, 98, 101),
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openShort(0.5);
          ctx.setStopLoss(115);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_SHORT');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(115); // SL level
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('short position TP triggered: closed at TP price', async () => {
    // Open short at 100, TP=85 (below entry)
    // Bar 1: low=82 triggers TP
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 100, 82, 90), // low=82 triggers TP=85
      makeCandle(120000, 90, 92, 88, 91),
    ];

    let callCount = 0;
    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        callCount++;
        if (callCount === 1) {
          ctx.openShort(0.5);
          ctx.setTakeProfit(85);
        }
      },
    });

    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_SHORT');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(85); // TP level
    expect(closeTrade!.exitReason).toBe('take_profit');
  });

  it('setStopLoss and setTakeProfit are no-ops when no position exists', async () => {
    // Setting SL/TP without a position should not throw
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(60000, 100, 102, 98, 101),
    ];

    const strategy = makeStrategy({
      onBar(ctx: StrategyContext) {
        // Call set SL/TP without any open position
        ctx.setStopLoss(90);
        ctx.setTakeProfit(115);
      },
    });

    // Should not throw
    const result = await runBacktest(makeConfig(), {
      ...FAST_ENGINE,
      preloadedCandles: candles,
      preloadedStrategy: strategy,
    });

    // No trades
    expect(result.trades).toHaveLength(0);
  });
});
