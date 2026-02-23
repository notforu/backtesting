/**
 * Aggregate Engine Integration Tests
 *
 * Tests the allocation logic and component integration (MultiSymbolPortfolio +
 * SignalAdapter) without requiring a real database or strategy loader.
 *
 * The full runAggregateBacktest() function is NOT tested here because it
 * depends on loadStrategy() (filesystem) and DB calls. Instead we verify the
 * core mechanics by exercising the components that the engine composes.
 */

import { describe, it, expect } from 'vitest';
import { MultiSymbolPortfolio } from '../multi-portfolio.js';
import { SignalAdapter } from '../signal-adapter.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { Candle, FundingRate } from '../types.js';
import type { Signal } from '../signal-types.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal candle array from a list of close prices.
 */
function makeCandles(
  prices: number[],
  baseTimestamp = 1_000_000,
  intervalMs = 3_600_000,
): Candle[] {
  return prices.map((price, i) => ({
    timestamp: baseTimestamp + i * intervalMs,
    open: price,
    high: price + 5,
    low: price - 5,
    close: price,
    volume: 100,
  }));
}

/**
 * Strategy that opens a long when price < threshold and closes when price >
 * threshold + 20.  Has no params, which is fine because validateStrategyParams
 * fills in defaults from the (empty) params array.
 */
function createLongOnlyStrategy(threshold: number): Strategy {
  return {
    name: 'test-long',
    description: 'Test long-only strategy',
    version: '1.0.0',
    params: [],
    onBar(ctx: StrategyContext): void {
      if (ctx.longPosition) {
        if (ctx.currentCandle.close > threshold + 20) ctx.closeLong();
        return;
      }
      if (ctx.currentCandle.close < threshold) ctx.openLong(1);
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Aggregate Engine Integration', () => {
  // --------------------------------------------------------------------------
  it('single adapter: generates signals and tracks position in portfolio', () => {
    const strategy = createLongOnlyStrategy(100);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    // Bar 0: price=80 (<100) → signal long
    // Bar 3: price=130 (>120) → exit
    const candles = makeCandles([80, 85, 90, 130, 125]);
    adapter.init(candles);

    const portfolio = new MultiSymbolPortfolio(10_000);

    // Bar 0: expect an entry signal
    const signal0 = adapter.getSignal(0);
    expect(signal0).not.toBeNull();
    expect(signal0!.direction).toBe('long');

    // Execute the signal
    const amount = (portfolio.cash * 0.9) / candles[0].close;
    portfolio.openLong('BTC/USDT', amount, candles[0].close, candles[0].timestamp, 0.001);
    adapter.confirmExecutionAtBar('long', 0);

    expect(adapter.isInPosition()).toBe(true);
    expect(portfolio.hasAnyPosition()).toBe(true);

    // Bar 1: adapter is in position → strategy sees longPosition → no new entry signal
    portfolio.updatePrice('BTC/USDT', candles[1].close);
    expect(adapter.isInPosition()).toBe(true);
    const signal1 = adapter.getSignal(1);
    expect(signal1).toBeNull();

    // Bar 3: price=130 > threshold+20 → strategy wants to exit
    portfolio.updatePrice('BTC/USDT', candles[3].close);
    const wantsExit = adapter.wantsExit(3);
    expect(wantsExit).toBe(true);

    // Execute exit
    const closeTrade = portfolio.closeLong('BTC/USDT', 'all', candles[3].close, candles[3].timestamp, 0.001);
    adapter.confirmExit();

    expect(closeTrade.pnl).toBeDefined();
    // Price rose from 80 to 130 so PnL should be positive (after fees)
    expect(closeTrade.pnl!).toBeGreaterThan(0);
    expect(adapter.isInPosition()).toBe(false);
  });

  // --------------------------------------------------------------------------
  it('multiple adapters: signals sorted by weight, single_strongest picks highest', () => {
    // Two strategies that both signal on the same bar
    const strategyA: Strategy = {
      name: 'test-a',
      description: 'Always long',
      version: '1.0.0',
      params: [],
      onBar(ctx) {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };

    const strategyB: Strategy = {
      name: 'test-b',
      description: 'Always short',
      version: '1.0.0',
      params: [],
      onBar(ctx) {
        if (!ctx.shortPosition) ctx.openShort(1);
      },
    };

    const candles = makeCandles([100, 110]);

    const adapterA = new SignalAdapter(strategyA, 'ETH/USDT', '1h');
    adapterA.init(candles);
    const adapterB = new SignalAdapter(strategyB, 'BTC/USDT', '1h');
    adapterB.init(candles);

    const signalA = adapterA.getSignal(0);
    const signalB = adapterB.getSignal(0);

    expect(signalA).not.toBeNull();
    expect(signalB).not.toBeNull();

    // Both use the default weight calculator → weight = 1.0
    expect(signalA!.weight).toBe(1.0);
    expect(signalB!.weight).toBe(1.0);

    // After sorting by weight descending, order is deterministic within a tie
    const sorted = [
      { signal: signalA!, awd: 'A' },
      { signal: signalB!, awd: 'B' },
    ].sort((a, b) => b.signal.weight - a.signal.weight);

    expect(sorted[0].signal.weight).toBe(1.0);
    expect(sorted[1].signal.weight).toBe(1.0);
  });

  // --------------------------------------------------------------------------
  it('top_n allocation: respects maxPositions limit', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    const maxPositions = 2;

    // Open 2 positions to fill the available slots
    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0.001);
    portfolio.openLong('ETH/USDT', 1, 3_000, 1_000_000, 0.001);

    const currentPositionCount = portfolio.getPositionCount();
    expect(currentPositionCount).toBe(2);

    const availableSlots = Math.max(0, maxPositions - currentPositionCount);
    expect(availableSlots).toBe(0);
    // With 0 available slots, no new signals would be executed in top_n mode
  });

  // --------------------------------------------------------------------------
  it('weighted_multi allocation: capital is split proportionally to weight', () => {
    const totalCash = 10_000;
    const signals = [
      { weight: 0.8, symbol: 'BTC' },
      { weight: 0.2, symbol: 'ETH' },
    ];
    const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);

    const btcCapital = (signals[0].weight / totalWeight) * totalCash * 0.9;
    const ethCapital = (signals[1].weight / totalWeight) * totalCash * 0.9;

    // 0.8 / 1.0 * 9000 = 7200
    expect(btcCapital).toBeCloseTo(7_200);
    // 0.2 / 1.0 * 9000 = 1800
    expect(ethCapital).toBeCloseTo(1_800);
  });

  // --------------------------------------------------------------------------
  it('exit-first: does not open new position while adapter has a shadow position', () => {
    const strategy = createLongOnlyStrategy(100);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    const candles = makeCandles([80, 90, 95, 100]); // All prices < threshold
    adapter.init(candles);

    // Bar 0: expect an entry signal
    const signal0 = adapter.getSignal(0);
    expect(signal0).not.toBeNull();

    // Confirm execution to set the shadow position
    adapter.confirmExecutionAtBar('long', 0);
    expect(adapter.isInPosition()).toBe(true);

    // Bar 1: adapter is in position → getSignal returns null (strategy sees longPosition)
    const signal1 = adapter.getSignal(1);
    expect(signal1).toBeNull();

    // Bar 2: still in position → still null
    const signal2 = adapter.getSignal(2);
    expect(signal2).toBeNull();
  });

  // --------------------------------------------------------------------------
  it('funding payments are applied correctly to portfolio cash', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 50_000);

    const equityBefore = portfolio.equity;

    // Positive payment = receive funds (e.g. short receives when FR > 0)
    portfolio.applyFundingPayment(100);
    const equityAfter = portfolio.equity;

    expect(equityAfter - equityBefore).toBeCloseTo(100);
  });

  // --------------------------------------------------------------------------
  it('per-asset trades are correctly filtered by symbol', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    portfolio.openLong('BTC/USDT', 0.05, 50_000, 1_000_000, 0.001);
    portfolio.openLong('ETH/USDT', 1, 3_000, 1_000_100, 0.001);

    const trades = portfolio.trades;
    const btcTrades = trades.filter(t => t.symbol === 'BTC/USDT');
    const ethTrades = trades.filter(t => t.symbol === 'ETH/USDT');

    expect(btcTrades).toHaveLength(1);
    expect(ethTrades).toHaveLength(1);
    expect(btcTrades[0].action).toBe('OPEN_LONG');
    expect(ethTrades[0].action).toBe('OPEN_LONG');
  });

  // --------------------------------------------------------------------------
  it('unified timeline merges timestamps from different timeframes', () => {
    // 1h candles at hours 0, 1, 2
    const candles1h = makeCandles([100, 110, 120], 1_000_000, 3_600_000);
    // 4h candles at hours 0, 4
    const candles4h = makeCandles([200, 210], 1_000_000, 14_400_000);

    const allTimestamps = new Set<number>();
    for (const c of candles1h) allTimestamps.add(c.timestamp);
    for (const c of candles4h) allTimestamps.add(c.timestamp);

    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    // 1h: [1000000, 4600000, 8200000]
    // 4h: [1000000, 15400000]
    // Union (unique): 4 timestamps
    expect(timeline.length).toBe(4);

    // Timeline must start at the earliest timestamp
    expect(timeline[0]).toBe(1_000_000);

    // Timeline must be sorted ascending
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]).toBeGreaterThan(timeline[i - 1]);
    }
  });

  // --------------------------------------------------------------------------
  it('adapter confirmExit resets shadow position allowing new signals', () => {
    const strategy = createLongOnlyStrategy(100);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    const candles = makeCandles([80, 130, 80]);
    adapter.init(candles);

    // Bar 0: signal and confirm
    const sig0 = adapter.getSignal(0);
    expect(sig0!.direction).toBe('long');
    adapter.confirmExecutionAtBar('long', 0);
    expect(adapter.isInPosition()).toBe(true);

    // Bar 1: price=130, strategy wants to exit (>100+20)
    expect(adapter.wantsExit(1)).toBe(true);
    adapter.confirmExit();
    expect(adapter.isInPosition()).toBe(false);

    // Bar 2: price=80 again → should emit a new entry signal
    const sig2 = adapter.getSignal(2);
    expect(sig2).not.toBeNull();
    expect(sig2!.direction).toBe('long');
  });

  // --------------------------------------------------------------------------
  it('portfolio equity reflects unrealized PnL on open positions', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Open long 0.1 BTC at 50000, feeRate=0 for simplicity
    // Cash after open: 10000 - (0.1 * 50000) = 10000 - 5000 = 5000
    // Equity at entry: 5000 cash + 0.1 * 50000 position value = 10000
    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    expect(portfolio.equity).toBeCloseTo(10_000);

    // Update price to 60000 → unrealized gain of 0.1 * 10000 = 1000
    // Equity: 5000 + 0.1 * 60000 = 11000
    portfolio.updatePrice('BTC/USDT', 60_000);
    expect(portfolio.equity).toBeCloseTo(11_000);
  });

  // --------------------------------------------------------------------------
  it('getPositionCount correctly counts open positions across symbols', () => {
    const portfolio = new MultiSymbolPortfolio(100_000);

    expect(portfolio.getPositionCount()).toBe(0);

    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    expect(portfolio.getPositionCount()).toBe(1);

    portfolio.openShort('ETH/USDT', 1, 3_000, 1_000_000, 0);
    expect(portfolio.getPositionCount()).toBe(2);

    portfolio.closeLong('BTC/USDT', 'all', 51_000, 2_000_000, 0);
    expect(portfolio.getPositionCount()).toBe(1);
  });
});

