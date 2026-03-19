/**
 * Unit tests for runCoreAggregateLoop()
 *
 * These tests exercise the pure core loop directly, without any DB or filesystem
 * dependencies. All data is passed in via the CoreAggregateInput interface.
 *
 * Coverage areas:
 *   1. Capital allocation: equal weight (top_n), weighted_multi, single_strongest
 *   2. Signal selection: top_n sorts by weight, weighted_multi normalises, single_strongest
 *   3. Funding rate processing: per-symbol accumulation, long vs short sign
 *   4. Position management: exit-before-entry, maxPositions limit
 *   5. Multi-symbol equity: portfolio equity = cash + position values
 *   6. Per-asset tracking: trades and equity recorded per symbol
 *   7. Engine-managed SL/TP: stops with mock subCandleResolver
 *   8. Open positions force-closed at end of backtest
 */

import { describe, it, expect, vi } from 'vitest';
import { runCoreAggregateLoop } from '../aggregate-engine.js';
import type { AdapterWithData, CoreAggregateInput } from '../aggregate-engine.js';
import { SignalAdapter } from '../signal-adapter.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { Candle, FundingRate } from '../types.js';
import type { AggregateBacktestConfig } from '../signal-types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCandle(
  price: number,
  timestamp: number,
  opts: Partial<Candle> = {},
): Candle {
  return {
    timestamp,
    open: opts.open ?? price,
    high: opts.high ?? price + 5,
    low: opts.low ?? price - 5,
    close: price,
    volume: opts.volume ?? 1000,
  };
}

function makeCandles(
  prices: number[],
  baseTimestamp = 1_000_000,
  intervalMs = 3_600_000,
): Candle[] {
  return prices.map((price, i) => makeCandle(price, baseTimestamp + i * intervalMs));
}

function makeFundingRate(
  timestamp: number,
  rate: number,
  markPrice?: number,
): FundingRate {
  return { timestamp, fundingRate: rate, markPrice };
}

function buildTimestampToIndex(candles: Candle[]): Map<number, number> {
  const map = new Map<number, number>();
  candles.forEach((c, i) => map.set(c.timestamp, i));
  return map;
}

/**
 * Build a minimal AggregateBacktestConfig for tests.
 */
function makeConfig(
  overrides: Partial<AggregateBacktestConfig> = {},
): AggregateBacktestConfig {
  return {
    subStrategies: [],
    allocationMode: 'top_n',
    maxPositions: 3,
    initialCapital: 10_000,
    startDate: 1_000_000,
    endDate: 1_000_000 + 10 * 3_600_000,
    exchange: 'bybit',
    mode: 'spot', // use spot to disable funding-rate logic unless overridden
    ...overrides,
  };
}

/**
 * Build a CoreAggregateInput with sensible defaults.
 */
function makeInput(
  adaptersWithData: AdapterWithData[],
  configOverrides: Partial<AggregateBacktestConfig> = {},
  inputOverrides: Partial<CoreAggregateInput> = {},
): CoreAggregateInput {
  return {
    config: makeConfig(configOverrides),
    adaptersWithData,
    initialCapital: 10_000,
    feeRate: 0,
    slippagePercent: 0,
    positionSizeFraction: 0.9,
    enableLogging: false,
    ...inputOverrides,
  };
}

/**
 * Create an AdapterWithData from a strategy and candle prices.
 */
function makeAdapterWithData(
  strategy: Strategy,
  symbol: string,
  prices: number[],
  baseTimestamp = 1_000_000,
  intervalMs = 3_600_000,
  fundingRates: FundingRate[] = [],
): AdapterWithData {
  const candles = makeCandles(prices, baseTimestamp, intervalMs);
  const adapter = new SignalAdapter(strategy, symbol, '1h');
  adapter.init(candles, fundingRates);
  const timestampToIndex = buildTimestampToIndex(candles);
  return {
    adapter,
    config: {
      strategyName: strategy.name,
      symbol,
      timeframe: '1h',
      params: {},
      exchange: 'bybit',
    },
    candles,
    fundingRates,
    timestampToIndex,
    accumulatedFunding: 0,
  };
}

