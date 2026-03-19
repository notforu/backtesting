/**
 * Unit tests for runCoreBacktestLoop() — the pure, injectable backtest loop.
 *
 * All tests operate entirely in-memory: no DB, no network, no filesystem.
 * Strategies are simple vi.fn() mocks. Candles are synthetic with known prices.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCoreBacktestLoop } from '../engine.js';
import type { CoreBacktestInput } from '../engine.js';
import type { Candle, FundingRate } from '../types.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { BrokerConfig } from '../broker.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle {
  return { timestamp, open, high, low, close, volume };
}

/**
 * Candles at hourly intervals with flat prices (no movement).
 * Useful for testing accounting without price effects.
 */
function makeFlatCandles(count: number, price: number, startTs = 0): Candle[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandle(startTs + i * 3600_000, price, price, price, price)
  );
}

/**
 * Build a minimal valid CoreBacktestInput with sensible defaults.
 */
function makeInput(overrides: Partial<CoreBacktestInput> = {}): CoreBacktestInput {
  const candles = makeFlatCandles(5, 100);
  return {
    config: {
      id: 'test-id',
      strategyName: 'test-strategy',
      symbol: 'BTC/USDT',
      timeframe: '1h',
      startDate: candles[0].timestamp,
      endDate: candles[candles.length - 1].timestamp,
      initialCapital: 10_000,
      exchange: 'binance',
      params: {},
    },
    candles,
    strategy: makeStrategy(),
    params: {},
    fundingRates: [],
    brokerConfig: { feeRate: 0, slippagePercent: 0 },
    leverage: 1,
    initialCapital: 10_000,
    enableLogging: false,
    ...overrides,
  };
}

/**
 * Build a minimal Strategy with all lifecycle methods as vi.fn().
 */
function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    name: 'test-strategy',
    description: 'Test',
    version: '1.0.0',
    params: [],
    init: vi.fn(),
    onBar: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// 1. Strategy lifecycle
// ============================================================================

describe('runCoreBacktestLoop — strategy lifecycle', () => {
  it('calls init() once at the start', async () => {
    const init = vi.fn();
    const strategy = makeStrategy({ init });
    await runCoreBacktestLoop(makeInput({ strategy, candles: makeFlatCandles(3, 100) }));
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('calls onBar() exactly once per candle', async () => {
    const onBar = vi.fn();
    const strategy = makeStrategy({ onBar });
    const candles = makeFlatCandles(7, 100);
    await runCoreBacktestLoop(makeInput({ strategy, candles }));
    expect(onBar).toHaveBeenCalledTimes(7);
  });

  it('calls onEnd() once at the end', async () => {
    const onEnd = vi.fn();
    const strategy = makeStrategy({ onEnd });
    await runCoreBacktestLoop(makeInput({ strategy, candles: makeFlatCandles(4, 100) }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call init() when strategy has no init method', async () => {
    const strategy = makeStrategy({ init: undefined });
    // Should not throw
    const output = await runCoreBacktestLoop(makeInput({ strategy }));
    expect(output.barsProcessed).toBe(5);
  });

  it('does not call onEnd() when strategy has no onEnd method', async () => {
    const strategy = makeStrategy({ onEnd: undefined });
    const output = await runCoreBacktestLoop(makeInput({ strategy }));
    expect(output.barsProcessed).toBe(5);
  });

  it('onBar() receives correct currentIndex for each bar', async () => {
    const seenIndices: number[] = [];
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        seenIndices.push(ctx.currentIndex);
      }),
    });
    const candles = makeFlatCandles(4, 100);
    await runCoreBacktestLoop(makeInput({ strategy, candles }));
    expect(seenIndices).toEqual([0, 1, 2, 3]);
  });

  it('onBar() receives currentCandle with correct timestamp', async () => {
    const seenTimestamps: number[] = [];
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        seenTimestamps.push(ctx.currentCandle.timestamp);
      }),
    });
    const candles = makeFlatCandles(3, 100, 1_000_000);
    await runCoreBacktestLoop(makeInput({ strategy, candles }));
    expect(seenTimestamps).toEqual([
      1_000_000,
      1_000_000 + 3_600_000,
      1_000_000 + 7_200_000,
    ]);
  });
});

// ============================================================================
// 2. Loop bounds (no off-by-one)
// ============================================================================