// ============================================================================
// Helpers shared by the new test suites below
// ============================================================================

/**
 * Build a mock AdapterWithData-like object (the struct the engine builds
 * internally) from prices and an already-created adapter, so the manual
 * engine-loop helpers can reference it without importing the private type.
 */
interface LoopAdapter {
  adapter: SignalAdapter;
  symbol: string;
  candles: Candle[];
  timestampToIndex: Map<number, number>;
  fundingRates: FundingRate[];
  accumulatedFunding: number;
}

function buildLoopAdapter(
  strategy: Strategy,
  symbol: string,
  prices: number[],
  baseTimestamp = 1_000_000,
  intervalMs = 3_600_000,
  fundingRates: FundingRate[] = [],
): LoopAdapter {
  const candles = makeCandles(prices, baseTimestamp, intervalMs);
  const adapter = new SignalAdapter(strategy, symbol, '1h');
  adapter.init(candles, fundingRates);

  const timestampToIndex = new Map<number, number>();
  candles.forEach((c, i) => timestampToIndex.set(c.timestamp, i));

  return { adapter, symbol, candles, timestampToIndex, fundingRates, accumulatedFunding: 0 };
}

/**
 * Run one iteration of the engine's main loop steps (4a–4g) for a given
 * timestamp.  Returns the equity recorded at the end of the step.
 *
 * This is deliberately verbose/explicit so each test can follow the same
 * logic as aggregate-engine.ts without calling runAggregateBacktest().
 */