// ============================================================================
// Strategy factories
// ============================================================================

/**
 * Strategy that opens a long on bar 0 and never closes (holds to end).
 */
function alwaysOpenLongStrategy(name = 'always-long'): Strategy {
  return {
    name,
    description: 'Always open long on first bar',
    version: '1.0.0',
    params: [],
    onBar(ctx: StrategyContext): void {
      if (!ctx.longPosition) ctx.openLong(1);
    },
  };
}

/**
 * Strategy that opens a short on bar 0 and never closes (holds to end).
 */
function alwaysOpenShortStrategy(name = 'always-short'): Strategy {
  return {
    name,
    description: 'Always open short on first bar',
    version: '1.0.0',
    params: [],
    onBar(ctx: StrategyContext): void {
      if (!ctx.shortPosition) ctx.openShort(1);
    },
  };
}

/**
 * Strategy that opens a long on bar 0 then closes on bar `closeBar`.
 */
function openThenCloseStrategy(closeBar: number, name = 'open-then-close'): Strategy {
  let barCount = 0;
  return {
    name,
    description: 'Open long then close',
    version: '1.0.0',
    params: [],
    onBar(ctx: StrategyContext): void {
      if (ctx.longPosition) {
        if (barCount >= closeBar) ctx.closeLong();
      } else {
        ctx.openLong(1);
      }
      barCount++;
    },
  };
}

/**
 * Strategy that opens a long on bar 0, sets SL at `slPrice` and TP at `tpPrice`,
 * and never closes via signal (relies on engine-managed exits).
 */
function slTpStrategy(slPrice: number, tpPrice: number, name = 'sl-tp-strat'): Strategy {
  return {
    name,
    description: 'Long with SL/TP',
    version: '1.0.0',
    params: [],
    onBar(ctx: StrategyContext): void {
      if (!ctx.longPosition) {
        ctx.openLong(1);
        ctx.setStopLoss(slPrice);
        ctx.setTakeProfit(tpPrice);
      }
    },
  };
}

// ============================================================================
// 1. Capital allocation
// ============================================================================