describe('runCoreBacktestLoop — loop bounds', () => {
  it('processes all candles including the last bar', async () => {
    const onBar = vi.fn();
    const strategy = makeStrategy({ onBar });
    const candles = makeFlatCandles(5, 100);
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    expect(onBar).toHaveBeenCalledTimes(5);
    expect(output.barsProcessed).toBe(5);
  });

  it('equity curve has one entry per processed bar', async () => {
    const candles = makeFlatCandles(6, 100);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.equity).toHaveLength(6);
  });

  it('equity timestamps match candle timestamps', async () => {
    const candles = makeFlatCandles(4, 100, 2_000_000);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    const eqTs = output.equity.map(e => e.timestamp);
    const candleTs = candles.map(c => c.timestamp);
    expect(eqTs).toEqual(candleTs);
  });

  it('last equity point corresponds to the last candle', async () => {
    const candles = makeFlatCandles(5, 100);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.equity[output.equity.length - 1].timestamp).toBe(
      candles[candles.length - 1].timestamp,
    );
  });

  it('barsProcessed equals candles.length when no early stop', async () => {
    const candles = makeFlatCandles(10, 100);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.barsProcessed).toBe(10);
  });
});

// ============================================================================
// 3. Early stop
// ============================================================================

describe('runCoreBacktestLoop — early stop', () => {
  it('terminates early when equity drops below threshold', async () => {
    // Strategy opens a large losing position on bar 0 that wipes out >70% of capital
    // We'll simulate this by opening a very large short against a rising price
    // But easier: use a zero-value position scenario
    //
    // Simpler approach: run with earlyStopEquityFraction=1.0 which means
    // stop if equity < 100% of initial capital. Since any trade fee will push
    // equity below that, early stop fires on bar 100.
    //
    // Let's build a scenario where equity definitely drops: price drops on every bar.
    // Strategy opens long at bar 0, price then collapses.
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(50); // buy 50 units at $100 = $5000 cost
          opened = true;
        }
      }),
    });

    // Make 300+ candles with price falling from 100 to effectively 0
    const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
      const price = Math.max(1, 100 - i * 1); // drops 1 per bar
      return makeCandle(i * 3_600_000, price, price, price, price);
    });

    // earlyStopEquityFraction=0.6 means stop when equity < 6000
    // Initial: 10000. After buying 50 @ 100 → cash = 5000, holding 50 units
    // As price falls: equity = cash + 50 * price
    // At price=20: equity = 5000 + 50*20 = 6000 → still at threshold
    // At price=19: equity = 5000 + 50*19 = 5950 → below 6000 → stop
    // Price drops at rate 1/bar: reaches 19 at bar ~81 (100 - 81 = 19)
    // Check happens every 100 bars, so first check at bar 0 (equity=10000 still ok after open)
    // and at bar 100 price=0 (clamped to 1) → equity = 5000 + 50*1 = 5050 < 6000 → stop
    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        earlyStopEquityFraction: 0.6,
      }),
    );

    expect(output.barsProcessed).toBeLessThan(300);
  });

  it('does not terminate early when earlyStopEquityFraction is undefined', async () => {
    const candles = makeFlatCandles(250, 1); // price=1, no trades → equity stays at 10000
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.barsProcessed).toBe(250);
  });

  it('does not terminate when equity stays above fraction', async () => {
    const candles = makeFlatCandles(250, 100);
    const output = await runCoreBacktestLoop(
      makeInput({ candles, earlyStopEquityFraction: 0.3 }),
    );
    expect(output.barsProcessed).toBe(250); // equity never drops below 30%
  });
});

// ============================================================================
// 4. Equity curve
// ============================================================================