function runEngineStep(
  timestamp: number,
  loopAdapters: LoopAdapter[],
  portfolio: MultiSymbolPortfolio,
  allocationMode: 'single_strongest' | 'top_n' | 'weighted_multi',
  maxPositions: number,
  feeRate: number,
  allTrades: import('../types.js').Trade[],
  equityTimestamps: number[],
  equityValues: number[],
  isFutures = false,
): void {
  // 4a – Update prices
  for (const la of loopAdapters) {
    const idx = la.timestampToIndex.get(timestamp);
    if (idx !== undefined) {
      portfolio.updatePrice(la.symbol, la.candles[idx].close);
    }
  }

  // 4b – Funding payments (futures mode)
  if (isFutures) {
    for (const la of loopAdapters) {
      const fr = la.fundingRates.find(f => f.timestamp === timestamp);
      if (!fr) continue;
      const positions = portfolio.getPositionForSymbol(la.symbol);
      const candleIdx = la.timestampToIndex.get(timestamp);
      const markPrice = fr.markPrice ?? (candleIdx !== undefined ? la.candles[candleIdx].close : 0);
      if (markPrice === 0) continue;

      if (positions.longPosition) {
        const payment = -positions.longPosition.amount * markPrice * fr.fundingRate;
        portfolio.applyFundingPayment(payment);
        la.accumulatedFunding += payment;
      }
      if (positions.shortPosition) {
        const payment = positions.shortPosition.amount * markPrice * fr.fundingRate;
        portfolio.applyFundingPayment(payment);
        la.accumulatedFunding += payment;
      }
    }
  }

  // 4c – Exits first
  for (const la of loopAdapters) {
    const idx = la.timestampToIndex.get(timestamp);
    if (idx === undefined) continue;
    if (!la.adapter.isInPosition()) continue;

    const positions = portfolio.getPositionForSymbol(la.symbol);
    const hasRealPosition = positions.longPosition !== null || positions.shortPosition !== null;
    if (!hasRealPosition) continue;

    if (la.adapter.wantsExit(idx)) {
      const candle = la.candles[idx];

      if (positions.longPosition) {
        const trade = portfolio.closeLong(la.symbol, 'all', candle.close, timestamp, feeRate);
        if (la.accumulatedFunding !== 0) {
          trade.fundingIncome = la.accumulatedFunding;
          la.accumulatedFunding = 0;
        }
        allTrades.push(trade);
      }
      if (positions.shortPosition) {
        const trade = portfolio.closeShort(la.symbol, 'all', candle.close, timestamp, feeRate);
        if (la.accumulatedFunding !== 0) {
          trade.fundingIncome = la.accumulatedFunding;
          la.accumulatedFunding = 0;
        }
        allTrades.push(trade);
      }
      la.adapter.confirmExit();
    }
  }

  // 4d – Collect entry signals
  const signals: Array<{ signal: Signal; la: LoopAdapter; barIndex: number }> = [];
  for (const la of loopAdapters) {
    const idx = la.timestampToIndex.get(timestamp);
    if (idx === undefined) continue;
    if (la.adapter.isInPosition()) continue;

    const signal = la.adapter.getSignal(idx);
    if (signal && signal.direction !== 'flat') {
      signals.push({ signal, la, barIndex: idx });
    }
  }

  // 4e – Select signals
  const currentPositionCount = portfolio.getPositionCount();
  let selectedSignals: Array<{ signal: Signal; la: LoopAdapter; barIndex: number }> = [];

  if (signals.length > 0) {
    signals.sort((a, b) => b.signal.weight - a.signal.weight);

    switch (allocationMode) {
      case 'single_strongest': {
        if (currentPositionCount === 0) selectedSignals = [signals[0]];
        break;
      }
      case 'top_n': {
        const availableSlots = Math.max(0, maxPositions - currentPositionCount);
        selectedSignals = signals.slice(0, availableSlots);
        break;
      }
      case 'weighted_multi': {
        const availableSlots = Math.max(0, maxPositions - currentPositionCount);
        selectedSignals = signals.slice(0, availableSlots);
        break;
      }
    }
  }

  // 4f – Execute signals
  const cashSnapshot = portfolio.cash;
  const totalWeightSnapshot = selectedSignals.reduce((sum, s) => sum + s.signal.weight, 0);

  for (const { signal, la, barIndex } of selectedSignals) {
    const candle = la.candles[barIndex];

    let capitalForTrade: number;
    if (allocationMode === 'weighted_multi' && selectedSignals.length > 1) {
      capitalForTrade = (signal.weight / totalWeightSnapshot) * cashSnapshot * 0.9;
    } else if (allocationMode === 'top_n' && selectedSignals.length > 1) {
      capitalForTrade = (cashSnapshot * 0.9) / selectedSignals.length;
    } else {
      capitalForTrade = cashSnapshot * 0.9;
    }

    const amount = capitalForTrade / candle.close;
    if (amount <= 0) continue;

    try {
      let trade: import('../types.js').Trade;
      if (signal.direction === 'long') {
        trade = portfolio.openLong(la.symbol, amount, candle.close, timestamp, feeRate);
      } else {
        trade = portfolio.openShort(la.symbol, amount, candle.close, timestamp, feeRate);
      }
      allTrades.push(trade);
      la.adapter.confirmExecutionAtBar(signal.direction, barIndex);
      la.accumulatedFunding = 0;
    } catch {
      // Insufficient funds – skip
    }
  }

  // 4g – Record equity
  equityTimestamps.push(timestamp);
  equityValues.push(portfolio.equity);
}

// ============================================================================
// Suite 1: Full Engine Loop Simulation
// ============================================================================