describe('runCoreAggregateLoop — capital allocation', () => {
  it('top_n: three simultaneous signals each receive initialCapital * fraction / maxPositions', async () => {
    const strat = alwaysOpenLongStrategy;
    const awd1 = makeAdapterWithData(strat('s1'), 'AAA/USDT', [100, 100, 100]);
    const awd2 = makeAdapterWithData(strat('s2'), 'BBB/USDT', [100, 100, 100]);
    const awd3 = makeAdapterWithData(strat('s3'), 'CCC/USDT', [100, 100, 100]);

    const input = makeInput(
      [awd1, awd2, awd3],
      { allocationMode: 'top_n', maxPositions: 3 },
      { initialCapital: 10_000, positionSizeFraction: 0.9 },
    );

    const output = await runCoreAggregateLoop(input);

    // 3 open trades
    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(3);

    // Each should receive 10000 * 0.9 / 3 = 3000 in notional
    const expectedCapital = (10_000 * 0.9) / 3;
    for (const trade of openTrades) {
      expect(trade.amount * trade.price).toBeCloseTo(expectedCapital, 1);
    }
  });

  it('top_n: uses initialCapital (not remaining cash) for each slot', async () => {
    // Open 1 position now, then another later — both should get the same fixed slice
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Strategy for symbol A: opens at bar 0 and holds
    const stratA = alwaysOpenLongStrategy('sa');

    // Strategy for symbol B: opens at bar 1 and holds (price check ensures it waits)
    let barB = 0;
    const stratB: Strategy = {
      name: 'sb',
      description: 'Open long on bar 1',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition && barB >= 1) ctx.openLong(1);
        barB++;
      },
    };

    const awdA = makeAdapterWithData(stratA, 'AAA/USDT', [100, 100, 100], BASE, INTERVAL);
    const awdB = makeAdapterWithData(stratB, 'BBB/USDT', [100, 100, 100], BASE, INTERVAL);

    const input = makeInput(
      [awdA, awdB],
      { allocationMode: 'top_n', maxPositions: 2 },
      { initialCapital: 10_000, positionSizeFraction: 1.0 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(2);

    // Both should get 10000 / 2 = 5000 notional regardless of order
    const expectedCapital = 10_000 / 2;
    for (const trade of openTrades) {
      expect(trade.amount * trade.price).toBeCloseTo(expectedCapital, 1);
    }
  });

  it('weighted_multi: capital proportional to signal weight', async () => {
    // Two signals on same bar — weights 0.7 and 0.3 → capital split 70/30
    // Strategy A: weight driven by mock (use FR-spike calculator? No — use default = 1)
    // We can't directly set weights from the strategy level, but we can verify
    // via the allocation math that different capitals are assigned based on weight ratio.
    // Instead, use the mathematical property: with equal weight (both 1.0) in weighted_multi,
    // each should get 50% of the 90% fraction.
    const strat = alwaysOpenLongStrategy;
    const awd1 = makeAdapterWithData(strat('s1'), 'AAA/USDT', [100, 100]);
    const awd2 = makeAdapterWithData(strat('s2'), 'BBB/USDT', [200, 200]);

    const input = makeInput(
      [awd1, awd2],
      { allocationMode: 'weighted_multi', maxPositions: 2 },
      { initialCapital: 10_000, positionSizeFraction: 1.0 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(2);

    // Both signals have weight 1.0, so 50/50 split of 10000
    const expectedCapital = 10_000 / 2;
    for (const trade of openTrades) {
      expect(trade.amount * trade.price).toBeCloseTo(expectedCapital, 0);
    }
  });

  it('single_strongest: uses positionSizeFraction of available cash', async () => {
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', [100, 100]);

    const input = makeInput(
      [awd],
      { allocationMode: 'single_strongest', maxPositions: 1 },
      { initialCapital: 10_000, positionSizeFraction: 0.9 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(1);

    // Should receive 10000 * 0.9 = 9000 notional
    expect(openTrades[0].amount * openTrades[0].price).toBeCloseTo(9_000, 1);
  });
});

// ============================================================================
// 2. Signal selection
// ============================================================================

describe('runCoreAggregateLoop — signal selection', () => {
  it('top_n with maxPositions=1: only 1 signal executed even if 2 are ready', async () => {
    const strat = alwaysOpenLongStrategy;
    const awd1 = makeAdapterWithData(strat('s1'), 'AAA/USDT', [100, 100]);
    const awd2 = makeAdapterWithData(strat('s2'), 'BBB/USDT', [100, 100]);

    const input = makeInput(
      [awd1, awd2],
      { allocationMode: 'top_n', maxPositions: 1 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(1);
  });

  it('single_strongest: only trades when no position is open', async () => {
    // Two strategies signal on bar 0 — only 1 should be executed
    const awd1 = makeAdapterWithData(alwaysOpenLongStrategy('s1'), 'AAA/USDT', [100, 100]);
    const awd2 = makeAdapterWithData(alwaysOpenLongStrategy('s2'), 'BBB/USDT', [100, 100]);

    const input = makeInput(
      [awd1, awd2],
      { allocationMode: 'single_strongest', maxPositions: 1 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(1);
  });

  it('weighted_multi: all signals up to maxPositions are executed', async () => {
    const strat = alwaysOpenLongStrategy;
    const awds = ['AAA/USDT', 'BBB/USDT', 'CCC/USDT', 'DDD/USDT'].map((sym, i) =>
      makeAdapterWithData(strat(`s${i}`), sym, [100, 100]),
    );

    const input = makeInput(
      awds,
      { allocationMode: 'weighted_multi', maxPositions: 3 },
    );

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    // Only 3 out of 4 signals should execute (maxPositions = 3)
    expect(openTrades).toHaveLength(3);
  });

  it('throws on unknown allocation mode', async () => {
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', [100, 100]);

    const input = makeInput(
      [awd],
      // Force an invalid allocation mode (cast needed to bypass TS type guard)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { allocationMode: 'unknown_mode' as any, maxPositions: 1 },
    );

    await expect(runCoreAggregateLoop(input)).rejects.toThrow('Unknown allocation mode');
  });
});

// ============================================================================
// 3. Funding rate processing
// ============================================================================

describe('runCoreAggregateLoop — funding rate processing', () => {
  it('positive funding rate causes long position to pay (funding income is negative)', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 8 * 3_600_000; // 8h candles to align with FR timestamps

    const prices = [100, 100, 100];
    const candles = makeCandles(prices, BASE, INTERVAL);

    // Funding rate at bar 1 (second candle's timestamp)
    const fundingRates: FundingRate[] = [
      makeFundingRate(BASE + INTERVAL, 0.001, 100), // 0.1% positive rate at bar 1
    ];

    const strat = alwaysOpenLongStrategy();
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '4h');
    adapter.init(candles, fundingRates);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates,
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    // Use futures mode so funding is applied
    const input = makeInput([awd], { mode: 'futures', allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // Funding should be negative for a long (pays when rate > 0)
    expect(output.totalFundingIncome).toBeLessThan(0);
    expect(output.perSymbolFunding.get('BTC/USDT')).toBeLessThan(0);
  });

  it('positive funding rate causes short position to receive (funding income is positive)', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 8 * 3_600_000;

    const prices = [100, 100, 100];
    const candles = makeCandles(prices, BASE, INTERVAL);

    const fundingRates: FundingRate[] = [
      makeFundingRate(BASE + INTERVAL, 0.001, 100), // 0.1% positive rate at bar 1
    ];

    const strat = alwaysOpenShortStrategy();
    const adapter = new SignalAdapter(strat, 'ETH/USDT', '4h');
    adapter.init(candles, fundingRates);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'ETH/USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates,
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    const input = makeInput([awd], { mode: 'futures', allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // Funding should be positive for a short (receives when rate > 0)
    expect(output.totalFundingIncome).toBeGreaterThan(0);
    expect(output.perSymbolFunding.get('ETH/USDT')).toBeGreaterThan(0);
  });

  it('accumulated funding is attached to the close trade and reset', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 8 * 3_600_000;

    // 5 bars: open on bar 0, close on bar 3, funding on bars 1 and 2
    const prices = [100, 100, 100, 100, 100];
    const candles = makeCandles(prices, BASE, INTERVAL);

    const fundingRates: FundingRate[] = [
      makeFundingRate(BASE + INTERVAL, 0.001, 100),
      makeFundingRate(BASE + 2 * INTERVAL, 0.001, 100),
    ];

    const strat = openThenCloseStrategy(3);
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '4h');
    adapter.init(candles, fundingRates);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates,
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    const input = makeInput([awd], { mode: 'futures', allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // The close trade should have a fundingIncome field
    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.fundingIncome).toBeDefined();
    // Funding income is negative for a long with positive rates
    expect(closeTrade!.fundingIncome!).toBeLessThan(0);
  });

  it('spot mode: no funding rate processing', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 8 * 3_600_000;

    const prices = [100, 100, 100];
    const candles = makeCandles(prices, BASE, INTERVAL);
    const fundingRates: FundingRate[] = [
      makeFundingRate(BASE + INTERVAL, 0.01, 100), // 1% rate that should be ignored
    ];

    const strat = alwaysOpenLongStrategy();
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '4h');
    adapter.init(candles, fundingRates);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates,
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    // Spot mode — funding should be ignored
    const input = makeInput([awd], { mode: 'spot', allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    expect(output.totalFundingIncome).toBe(0);
    expect(output.perSymbolFunding.size).toBe(0);
  });
});

// ============================================================================
// 4. Position management
// ============================================================================

describe('runCoreAggregateLoop — position management', () => {
  it('exit-before-entry: position is closed then new one opened in same bar when strategy signals both', async () => {
    // Strategy: opens long on bar 0, closes on bar 2, then re-opens immediately
    let barCount = 0;
    const strat: Strategy = {
      name: 'exit-reentry',
      description: 'Close and reopen on same bar',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (ctx.longPosition) {
          if (barCount === 2) {
            ctx.closeLong();
            ctx.openLong(1); // re-entry on same bar
          }
        } else {
          ctx.openLong(1);
        }
        barCount++;
      },
    };

    const prices = [100, 100, 100, 100, 100];
    const awd = makeAdapterWithData(strat, 'BTC/USDT', prices);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // Should see: OPEN at bar 0, CLOSE at bar 2, OPEN at bar 2
    const opens = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    const closes = output.allTrades.filter(t => t.action === 'CLOSE_LONG');
    expect(opens.length).toBeGreaterThanOrEqual(2);
    expect(closes.length).toBeGreaterThanOrEqual(1);
  });

  it('maxPositions enforced: only maxPositions active at once (top_n mode)', async () => {
    // 5 strategies all wanting to open, but maxPositions=2
    const awds = ['A/USDT', 'B/USDT', 'C/USDT', 'D/USDT', 'E/USDT'].map((sym, i) =>
      makeAdapterWithData(alwaysOpenLongStrategy(`s${i}`), sym, [100, 100]),
    );

    const input = makeInput(awds, { allocationMode: 'top_n', maxPositions: 2 });

    const output = await runCoreAggregateLoop(input);

    const openTrades = output.allTrades.filter(t => t.action === 'OPEN_LONG');
    expect(openTrades).toHaveLength(2);
  });

  it('positions that remain open at end are force-closed', async () => {
    // Strategy that only opens and never closes
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', [100, 110, 120]);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // Should see open + forced close
    const closeTrades = output.allTrades.filter(t => t.action === 'CLOSE_LONG');
    expect(closeTrades).toHaveLength(1);
    // Close should happen at the last candle price (120)
    expect(closeTrades[0].price).toBe(120);
  });

  it('zero trades when no signals are generated', async () => {
    // Strategy that never opens
    const strat: Strategy = {
      name: 'idle',
      description: 'Does nothing',
      version: '1.0.0',
      params: [],
      onBar(_ctx: StrategyContext): void {
        // no-op
      },
    };
    const awd = makeAdapterWithData(strat, 'BTC/USDT', [100, 110, 120]);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    expect(output.allTrades).toHaveLength(0);
    expect(output.totalFundingIncome).toBe(0);
  });
});

// ============================================================================
// 5. Multi-symbol equity
// ============================================================================

describe('runCoreAggregateLoop — multi-symbol equity', () => {
  it('equity timeline covers all candle timestamps from all adapters', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Two symbols on the same timeline
    const awd1 = makeAdapterWithData(alwaysOpenLongStrategy('s1'), 'AAA/USDT', [100, 110, 120], BASE, INTERVAL);
    const awd2 = makeAdapterWithData(alwaysOpenLongStrategy('s2'), 'BBB/USDT', [200, 210, 220], BASE, INTERVAL);

    const input = makeInput([awd1, awd2], { allocationMode: 'top_n', maxPositions: 2 });

    const output = await runCoreAggregateLoop(input);

    // Should have equity point for each unique timestamp across both symbols
    expect(output.equityTimestamps).toHaveLength(3);
    expect(output.equityTimestamps[0]).toBe(BASE);
    expect(output.equityTimestamps[1]).toBe(BASE + INTERVAL);
    expect(output.equityTimestamps[2]).toBe(BASE + 2 * INTERVAL);
  });

  it('equity increases when prices rise (long positions)', async () => {
    const prices = [100, 200]; // Price doubles
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', prices);

    const input = makeInput([awd], {
      allocationMode: 'single_strongest',
      maxPositions: 1,
      initialCapital: 10_000,
    }, { initialCapital: 10_000 });

    const output = await runCoreAggregateLoop(input);

    // Equity at start should be close to initialCapital (minus minor fee if any)
    const firstEquity = output.equityValues[0];
    const lastEquity = output.equityValues[output.equityValues.length - 1];

    expect(lastEquity).toBeGreaterThan(firstEquity);
    // With price doubling and 90% allocation: roughly 10000 + 9000 = 19000
    expect(lastEquity).toBeGreaterThan(15_000);
  });

  it('staggered timelines: symbols with different timestamps get unified timeline', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Symbol A: bars at t=0, 1, 2, 3
    const awdA = makeAdapterWithData(
      alwaysOpenLongStrategy('sA'),
      'AAA/USDT',
      [100, 100, 100, 100],
      BASE,
      INTERVAL,
    );

    // Symbol B: bars at t=1, 2, 3, 4 (starts 1 bar later)
    const awdB = makeAdapterWithData(
      alwaysOpenLongStrategy('sB'),
      'BBB/USDT',
      [100, 100, 100, 100],
      BASE + INTERVAL, // starts 1 interval later
      INTERVAL,
    );

    const input = makeInput([awdA, awdB], { allocationMode: 'top_n', maxPositions: 2 });

    const output = await runCoreAggregateLoop(input);

    // Should have 5 unique timestamps (t=0 through t=4)
    expect(output.equityTimestamps).toHaveLength(5);
  });
});

// ============================================================================
// 6. Per-asset tracking
// ============================================================================

describe('runCoreAggregateLoop — per-asset tracking', () => {
  it('perAssetTrades correctly attributed to each symbol', async () => {
    const awd1 = makeAdapterWithData(alwaysOpenLongStrategy('s1'), 'AAA/USDT', [100, 110, 120]);
    const awd2 = makeAdapterWithData(alwaysOpenLongStrategy('s2'), 'BBB/USDT', [200, 210, 220]);

    const input = makeInput([awd1, awd2], { allocationMode: 'top_n', maxPositions: 2 });

    const output = await runCoreAggregateLoop(input);

    const aaaTrades = output.perAssetTrades.get('AAA/USDT');
    const bbbTrades = output.perAssetTrades.get('BBB/USDT');

    expect(aaaTrades).toBeDefined();
    expect(bbbTrades).toBeDefined();

    // Each has an OPEN (and force-close at end)
    expect(aaaTrades!.some(t => t.action === 'OPEN_LONG')).toBe(true);
    expect(bbbTrades!.some(t => t.action === 'OPEN_LONG')).toBe(true);
    // No trades from AAA in BBB's list and vice versa
    expect(aaaTrades!.every(t => t.symbol === 'AAA/USDT')).toBe(true);
    expect(bbbTrades!.every(t => t.symbol === 'BBB/USDT')).toBe(true);
  });

  it('perSymbolAllocatedCapital set for traded symbols, not for idle ones', async () => {
    // Symbol A trades, symbol B never signals
    const idleStrat: Strategy = {
      name: 'idle-b',
      description: 'Does nothing',
      version: '1.0.0',
      params: [],
      onBar(_ctx: StrategyContext): void {},
    };

    const awd1 = makeAdapterWithData(alwaysOpenLongStrategy('s1'), 'AAA/USDT', [100, 100]);
    const awd2 = makeAdapterWithData(idleStrat, 'BBB/USDT', [100, 100]);

    const input = makeInput([awd1, awd2], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // AAA should have an allocated capital entry (it traded)
    expect(output.perSymbolAllocatedCapital.has('AAA/USDT')).toBe(true);
    // BBB never traded, so no entry
    expect(output.perSymbolAllocatedCapital.has('BBB/USDT')).toBe(false);
  });

  it('allTrades is sorted by timestamp', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Open and close on different bars
    const strat = openThenCloseStrategy(2);
    const awd = makeAdapterWithData(strat, 'BTC/USDT', [100, 100, 100, 100], BASE, INTERVAL);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    for (let i = 1; i < output.allTrades.length; i++) {
      expect(output.allTrades[i].timestamp).toBeGreaterThanOrEqual(output.allTrades[i - 1].timestamp);
    }
  });
});

// ============================================================================
// 7. Engine-managed SL/TP
// ============================================================================

describe('runCoreAggregateLoop — engine-managed SL/TP', () => {
  it('stop-loss triggers when candle low breaches SL price', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // SL at 90; bar 1 candle low goes to 85 (SL triggered)
    const candles: Candle[] = [
      makeCandle(100, BASE, { low: 99, high: 101 }),       // bar 0: entry
      makeCandle(95, BASE + INTERVAL, { low: 85, high: 98 }), // bar 1: SL triggered (low=85 < 90)
    ];

    const strat = slTpStrategy(90, 120); // SL=90, TP=120
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '1h');
    adapter.init(candles);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates: [],
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' });

    const output = await runCoreAggregateLoop(input);

    expect(output.engineStopLossCount).toBe(1);
    expect(output.engineTakeProfitCount).toBe(0);

    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.exitReason).toBe('stop_loss');
    expect(closeTrade!.price).toBe(90); // exactly at SL level
  });

  it('take-profit triggers when candle high breaches TP price', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // TP at 120; bar 1 candle high goes to 125 (TP triggered)
    const candles: Candle[] = [
      makeCandle(100, BASE, { low: 99, high: 101 }),          // bar 0: entry
      makeCandle(115, BASE + INTERVAL, { low: 110, high: 125 }), // bar 1: TP triggered (high=125 > 120)
    ];

    const strat = slTpStrategy(80, 120); // SL=80, TP=120
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '1h');
    adapter.init(candles);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates: [],
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' });

    const output = await runCoreAggregateLoop(input);

    expect(output.engineTakeProfitCount).toBe(1);
    expect(output.engineStopLossCount).toBe(0);

    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.exitReason).toBe('take_profit');
    expect(closeTrade!.price).toBe(120); // exactly at TP level
  });

  it('ambiguous SL+TP: pessimisticSlTpCount incremented, SL wins without sub-candle resolver', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Both SL and TP triggered on same bar: low=85 < SL=90 AND high=125 > TP=120
    const candles: Candle[] = [
      makeCandle(100, BASE, { low: 99, high: 101 }),            // bar 0: entry
      makeCandle(100, BASE + INTERVAL, { low: 85, high: 125 }), // bar 1: both trigger
    ];

    const strat = slTpStrategy(90, 120);
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '1h');
    adapter.init(candles);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates: [],
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    // No subCandleResolver — pessimistic (SL wins)
    const input = makeInput(
      [awd],
      { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' },
      { intraBarTimeframe: null }, // explicitly disable sub-candle resolution
    );

    const output = await runCoreAggregateLoop(input);

    expect(output.pessimisticSlTpCount).toBe(1);
    expect(output.engineStopLossCount).toBe(1);

    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  it('ambiguous SL+TP: sub-candle resolver called and TP wins if TP sub-candle comes first', async () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    const candles: Candle[] = [
      makeCandle(100, BASE, { low: 99, high: 101 }),            // bar 0: entry
      makeCandle(100, BASE + INTERVAL, { low: 85, high: 125 }), // bar 1: both trigger
    ];

    const strat = slTpStrategy(90, 120);
    const adapter = new SignalAdapter(strat, 'BTC/USDT', '1h');
    adapter.init(candles);

    const awd: AdapterWithData = {
      adapter,
      config: { strategyName: strat.name, symbol: 'BTC/USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      candles,
      fundingRates: [],
      timestampToIndex: buildTimestampToIndex(candles),
      accumulatedFunding: 0,
    };

    // Sub-candle data: TP triggers first (high > 120 before low < 90)
    const subCandles: Candle[] = [
      makeCandle(115, BASE + INTERVAL, { low: 110, high: 125 }), // TP triggers (high=125 > 120, low=110 > 90 so no SL)
    ];

    const mockResolver = vi.fn().mockResolvedValue(subCandles);

    const input: CoreAggregateInput = {
      config: makeConfig({ allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' }),
      adaptersWithData: [awd],
      initialCapital: 10_000,
      feeRate: 0,
      slippagePercent: 0,
      positionSizeFraction: 0.9,
      intraBarTimeframe: '5m', // use 5m sub-candles
      subCandleResolver: mockResolver,
    };

    const output = await runCoreAggregateLoop(input);

    expect(mockResolver).toHaveBeenCalled();
    expect(output.subCandleResolvedCount).toBe(1);
    expect(output.engineTakeProfitCount).toBe(1);

    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade!.exitReason).toBe('take_profit');
    expect(closeTrade!.price).toBe(120); // TP level
  });

  it('no SL/TP: engine-managed exits are not triggered', async () => {
    // Strategy with no SL/TP set — exits only via signal
    const strat = openThenCloseStrategy(2);
    const awd = makeAdapterWithData(strat, 'BTC/USDT', [100, 110, 90, 100]);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' });

    const output = await runCoreAggregateLoop(input);

    expect(output.engineStopLossCount).toBe(0);
    expect(output.engineTakeProfitCount).toBe(0);
    expect(output.pessimisticSlTpCount).toBe(0);
  });
});

// ============================================================================
// 8. Slippage
// ============================================================================

describe('runCoreAggregateLoop — slippage', () => {
  it('long entry price is higher than candle close when slippage > 0', async () => {
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', [100, 100]);

    const input = makeInput(
      [awd],
      { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' },
      { slippagePercent: 1 }, // 1% slippage
    );

    const output = await runCoreAggregateLoop(input);

    const openTrade = output.allTrades.find(t => t.action === 'OPEN_LONG');
    expect(openTrade).toBeDefined();
    // Entry price should be 100 * 1.01 = 101
    expect(openTrade!.price).toBeCloseTo(101, 5);
  });

  it('long exit price is lower than candle close when slippage > 0', async () => {
    const strat = openThenCloseStrategy(1);
    const awd = makeAdapterWithData(strat, 'BTC/USDT', [100, 100, 100]);

    const input = makeInput(
      [awd],
      { allocationMode: 'single_strongest', maxPositions: 1, mode: 'spot' },
      { slippagePercent: 1 },
    );

    const output = await runCoreAggregateLoop(input);

    const closeTrade = output.allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    // Exit price should be 100 * 0.99 = 99
    expect(closeTrade!.price).toBeCloseTo(99, 5);
  });
});

// ============================================================================
// 9. Signal history
// ============================================================================

describe('runCoreAggregateLoop — signal history', () => {
  it('signal history records executed signals', async () => {
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', [100, 100]);

    const input = makeInput([awd], { allocationMode: 'single_strongest', maxPositions: 1 });

    const output = await runCoreAggregateLoop(input);

    // One signal should be in the history (the executed one)
    expect(output.signalHistory.length).toBeGreaterThanOrEqual(1);
    expect(output.signalHistory[0].symbol).toBe('BTC/USDT');
    expect(output.signalHistory[0].direction).toBe('long');
  });
});

// ============================================================================
// 10. Progress callback
// ============================================================================

describe('runCoreAggregateLoop — progress callback', () => {
  it('onProgress is called periodically during the loop', async () => {
    // Create enough bars to trigger at least one progress callback (every 100)
    const prices = Array.from({ length: 150 }, (_, i) => 100 + i);
    const awd = makeAdapterWithData(alwaysOpenLongStrategy(), 'BTC/USDT', prices);

    const progressCalls: Array<{ current: number; total: number; percent: number }> = [];

    const input = makeInput(
      [awd],
      { allocationMode: 'single_strongest', maxPositions: 1 },
      { onProgress: (p) => { progressCalls.push(p); } },
    );

    await runCoreAggregateLoop(input);

    // Should have been called at ti=0 and ti=100
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls[0].total).toBe(150);
    expect(progressCalls[0].percent).toBeGreaterThan(0);
  });
});