describe('runCoreBacktestLoop — equity curve', () => {
  it('equity starts at initialCapital when no position is open', async () => {
    const candles = makeFlatCandles(3, 100);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.equity[0].equity).toBe(10_000);
  });

  it('equity reflects unrealized PnL of open long position', async () => {
    // Bar 0: open long 1 unit @ 100, price stays at 100 → equity = 9900 cash + 1*100 = 10000
    // (fee=0, so no decay)
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(1);
          opened = true;
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),       // bar 0: open long
      makeCandle(3_600_000, 110, 110, 110, 110), // bar 1: price rises to 110
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    // bar 1: cash = 10000 - 1*100 = 9900; equity = 9900 + 1*110 = 10010
    expect(output.equity[1].equity).toBeCloseTo(10_010, 2);
  });

  it('equity includes unrealized PnL of open short position', async () => {
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openShort(1);
          opened = true;
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),       // bar 0: open short
      makeCandle(3_600_000, 90, 90, 90, 90),    // bar 1: price drops to 90 → profit for short
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    // short equity: cash stays at 10000 (only fee deducted — fee=0 here)
    // short unrealizedPnl = (100 - 90) * 1 = +10
    // equity = 10000 + 10 = 10010
    expect(output.equity[1].equity).toBeCloseTo(10_010, 2);
  });
});

// ============================================================================
// 5. Trade execution
// ============================================================================

describe('runCoreBacktestLoop — trade execution', () => {
  it('records no trades when strategy does nothing', async () => {
    const output = await runCoreBacktestLoop(makeInput());
    expect(output.trades).toHaveLength(0);
  });

  it('records OPEN_LONG trade when strategy calls openLong', async () => {
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(0.5);
          opened = true;
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),
      makeCandle(3_600_000, 100, 100, 100, 100),
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const openTrade = output.trades.find(t => t.action === 'OPEN_LONG');
    expect(openTrade).toBeDefined();
    expect(openTrade!.amount).toBe(0.5);
    // Market orders fill at close price
    expect(openTrade!.price).toBe(100);
  });

  it('records CLOSE_LONG trade when strategy calls closeLong', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) ctx.openLong(0.5);
        if (callCount === 2 && ctx.longPosition) ctx.closeLong();
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),
      makeCandle(3_600_000, 110, 110, 110, 110),
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(110);
    expect(closeTrade!.pnl).toBeCloseTo(0.5 * (110 - 100), 5); // 5.0
  });

  it('records OPEN_SHORT and CLOSE_SHORT trades', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) ctx.openShort(1);
        if (callCount === 2 && ctx.shortPosition) ctx.closeShort();
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),
      makeCandle(3_600_000, 90, 90, 90, 90),
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    expect(output.trades.find(t => t.action === 'OPEN_SHORT')).toBeDefined();
    const closeTrade = output.trades.find(t => t.action === 'CLOSE_SHORT');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90);
    expect(closeTrade!.pnl).toBeCloseTo(100 - 90, 5); // 10.0
  });
});

// ============================================================================
// 6. Fee application
// ============================================================================

describe('runCoreBacktestLoop — fee application', () => {
  it('deducts entry fee from cash on open', async () => {
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(1); // buy 1 BTC at 100 → trade value = 100, fee = 0.1
          opened = true;
        }
      }),
    });
    const candles = makeFlatCandles(2, 100);
    const brokerConfig: BrokerConfig = { feeRate: 0.001, slippagePercent: 0 };
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles, brokerConfig }));

    const openTrade = output.trades.find(t => t.action === 'OPEN_LONG');
    expect(openTrade).toBeDefined();
    expect(openTrade!.fee).toBeCloseTo(0.1, 5); // 1 * 100 * 0.001
  });

  it('deducts exit fee from PnL on close', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) ctx.openLong(1);  // buy at 100
        if (callCount === 2) ctx.closeLong();  // sell at 110
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),
      makeCandle(3_600_000, 110, 110, 110, 110),
    ];
    const brokerConfig: BrokerConfig = { feeRate: 0.001, slippagePercent: 0 };
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles, brokerConfig }));

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    // grossPnl = (110-100)*1 = 10; fee = 110 * 0.001 = 0.11; netPnl = 10 - 0.11 = 9.89
    expect(closeTrade!.pnl).toBeCloseTo(9.89, 2);
    expect(closeTrade!.fee).toBeCloseTo(0.11, 4);
  });

  it('zero-fee run has no fee fields on trades', async () => {
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(1);
          opened = true;
        }
      }),
    });
    const candles = makeFlatCandles(2, 100);
    const brokerConfig: BrokerConfig = { feeRate: 0, slippagePercent: 0 };
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles, brokerConfig }));

    const openTrade = output.trades.find(t => t.action === 'OPEN_LONG');
    expect(openTrade!.fee).toBeUndefined();
  });
});