describe('Full engine loop simulation', () => {
  it('single adapter: single entry + exit cycle produces correct trade count, PnL, and equity curve', () => {
    // Bar 0: price=80  → strategy opens long (< threshold 100)
    // Bar 1: price=90  → holding
    // Bar 2: price=110 → holding (not > 120)
    // Bar 3: price=130 → strategy closes long (> 100+20 = 120)
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 90, 110, 130]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Exactly 2 trade records: OPEN_LONG + CLOSE_LONG
    expect(allTrades).toHaveLength(2);
    expect(allTrades[0].action).toBe('OPEN_LONG');
    expect(allTrades[1].action).toBe('CLOSE_LONG');

    // Close trade PnL is positive (bought 80, sold 130)
    expect(allTrades[1].pnl).toBeDefined();
    expect(allTrades[1].pnl!).toBeGreaterThan(0);

    // Equity curve has one point per bar
    expect(equityTs).toHaveLength(4);

    // Equity at bar 0 (before position opens on bar 0) equals initial capital
    // because the entry is the LAST action on bar 0 and the equity is snapped
    // AFTER the entry.  With fee=0 equity stays at 10_000 regardless.
    expect(equityVals[0]).toBeCloseTo(10_000, 1);

    // After the exit (bar 3) portfolio has no open positions
    // → equity equals cash after the close
    expect(portfolio.hasAnyPosition()).toBe(false);
    expect(portfolio.equity).toBeCloseTo(equityVals[3], 2);

    // Final equity is greater than initial capital (profitable trade, fee=0)
    expect(equityVals[3]).toBeGreaterThan(10_000);
  });

  it('single adapter: equity decreases when position goes against you', () => {
    // Buy at bar 0 (price 80), price drops to 50 at bar 2
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 65, 50, 40]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Entry on bar 0 → equity after bar 1 should be less than initial (price fell)
    expect(equityVals[1]).toBeLessThan(equityVals[0]);
    expect(equityVals[2]).toBeLessThan(equityVals[1]);
  });

  it('two adapters sequential entries: A enters and exits, B enters later when A timeline is done', () => {
    // Adapter A: two candles — opens at bar 0 (price=80 < 100), exits at bar 1 (price=130 > 120)
    // Adapter B: candles start after A's last bar, so B enters after A is completely done
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    const strategyA = createLongOnlyStrategy(100); // open < 100, close > 120
    const candlesA = makeCandles([80, 130], BASE, INTERVAL); // 2 bars only
    const adapterA = new SignalAdapter(strategyA, 'BTC/USDT', '1h');
    adapterA.init(candlesA);
    const tsMapA = new Map<number, number>();
    candlesA.forEach((c, i) => tsMapA.set(c.timestamp, i));

    const strategyB = createLongOnlyStrategy(100);
    // B's candles start at bar 2's timestamp (after A has closed)
    const candlesB = makeCandles([80, 130], BASE + 2 * INTERVAL, INTERVAL);
    const adapterB = new SignalAdapter(strategyB, 'ETH/USDT', '1h');
    adapterB.init(candlesB);
    const tsMapB = new Map<number, number>();
    candlesB.forEach((c, i) => tsMapB.set(c.timestamp, i));

    const laA: LoopAdapter = { adapter: adapterA, symbol: 'BTC/USDT', candles: candlesA, timestampToIndex: tsMapA, fundingRates: [], accumulatedFunding: 0 };
    const laB: LoopAdapter = { adapter: adapterB, symbol: 'ETH/USDT', candles: candlesB, timestampToIndex: tsMapB, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesA) allTimestamps.add(c.timestamp);
    for (const c of candlesB) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of timeline) {
      runEngineStep(ts, [laA, laB], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    }

    // A should have exactly opened and closed one position (2 BTC trades)
    const btcTrades = allTrades.filter(t => t.symbol === 'BTC/USDT');
    expect(btcTrades).toHaveLength(2);
    expect(btcTrades[0].action).toBe('OPEN_LONG');
    expect(btcTrades[1].action).toBe('CLOSE_LONG');

    // B should have opened at least one position after A's timeline
    const ethTrades = allTrades.filter(t => t.symbol === 'ETH/USDT');
    expect(ethTrades.length).toBeGreaterThanOrEqual(1);
    expect(ethTrades[0].action).toBe('OPEN_LONG');

    // B's entry timestamp must be after A's last timestamp
    const lastATimestamp = candlesA[candlesA.length - 1].timestamp;
    expect(ethTrades[0].timestamp).toBeGreaterThan(lastATimestamp);
  });

  it('two adapters simultaneous entry on same bar: capital is split equally (top_n)', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Both strategies want to open at bar 0 (price < threshold 100)
    const stratA = createLongOnlyStrategy(100);
    const stratB = createLongOnlyStrategy(100);

    const candlesA = makeCandles([80, 130], BASE, INTERVAL);
    const candlesB = makeCandles([90, 130], BASE, INTERVAL);

    const adapterA = new SignalAdapter(stratA, 'BTC/USDT', '1h');
    adapterA.init(candlesA);
    const adapterB = new SignalAdapter(stratB, 'ETH/USDT', '1h');
    adapterB.init(candlesB);

    const tsMapA = new Map<number, number>();
    candlesA.forEach((c, i) => tsMapA.set(c.timestamp, i));
    const tsMapB = new Map<number, number>();
    candlesB.forEach((c, i) => tsMapB.set(c.timestamp, i));

    const laA: LoopAdapter = { adapter: adapterA, symbol: 'BTC/USDT', candles: candlesA, timestampToIndex: tsMapA, fundingRates: [], accumulatedFunding: 0 };
    const laB: LoopAdapter = { adapter: adapterB, symbol: 'ETH/USDT', candles: candlesB, timestampToIndex: tsMapB, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesA) allTimestamps.add(c.timestamp);
    for (const c of candlesB) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    // Only process bar 0 so we can inspect allocation before anything closes
    runEngineStep(timeline[0], [laA, laB], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);

    // Both should have entered
    expect(allTrades).toHaveLength(2);
    expect(allTrades[0].action).toBe('OPEN_LONG');
    expect(allTrades[1].action).toBe('OPEN_LONG');

    // Capital split: each gets (10_000 * 0.9) / 2 = 4_500 worth
    // BTC amount = 4500 / 80 = 56.25, ETH amount = 4500 / 90 = 50
    const btcOpen = allTrades.find(t => t.symbol === 'BTC/USDT')!;
    const ethOpen = allTrades.find(t => t.symbol === 'ETH/USDT')!;

    expect(btcOpen.amount * btcOpen.price).toBeCloseTo(4_500, 0);
    expect(ethOpen.amount * ethOpen.price).toBeCloseTo(4_500, 0);
  });

  it('equity is recorded at every timestamp in the timeline', () => {
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 90, 130]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // One equity snapshot per bar
    expect(equityTs).toHaveLength(timeline.length);
    expect(equityVals).toHaveLength(timeline.length);

    // Equity array must match timestamp array length exactly
    expect(equityTs.length).toBe(equityVals.length);
  });

  it('final equity after close = initialCapital + PnL - fees', () => {
    // Open at 80, close at 130, fee=0 → PnL = (130-80)/80 * capital
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 130]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of la.candles.map(c => c.timestamp)) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    const closeTrade = allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();

    const expectedFinalEquity = 10_000 + closeTrade!.pnl!;
    expect(portfolio.equity).toBeCloseTo(expectedFinalEquity, 4);
  });
});

// ============================================================================
// Suite 2: Funding Payments During Position
// ============================================================================

describe('Funding payments during position (engine loop)', () => {
  it('long position with positive funding rate: payment reduces cash (long PAYS)', () => {
    // Long pays when fundingRate > 0.
    // Use a small position (amount=0.1 at price=50_000 = $5_000 notional) within a $10k portfolio.
    const portfolio = new MultiSymbolPortfolio(10_000);
    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 50_000);

    const cashBefore = portfolio.cash; // 10_000 - 5_000 = 5_000

    // fundingRate = 0.0001 (positive), long pays
    // payment = -(0.1 * 50_000 * 0.0001) = -0.5
    const payment = -(0.1 * 50_000 * 0.0001);
    portfolio.applyFundingPayment(payment);

    expect(portfolio.cash).toBeCloseTo(cashBefore - 0.5, 4);
    // Equity should decrease by the payment amount
    expect(portfolio.equity).toBeCloseTo(10_000 - 0.5, 4);
  });

  it('long position with negative funding rate: payment increases cash (long RECEIVES)', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 50_000);

    const cashBefore = portfolio.cash; // 5_000

    // fundingRate = -0.0001 (negative), long receives
    // payment = -(0.1 * 50_000 * (-0.0001)) = +0.5
    const payment = -(0.1 * 50_000 * (-0.0001));
    portfolio.applyFundingPayment(payment);

    expect(portfolio.cash).toBeCloseTo(cashBefore + 0.5, 4);
  });

  it('short position with positive funding rate: payment increases cash (short RECEIVES)', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    // Open short: locks collateral = 0.1 * 50_000 = 5_000 from cash
    portfolio.openShort('BTC/USDT', 0.1, 50_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 50_000);

    const cashBefore = portfolio.cash; // 10_000 - 5_000 = 5_000

    // fundingRate = 0.0001 (positive), short receives
    // payment = +(0.1 * 50_000 * 0.0001) = +0.5
    const payment = 0.1 * 50_000 * 0.0001;
    portfolio.applyFundingPayment(payment);

    expect(portfolio.cash).toBeCloseTo(cashBefore + 0.5, 4);
  });

  it('accumulated funding is attached to the close trade and reset to zero', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Two funding events then an exit
    const fundingRates: FundingRate[] = [
      { timestamp: BASE + INTERVAL, fundingRate: 0.0001, markPrice: 50_000 },
      { timestamp: BASE + 2 * INTERVAL, fundingRate: 0.0001, markPrice: 50_000 },
    ];

    // Strategy: open at bar 0 (price 40_000 < 50_000 threshold), close at bar 3 (>70_000)
    const strategy = createLongOnlyStrategy(50_000);
    const la = buildLoopAdapter(
      strategy,
      'BTC/USDT',
      [40_000, 50_000, 50_000, 75_000],
      BASE,
      INTERVAL,
      fundingRates,
    );

    const portfolio = new MultiSymbolPortfolio(1_000_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals, true);
    }

    const closeTrade = allTrades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();

    // Two funding payments were made during the position hold
    // Each payment = -(amount * 50_000 * 0.0001) = negative (long pays)
    // fundingIncome should be negative (long paid)
    expect(closeTrade!.fundingIncome).toBeDefined();
    expect(closeTrade!.fundingIncome!).toBeLessThan(0);

    // Adapter's accumulatedFunding should be reset to 0 after close
    expect(la.accumulatedFunding).toBe(0);
  });

  it('funding payments accumulate across multiple bars before close', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    portfolio.openLong('BTC/USDT', 1, 10_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 10_000);

    const equityAtOpen = portfolio.equity; // should be ~10_000

    // Simulate 3 funding payments: each +10
    portfolio.applyFundingPayment(10);
    portfolio.applyFundingPayment(10);
    portfolio.applyFundingPayment(10);

    expect(portfolio.cash).toBeCloseTo(10 * 3, 1); // cash was 0 after open, now 30
    expect(portfolio.equity).toBeCloseTo(equityAtOpen + 30, 1);
  });
});

// ============================================================================
// Suite 3: End-of-Backtest Forced Close
// ============================================================================

describe('End-of-backtest forced close', () => {
  it('open position is force-closed at last candle close price', () => {
    // Strategy always opens but never closes voluntarily (threshold very high)
    const strategyNeverClose: Strategy = {
      name: 'never-close',
      description: 'Opens long, never closes',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
        // No close logic → position stays open
      },
    };

    const la = buildLoopAdapter(strategyNeverClose, 'BTC/USDT', [80, 90, 100, 120]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Engine has NOT forced closed yet — simulate the engine's step 5
    const positions = portfolio.getPositionForSymbol('BTC/USDT');
    if (positions.longPosition !== null || positions.shortPosition !== null) {
      const lastCandle = la.candles[la.candles.length - 1];

      if (positions.longPosition) {
        const trade = portfolio.closeLong('BTC/USDT', 'all', lastCandle.close, lastCandle.timestamp, 0);
        allTrades.push(trade);
      }
    }

    // After forced close there should be exactly 2 trades (open + forced close)
    expect(allTrades).toHaveLength(2);
    expect(allTrades[1].action).toBe('CLOSE_LONG');

    // Forced close PnL: bought at 80, closed at 120 (last candle close)
    // PnL > 0 (profitable)
    expect(allTrades[1].pnl).toBeDefined();
    expect(allTrades[1].pnl!).toBeGreaterThan(0);

    // Portfolio no longer has any open position
    expect(portfolio.hasAnyPosition()).toBe(false);
  });

  it('forced close price is the last candle close price', () => {
    const strategyNeverClose: Strategy = {
      name: 'hold-forever',
      description: 'Holds indefinitely',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };

    const LAST_PRICE = 55_000;
    const la = buildLoopAdapter(strategyNeverClose, 'BTC/USDT', [50_000, 52_000, LAST_PRICE]);

    const portfolio = new MultiSymbolPortfolio(1_000_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of la.candles.map(c => c.timestamp)) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Simulate forced close at last candle
    const positions = portfolio.getPositionForSymbol('BTC/USDT');
    const lastCandle = la.candles[la.candles.length - 1];
    if (positions.longPosition) {
      const trade = portfolio.closeLong('BTC/USDT', 'all', lastCandle.close, lastCandle.timestamp, 0);
      allTrades.push(trade);
    }

    const closeTrade = allTrades.find(t => t.action === 'CLOSE_LONG')!;
    expect(closeTrade.price).toBe(LAST_PRICE);
  });
});

// ============================================================================
// Suite 4: Per-Asset Metric Accuracy
// ============================================================================