// ============================================================================
// 7. Funding rate processing
// ============================================================================

describe('runCoreBacktestLoop — funding rate processing', () => {
  it('long pays (negative income) when fundingRate is positive', async () => {
    // Bar 0: open long 1 unit @ 1000; bar 1: funding event at ts=1 with rate=+0.0001
    const TS_0 = 0;
    const TS_1 = 28_800_000; // 8h later = typical funding interval
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) {
          ctx.openLong(1);
          opened = true;
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(TS_0, 1000, 1000, 1000, 1000),
      makeCandle(TS_1, 1000, 1000, 1000, 1000),
    ];
    const fundingRates: FundingRate[] = [
      { timestamp: TS_1, fundingRate: 0.0001, markPrice: 1000 },
    ];

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        fundingRates,
        config: {
          id: 'test',
          strategyName: 'test',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          startDate: TS_0,
          endDate: TS_1,
          initialCapital: 10_000,
          exchange: 'binance',
          params: {},
          mode: 'futures',
        },
      }),
    );

    // Long pays: payment = -1 * 1000 * 0.0001 = -0.1
    expect(output.totalFundingIncome).toBeCloseTo(-0.1, 6);
  });

  it('long receives (positive income) when fundingRate is negative', async () => {
    const TS_0 = 0;
    const TS_1 = 28_800_000;
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) { ctx.openLong(1); opened = true; }
      }),
    });
    const candles: Candle[] = [
      makeCandle(TS_0, 1000, 1000, 1000, 1000),
      makeCandle(TS_1, 1000, 1000, 1000, 1000),
    ];
    const fundingRates: FundingRate[] = [
      { timestamp: TS_1, fundingRate: -0.0001, markPrice: 1000 },
    ];

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        fundingRates,
        config: {
          id: 'test',
          strategyName: 'test',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          startDate: TS_0,
          endDate: TS_1,
          initialCapital: 10_000,
          exchange: 'binance',
          params: {},
          mode: 'futures',
        },
      }),
    );

    // Long receives: payment = -1 * 1000 * (-0.0001) = +0.1
    expect(output.totalFundingIncome).toBeCloseTo(0.1, 6);
  });

  it('short receives (positive income) when fundingRate is positive', async () => {
    const TS_0 = 0;
    const TS_1 = 28_800_000;
    let opened = false;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        if (!opened) { ctx.openShort(1); opened = true; }
      }),
    });
    const candles: Candle[] = [
      makeCandle(TS_0, 1000, 1000, 1000, 1000),
      makeCandle(TS_1, 1000, 1000, 1000, 1000),
    ];
    const fundingRates: FundingRate[] = [
      { timestamp: TS_1, fundingRate: 0.0001, markPrice: 1000 },
    ];

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        fundingRates,
        config: {
          id: 'test',
          strategyName: 'test',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          startDate: TS_0,
          endDate: TS_1,
          initialCapital: 10_000,
          exchange: 'binance',
          params: {},
          mode: 'futures',
        },
      }),
    );

    // Short receives: payment = +1 * 1000 * 0.0001 = +0.1
    expect(output.totalFundingIncome).toBeCloseTo(0.1, 6);
  });

  it('sign symmetry: long payment and short payment are equal and opposite', async () => {
    // Run two separate sessions — one with a long, one with a short — against the same funding
    const TS_0 = 0;
    const TS_1 = 28_800_000;
    const fundingRates: FundingRate[] = [
      { timestamp: TS_1, fundingRate: 0.0001, markPrice: 1000 },
    ];
    const candles: Candle[] = [
      makeCandle(TS_0, 1000, 1000, 1000, 1000),
      makeCandle(TS_1, 1000, 1000, 1000, 1000),
    ];
    const futuresConfig = {
      id: 'test',
      strategyName: 'test',
      symbol: 'BTC/USDT',
      timeframe: '1h' as const,
      startDate: TS_0,
      endDate: TS_1,
      initialCapital: 10_000,
      exchange: 'binance',
      params: {},
      mode: 'futures' as const,
    };

    let longOpened = false;
    const longOutput = await runCoreBacktestLoop(makeInput({
      candles,
      fundingRates,
      config: futuresConfig,
      strategy: makeStrategy({
        onBar: vi.fn((ctx: StrategyContext) => {
          if (!longOpened) { ctx.openLong(1); longOpened = true; }
        }),
      }),
    }));

    let shortOpened = false;
    const shortOutput = await runCoreBacktestLoop(makeInput({
      candles,
      fundingRates,
      config: futuresConfig,
      strategy: makeStrategy({
        onBar: vi.fn((ctx: StrategyContext) => {
          if (!shortOpened) { ctx.openShort(1); shortOpened = true; }
        }),
      }),
    }));

    expect(longOutput.totalFundingIncome).toBeCloseTo(-shortOutput.totalFundingIncome, 6);
  });

  it('no funding income when no position is open', async () => {
    const candles: Candle[] = [
      makeCandle(0, 1000, 1000, 1000, 1000),
      makeCandle(28_800_000, 1000, 1000, 1000, 1000),
    ];
    const fundingRates: FundingRate[] = [
      { timestamp: 28_800_000, fundingRate: 0.01, markPrice: 1000 },
    ];
    const output = await runCoreBacktestLoop(
      makeInput({
        candles,
        fundingRates,
        config: {
          id: 'test',
          strategyName: 'test',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          startDate: 0,
          endDate: 28_800_000,
          initialCapital: 10_000,
          exchange: 'binance',
          params: {},
          mode: 'futures',
        },
      }),
    );
    expect(output.totalFundingIncome).toBe(0);
  });

  it('funding income is zero when fundingRates array is empty (spot mode)', async () => {
    const output = await runCoreBacktestLoop(makeInput({
      fundingRates: [],
      candles: makeFlatCandles(5, 100),
    }));
    expect(output.totalFundingIncome).toBe(0);
  });
});