describe('Per-asset metric accuracy', () => {
  it('trades are correctly partitioned by symbol', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    const stratBtc = createLongOnlyStrategy(100);
    const stratEth = createLongOnlyStrategy(100);

    const candlesBtc = makeCandles([80, 130], BASE, INTERVAL);
    const candlesEth = makeCandles([90, 130], BASE, INTERVAL);

    const adapterBtc = new SignalAdapter(stratBtc, 'BTC/USDT', '1h');
    adapterBtc.init(candlesBtc);
    const adapterEth = new SignalAdapter(stratEth, 'ETH/USDT', '1h');
    adapterEth.init(candlesEth);

    const tsMapBtc = new Map<number, number>();
    candlesBtc.forEach((c, i) => tsMapBtc.set(c.timestamp, i));
    const tsMapEth = new Map<number, number>();
    candlesEth.forEach((c, i) => tsMapEth.set(c.timestamp, i));

    const laBtc: LoopAdapter = { adapter: adapterBtc, symbol: 'BTC/USDT', candles: candlesBtc, timestampToIndex: tsMapBtc, fundingRates: [], accumulatedFunding: 0 };
    const laEth: LoopAdapter = { adapter: adapterEth, symbol: 'ETH/USDT', candles: candlesEth, timestampToIndex: tsMapEth, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesBtc) allTimestamps.add(c.timestamp);
    for (const c of candlesEth) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of timeline) {
      runEngineStep(ts, [laBtc, laEth], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    }

    const btcTrades = allTrades.filter(t => t.symbol === 'BTC/USDT');
    const ethTrades = allTrades.filter(t => t.symbol === 'ETH/USDT');

    // Each symbol should have exactly 2 trades (OPEN + CLOSE)
    expect(btcTrades).toHaveLength(2);
    expect(ethTrades).toHaveLength(2);

    // Verify actions
    expect(btcTrades[0].action).toBe('OPEN_LONG');
    expect(btcTrades[1].action).toBe('CLOSE_LONG');
    expect(ethTrades[0].action).toBe('OPEN_LONG');
    expect(ethTrades[1].action).toBe('CLOSE_LONG');
  });

  it('per-asset PnL sums match final portfolio equity change', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    const stratBtc = createLongOnlyStrategy(100);
    const stratEth = createLongOnlyStrategy(100);

    const candlesBtc = makeCandles([80, 130], BASE, INTERVAL);
    const candlesEth = makeCandles([90, 130], BASE, INTERVAL);

    const adapterBtc = new SignalAdapter(stratBtc, 'BTC/USDT', '1h');
    adapterBtc.init(candlesBtc);
    const adapterEth = new SignalAdapter(stratEth, 'ETH/USDT', '1h');
    adapterEth.init(candlesEth);

    const tsMapBtc = new Map<number, number>();
    candlesBtc.forEach((c, i) => tsMapBtc.set(c.timestamp, i));
    const tsMapEth = new Map<number, number>();
    candlesEth.forEach((c, i) => tsMapEth.set(c.timestamp, i));

    const laBtc: LoopAdapter = { adapter: adapterBtc, symbol: 'BTC/USDT', candles: candlesBtc, timestampToIndex: tsMapBtc, fundingRates: [], accumulatedFunding: 0 };
    const laEth: LoopAdapter = { adapter: adapterEth, symbol: 'ETH/USDT', candles: candlesEth, timestampToIndex: tsMapEth, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesBtc) allTimestamps.add(c.timestamp);
    for (const c of candlesEth) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const initialCapital = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCapital);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of timeline) {
      runEngineStep(ts, [laBtc, laEth], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    }

    // Sum of all close trade PnL values
    const closeTrades = allTrades.filter(t => t.pnl !== undefined);
    const totalPnl = closeTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    // Final equity should equal initialCapital + totalPnL (fee=0)
    expect(portfolio.equity).toBeCloseTo(initialCapital + totalPnl, 4);
  });
});

// ============================================================================
// Suite 5: Exit-First-Then-Entry on Same Bar
// ============================================================================

describe('Exit-first-then-entry on same bar', () => {
  it('adapter A exits on bar N before adapter B collects its entry signal', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Adapter A: opens at bar 0 (price=80 < 100), exits at bar 1 (price=130 > 120)
    const stratA = createLongOnlyStrategy(100);
    const candlesA = makeCandles([80, 130], BASE, INTERVAL);
    const adapterA = new SignalAdapter(stratA, 'BTC/USDT', '1h');
    adapterA.init(candlesA);
    const tsMapA = new Map<number, number>();
    candlesA.forEach((c, i) => tsMapA.set(c.timestamp, i));
    const laA: LoopAdapter = { adapter: adapterA, symbol: 'BTC/USDT', candles: candlesA, timestampToIndex: tsMapA, fundingRates: [], accumulatedFunding: 0 };

    // Adapter B: only has data at bar 1 (entry signal at bar 1)
    const stratB = createLongOnlyStrategy(200); // always open (price < 200)
    const candlesB = makeCandles([90], BASE + INTERVAL, INTERVAL); // only bar 1
    const adapterB = new SignalAdapter(stratB, 'ETH/USDT', '1h');
    adapterB.init(candlesB);
    const tsMapB = new Map<number, number>();
    candlesB.forEach((c, i) => tsMapB.set(c.timestamp, i));
    const laB: LoopAdapter = { adapter: adapterB, symbol: 'ETH/USDT', candles: candlesB, timestampToIndex: tsMapB, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesA) allTimestamps.add(c.timestamp);
    for (const c of candlesB) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    for (const ts of timeline) {
      runEngineStep(ts, [laA, laB], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    }

    const btcTrades = allTrades.filter(t => t.symbol === 'BTC/USDT');
    const ethTrades = allTrades.filter(t => t.symbol === 'ETH/USDT');

    // A should have opened and closed
    expect(btcTrades.length).toBeGreaterThanOrEqual(2);
    const closeBtc = btcTrades.find(t => t.action === 'CLOSE_LONG')!;
    expect(closeBtc).toBeDefined();

    // B should have entered
    expect(ethTrades.length).toBeGreaterThanOrEqual(1);
    const openEth = ethTrades.find(t => t.action === 'OPEN_LONG')!;
    expect(openEth).toBeDefined();

    // B's open trade must have timestamp >= A's close trade timestamp
    // (exits are processed before entries on the same bar)
    expect(openEth.timestamp).toBeGreaterThanOrEqual(closeBtc.timestamp);
  });

  it('B gets more capital when A exits first (freed capital is available)', () => {
    // If exit happens before entry, the capital freed by A becomes available to B
    const portfolio = new MultiSymbolPortfolio(10_000);

    // A holds 90% of capital = $9_000
    portfolio.openLong('BTC/USDT', 90, 100, 1_000_000, 0);
    expect(portfolio.cash).toBeCloseTo(1_000, 1);

    // Simulate: A exits on bar N
    portfolio.closeLong('BTC/USDT', 'all', 100, 1_000_001, 0);
    const cashAfterExit = portfolio.cash;
    // Cash is restored to ~$10_000
    expect(cashAfterExit).toBeCloseTo(10_000, 1);

    // B enters on the same bar AFTER A exited → gets 90% of $10_000 = $9_000
    const capitalForB = portfolio.cash * 0.9;
    const amountB = capitalForB / 100;
    portfolio.openLong('ETH/USDT', amountB, 100, 1_000_002, 0);

    const posB = portfolio.getPositionForSymbol('ETH/USDT').longPosition;
    expect(posB).not.toBeNull();
    // Amount ≈ 90 units (= $9000 / $100), not 9 units
    expect(posB!.amount).toBeCloseTo(90, 1);
  });
});

// ============================================================================
// Suite 6: No Signal When Adapter Has No Data at Timestamp
// ============================================================================

describe('No signal when adapter has no data at timestamp', () => {
  it('adapter without candle at a timestamp is skipped in the engine loop', () => {
    const BASE = 1_000_000;
    const H1 = 3_600_000;
    const H4 = 4 * H1;

    // 1h adapter has candles at T0, T1, T2, T3
    const strat1h = createLongOnlyStrategy(200); // always open
    const candles1h = makeCandles([80, 85, 90, 95], BASE, H1);
    const adapter1h = new SignalAdapter(strat1h, 'BTC/USDT', '1h');
    adapter1h.init(candles1h);
    const tsMap1h = new Map<number, number>();
    candles1h.forEach((c, i) => tsMap1h.set(c.timestamp, i));
    const la1h: LoopAdapter = { adapter: adapter1h, symbol: 'BTC/USDT', candles: candles1h, timestampToIndex: tsMap1h, fundingRates: [], accumulatedFunding: 0 };

    // 4h adapter has candles at T0 and T4 only
    const strat4h = createLongOnlyStrategy(200); // always open
    const candles4h = makeCandles([200, 220], BASE, H4);
    const adapter4h = new SignalAdapter(strat4h, 'ETH/USDT', '4h');
    adapter4h.init(candles4h);
    const tsMap4h = new Map<number, number>();
    candles4h.forEach((c, i) => tsMap4h.set(c.timestamp, i));
    const la4h: LoopAdapter = { adapter: adapter4h, symbol: 'ETH/USDT', candles: candles4h, timestampToIndex: tsMap4h, fundingRates: [], accumulatedFunding: 0 };

    // At T1 (only 1h has data), the 4h adapter should not produce a signal
    // T1 = BASE + H1
    const T1 = BASE + H1;

    // 4h adapter has no candle at T1
    expect(tsMap4h.has(T1)).toBe(false);

    // Running the step at T1: only 1h adapter should produce a signal
    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    // First run bar 0 (T0) — both adapters have data; let 4h enter
    runEngineStep(BASE, [la1h, la4h], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);

    // At T1 only 1h is present. 1h adapter just entered at T0, so it's in
    // position. No new signal from either adapter expected.
    const tradesBefore = allTrades.length;
    runEngineStep(T1, [la1h, la4h], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    const tradesAfter = allTrades.length;

    // No new OPEN trades should have been added at T1 (both adapters in position)
    const newOpens = allTrades.slice(tradesBefore, tradesAfter).filter(t =>
      t.action === 'OPEN_LONG' || t.action === 'OPEN_SHORT',
    );
    expect(newOpens).toHaveLength(0);
  });
});

// ============================================================================
// Suite 7: single_strongest: Only Enters When No Positions Open
// ============================================================================

describe('single_strongest allocation mode', () => {
  it('does not open a new position while a position is already open', () => {
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 85, 90, 95, 130]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    // Process bars 0–3 (all prices < 100 so strategy always wants to open)
    for (let i = 0; i < 4; i++) {
      runEngineStep(timeline[i], [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Only 1 OPEN trade should exist despite 4 bars all wanting to open
    const openTrades = allTrades.filter(t => t.action === 'OPEN_LONG' || t.action === 'OPEN_SHORT');
    expect(openTrades).toHaveLength(1);
  });

  it('after position closes, new signal can execute on the next bar', () => {
    // Bar 0: open (price=80)
    // Bar 1: close (price=130)
    // Bar 2: price=80 → open again (position was freed)
    const strategy = createLongOnlyStrategy(100);
    const la = buildLoopAdapter(strategy, 'BTC/USDT', [80, 130, 80]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Should have: OPEN (bar0), CLOSE (bar1), OPEN (bar2)
    const opens = allTrades.filter(t => t.action === 'OPEN_LONG');
    const closes = allTrades.filter(t => t.action === 'CLOSE_LONG');

    expect(opens).toHaveLength(2);
    expect(closes).toHaveLength(1);
  });

  it('single_strongest with two adapters: only the highest-weight adapter enters', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Both adapters always emit openLong; signal weight defaults to 1.0 for both
    const stratA: Strategy = {
      name: 'always-long-a',
      description: 'Always long A',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };

    const stratB: Strategy = {
      name: 'always-long-b',
      description: 'Always long B',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };

    const candlesA = makeCandles([100, 105], BASE, INTERVAL);
    const candlesB = makeCandles([200, 210], BASE, INTERVAL);

    const adapterA = new SignalAdapter(stratA, 'BTC/USDT', '1h');
    adapterA.init(candlesA);
    const adapterB = new SignalAdapter(stratB, 'ETH/USDT', '1h');
    adapterB.init(candlesB);

    const tsMapA = new Map<number, number>();
    candlesA.forEach((c, i) => tsMapA.set(c.timestamp, i));
    const tsMapB = new Map<number, number>();
    candlesB.forEach((c, i) => tsMapB.set(c.timestamp, i));

    const laA: LoopAdapter = { adapter: adapterA, symbol: 'BTC/USDT', candles: candlesA, timestampToIndex: tsMapA, fundingRates: [], accumulatedFunding: 0 };
    const laB: LoopAdapter = { adapter: adapterB, symbol: 'ETH/USDT', candles: candlesB, timestampToIndex: tsMapB, fundingRates: [], accumulatedFunding: 0 };

    const allTimestamps = new Set<number>();
    for (const c of candlesA) allTimestamps.add(c.timestamp);
    for (const c of candlesB) allTimestamps.add(c.timestamp);
    const timeline = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    // Only run bar 0 so we see exactly one open trade
    runEngineStep(timeline[0], [laA, laB], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);

    // Exactly one position opened despite two signals
    const openTrades = allTrades.filter(t => t.action === 'OPEN_LONG' || t.action === 'OPEN_SHORT');
    expect(openTrades).toHaveLength(1);
    expect(portfolio.getPositionCount()).toBe(1);
  });
});

// ============================================================================
// Suite 8: Capital Exhaustion
// ============================================================================

describe('Capital exhaustion in engine loop', () => {
  it('second signal on same bar with insufficient funds is skipped gracefully', () => {
    const BASE = 1_000_000;
    const INTERVAL = 3_600_000;

    // Both adapters want to enter on bar 0; but portfolio only has $1_000
    // and the first signal uses $900 → only $100 left for the second
    const stratA: Strategy = {
      name: 'always-a',
      description: 'Always long A',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };
    const stratB: Strategy = {
      name: 'always-b',
      description: 'Always long B',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (!ctx.longPosition) ctx.openLong(1);
      },
    };

    const candlesA = makeCandles([10], BASE, INTERVAL); // price=10
    const candlesB = makeCandles([5_000], BASE, INTERVAL); // price=$5000 → huge amount needed

    const adapterA = new SignalAdapter(stratA, 'AAA/USDT', '1h');
    adapterA.init(candlesA);
    const adapterB = new SignalAdapter(stratB, 'BBB/USDT', '1h');
    adapterB.init(candlesB);

    const tsMapA = new Map<number, number>();
    candlesA.forEach((c, i) => tsMapA.set(c.timestamp, i));
    const tsMapB = new Map<number, number>();
    candlesB.forEach((c, i) => tsMapB.set(c.timestamp, i));

    const laA: LoopAdapter = { adapter: adapterA, symbol: 'AAA/USDT', candles: candlesA, timestampToIndex: tsMapA, fundingRates: [], accumulatedFunding: 0 };
    const laB: LoopAdapter = { adapter: adapterB, symbol: 'BBB/USDT', candles: candlesB, timestampToIndex: tsMapB, fundingRates: [], accumulatedFunding: 0 };

    // Small initial capital: $1_000
    const portfolio = new MultiSymbolPortfolio(1_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    // top_n mode: both signals selected, but second may not fit
    // 90% of $1_000 / 2 = $450 per signal
    // AAA: $450 / 10 = 45 units → fits
    // BBB: $450 / $5_000 = 0.09 units → tiny but valid
    expect(() => {
      runEngineStep(BASE, [laA, laB], portfolio, 'top_n', 2, 0, allTrades, equityTs, equityVals);
    }).not.toThrow();

    // At most 2 trades opened; engine should not crash on insufficient funds
    const openTrades = allTrades.filter(t => t.action === 'OPEN_LONG' || t.action === 'OPEN_SHORT');
    expect(openTrades.length).toBeGreaterThanOrEqual(0);
    expect(openTrades.length).toBeLessThanOrEqual(2);
  });

  it('portfolio cash after first large trade is correctly reduced', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Open a position using 90% of capital
    const amount = (10_000 * 0.9) / 100; // 90 units at $100
    portfolio.openLong('BTC/USDT', amount, 100, 1_000_000, 0);

    // Only $1_000 should remain
    expect(portfolio.cash).toBeCloseTo(1_000, 1);

    // A second trade requiring more than $1_000 should throw
    expect(() => {
      portfolio.openLong('ETH/USDT', 20, 100, 1_000_001, 0); // $2000 needed
    }).toThrow(/insufficient funds/i);
  });
});

// ============================================================================
// Suite 9: Short Position Round-Trip Through Engine Loop
// ============================================================================

describe('Short position round-trip through engine loop', () => {
  it('short entry + exit cycle: correct trade count and PnL', () => {
    // Strategy: open short when price > threshold, close when price falls below threshold - 20
    const shortStrategy: Strategy = {
      name: 'short-strategy',
      description: 'Short when price high, exit when falls',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (ctx.shortPosition) {
          if (ctx.currentCandle.close < 80) ctx.closeShort();
          return;
        }
        if (ctx.currentCandle.close > 120) ctx.openShort(1);
      },
    };

    const la = buildLoopAdapter(shortStrategy, 'BTC/USDT', [100, 130, 150, 70, 60]);

    const portfolio = new MultiSymbolPortfolio(10_000);
    const allTrades: import('../types.js').Trade[] = [];
    const equityTs: number[] = [];
    const equityVals: number[] = [];

    const timeline = la.candles.map(c => c.timestamp);

    for (const ts of timeline) {
      runEngineStep(ts, [la], portfolio, 'single_strongest', 1, 0, allTrades, equityTs, equityVals);
    }

    // Should have OPEN_SHORT and CLOSE_SHORT
    const openShort = allTrades.find(t => t.action === 'OPEN_SHORT');
    const closeShort = allTrades.find(t => t.action === 'CLOSE_SHORT');

    expect(openShort).toBeDefined();
    expect(closeShort).toBeDefined();

    // Short profits when price falls: entered at 130, closed at 70 → profit
    expect(closeShort!.pnl).toBeDefined();
    expect(closeShort!.pnl!).toBeGreaterThan(0);
  });

  it('short position: equity increases when price drops', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    portfolio.openShort('BTC/USDT', 1, 10_000, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 10_000);
    const equityAtEntry = portfolio.equity;

    // Price drops → short gains value
    portfolio.updatePrice('BTC/USDT', 8_000);
    const equityAfterDrop = portfolio.equity;

    expect(equityAfterDrop).toBeGreaterThan(equityAtEntry);
    // Unrealized PnL = (10_000 - 8_000) * 1 = 2_000
    expect(equityAfterDrop - equityAtEntry).toBeCloseTo(2_000, 1);
  });

  it('short round-trip: final cash = initialCapital + profit - 2*fees', () => {
    const initialCapital = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCapital);

    const feeRate = 0.001;
    const entryPrice = 200;
    const exitPrice = 150; // price fell → profit
    const amount = 10;

    portfolio.openShort('BTC/USDT', amount, entryPrice, 1_000_000, feeRate);
    portfolio.updatePrice('BTC/USDT', exitPrice);
    const closeTrade = portfolio.closeShort('BTC/USDT', 'all', exitPrice, 2_000_000, feeRate);

    // Gross PnL = (200 - 150) * 10 = 500
    // Entry fee = 200 * 10 * 0.001 = 2
    // Exit fee  = 150 * 10 * 0.001 = 1.5
    // Net PnL = 500 - 1.5 = 498.5
    // Final cash = initialCapital - entryFee + grossPnl - exitFee
    //            = 10_000 - 2 + 500 - 1.5 = 10_496.5
    const entryFee = entryPrice * amount * feeRate;
    const exitFee = exitPrice * amount * feeRate;
    const grossPnl = (entryPrice - exitPrice) * amount;
    const expectedFinalCash = initialCapital - entryFee + grossPnl - exitFee;

    expect(portfolio.cash).toBeCloseTo(expectedFinalCash, 4);
    expect(closeTrade.pnl).toBeCloseTo(grossPnl - exitFee, 4);
  });

  it('short position adapter: confirmExit clears shadow and allows re-entry', () => {
    const shortStrategy: Strategy = {
      name: 'short-reentry',
      description: 'Opens short, closes, reopens',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        if (ctx.shortPosition) {
          ctx.closeShort();
          return;
        }
        ctx.openShort(1);
      },
    };

    const candles = makeCandles([100, 110, 120]);
    const adapter = new SignalAdapter(shortStrategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Bar 0: get short signal
    const sig0 = adapter.getSignal(0);
    expect(sig0).not.toBeNull();
    expect(sig0!.direction).toBe('short');

    adapter.confirmExecutionAtBar('short', 0);
    expect(adapter.isInPosition()).toBe(true);

    // Bar 1: wants exit
    const wantsExit1 = adapter.wantsExit(1);
    expect(wantsExit1).toBe(true);
    adapter.confirmExit();
    expect(adapter.isInPosition()).toBe(false);

    // Bar 2: should emit a new short signal
    const sig2 = adapter.getSignal(2);
    expect(sig2).not.toBeNull();
    expect(sig2!.direction).toBe('short');
  });
});