// ============================================================================
// 8. Engine-managed SL/TP (injectable subCandleResolver)
// ============================================================================

describe('runCoreBacktestLoop — engine-managed SL/TP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stop loss triggers and position closes at SL price', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),         // bar 0: open long, set SL=90
      makeCandle(3_600_000, 95, 98, 85, 95),    // bar 1: low=85 triggers SL=90
      makeCandle(7_200_000, 95, 98, 93, 96),    // bar 2: not reached
    ];

    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90);        // filled at SL, not close=95
    expect(closeTrade!.exitReason).toBe('stop_loss');
    expect(output.engineStopLossCount).toBe(1);
  });

  it('take profit triggers and position closes at TP price', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setTakeProfit(115);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 120, 98, 110),  // high=120 triggers TP=115
    ];

    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(115);
    expect(closeTrade!.exitReason).toBe('take_profit');
    expect(output.engineTakeProfitCount).toBe(1);
  });

  it('short SL triggers (high >= SL)', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openShort(0.5);
          ctx.setStopLoss(115);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 120, 95, 100), // high=120 triggers SL=115
    ];

    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_SHORT');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(115);
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('neither SL nor TP triggers when price stays in range', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(85);
          ctx.setTakeProfit(120);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 110, 90, 105), // within range
    ];

    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const closeTradesFromEngine = output.trades.filter(
      t => t.exitReason === 'stop_loss' || t.exitReason === 'take_profit',
    );
    expect(closeTradesFromEngine).toHaveLength(0);
    expect(output.engineStopLossCount).toBe(0);
    expect(output.engineTakeProfitCount).toBe(0);
  });

  it('both SL and TP trigger on same bar: pessimistic fill (SL wins) when no subCandleResolver', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
          ctx.setTakeProfit(115);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 120, 85, 100), // both triggered
    ];

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        intraBarTimeframe: null, // disable sub-candle resolution
      }),
    );

    const closeTrade = output.trades.find(
      t => t.action === 'CLOSE_LONG' && (t.exitReason === 'stop_loss' || t.exitReason === 'take_profit'),
    );
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90);  // SL wins
    expect(closeTrade!.exitReason).toBe('stop_loss');
    expect(output.pessimisticSlTpCount).toBe(1);
  });

  it('both SL and TP trigger on same bar: subCandleResolver resolves TP first', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
          ctx.setTakeProfit(115);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 120, 85, 100), // both triggered
    ];

    // Sub-candles show TP hits first
    const subCandles: Candle[] = [
      makeCandle(3_600_000, 100, 116, 100, 115), // high=116 >= TP=115
      makeCandle(3_660_000, 115, 115, 88, 90),   // low=88 <= SL=90 (later)
    ];

    const subCandleResolver = vi.fn().mockResolvedValue(subCandles);

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        intraBarTimeframe: '1m',
        subCandleResolver,
      }),
    );

    const closeTrade = output.trades.find(
      t => t.action === 'CLOSE_LONG' && (t.exitReason === 'stop_loss' || t.exitReason === 'take_profit'),
    );
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(115);
    expect(closeTrade!.exitReason).toBe('take_profit');
    expect(subCandleResolver).toHaveBeenCalledTimes(1);
  });

  it('slippage applied to SL fill price', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 100, 85, 95), // SL=90 hit
    ];

    const output = await runCoreBacktestLoop(
      makeInput({
        strategy,
        candles,
        brokerConfig: { feeRate: 0, slippagePercent: 0.1 }, // 0.1% slippage
      }),
    );

    const closeTrade = output.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    // SL=90, selling (long exit) → price * (1 - 0.001) = 90 * 0.999 = 89.91
    expect(closeTrade!.price).toBeCloseTo(90 * 0.999, 5);
  });

  it('strategy sees no position after engine-managed SL exit', async () => {
    let seenPositionAfterSl: boolean | null = null;
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) {
          ctx.openLong(0.5);
          ctx.setStopLoss(90);
        } else if (callCount === 2) {
          seenPositionAfterSl = ctx.longPosition !== null;
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 102, 98, 100),
      makeCandle(3_600_000, 100, 100, 85, 95), // SL=90 hit
    ];

    await runCoreBacktestLoop(makeInput({ strategy, candles }));

    expect(seenPositionAfterSl).toBe(false);
  });
});

// ============================================================================
// 9. Indicators
// ============================================================================

describe('runCoreBacktestLoop — indicators', () => {
  it('collects indicator values emitted via ctx.setIndicator()', async () => {
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        ctx.setIndicator('sma', ctx.currentCandle.close * 2); // fake indicator
      }),
    });
    const candles = makeFlatCandles(3, 50);
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    expect(output.indicators['sma']).toBeDefined();
    expect(output.indicators['sma'].values).toEqual([100, 100, 100]); // 50 * 2
    expect(output.indicators['sma'].timestamps).toEqual(candles.map(c => c.timestamp));
  });

  it('returns empty indicators object when none emitted', async () => {
    const output = await runCoreBacktestLoop(makeInput());
    expect(Object.keys(output.indicators)).toHaveLength(0);
  });
});

// ============================================================================
// 10. Zero-trade edge cases
// ============================================================================

describe('runCoreBacktestLoop — zero trades edge cases', () => {
  it('handles single candle without error', async () => {
    const candles = [makeCandle(0, 100, 100, 100, 100)];
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    expect(output.barsProcessed).toBe(1);
    expect(output.trades).toHaveLength(0);
    expect(output.equity).toHaveLength(1);
  });

  it('equity is always initialCapital when no trades and flat price', async () => {
    const candles = makeFlatCandles(10, 100);
    const output = await runCoreBacktestLoop(makeInput({ candles }));
    for (const pt of output.equity) {
      expect(pt.equity).toBe(10_000);
    }
  });
});

// ============================================================================
// 11. Mixed long/short on same input (no overlap)
// ============================================================================

describe('runCoreBacktestLoop — mixed long/short sequences', () => {
  it('can open short after long is closed on the same bar', async () => {
    let callCount = 0;
    const strategy = makeStrategy({
      onBar: vi.fn((ctx: StrategyContext) => {
        callCount++;
        if (callCount === 1) ctx.openLong(1);
        if (callCount === 2) {
          if (ctx.longPosition) ctx.closeLong();
          ctx.openShort(1);
        }
      }),
    });
    const candles: Candle[] = [
      makeCandle(0, 100, 100, 100, 100),
      makeCandle(3_600_000, 110, 110, 110, 110),
      makeCandle(7_200_000, 105, 105, 105, 105),
    ];
    const output = await runCoreBacktestLoop(makeInput({ strategy, candles }));

    const actions = output.trades.map(t => t.action);
    expect(actions).toContain('OPEN_LONG');
    expect(actions).toContain('CLOSE_LONG');
    expect(actions).toContain('OPEN_SHORT');
  });
});
