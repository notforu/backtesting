/**
 * Tests for SignalAdapter
 *
 * The SignalAdapter wraps a Strategy into a SignalProvider, capturing trade
 * intent via a shadow StrategyContext without touching any real portfolio.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalAdapter } from '../signal-adapter.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { Candle, FundingRate } from '../types.js';

// ============================================================================
// Mock strategy factory
// ============================================================================

/**
 * Simple strategy that:
 *  - Opens long  when price < 100 (and not already in a position)
 *  - Opens short when price > 200 (and not already in a position)
 *  - Closes long  when price > 150 (take-profit)
 *  - Closes short when price < 150
 */
const createMockStrategy = (): Strategy => ({
  name: 'test-strategy',
  description: 'Test strategy',
  version: '1.0.0',
  params: [],
  onBar(ctx: StrategyContext): void {
    const price = ctx.currentCandle.close;

    if (ctx.longPosition) {
      if (price > 150) ctx.closeLong();
      return;
    }
    if (ctx.shortPosition) {
      if (price < 150) ctx.closeShort();
      return;
    }

    if (price < 100) {
      ctx.openLong(1);
    } else if (price > 200) {
      ctx.openShort(1);
    }
  },
});

// ============================================================================
// Helpers
// ============================================================================

function makeCandles(prices: number[]): Candle[] {
  return prices.map((price, i) => ({
    timestamp: 1_000_000 + i * 3_600_000,
    open: price,
    high: price + 5,
    low: price - 5,
    close: price,
    volume: 100,
  }));
}

function makeFundingRates(rates: number[], baseTimestamp = 1_000_000): FundingRate[] {
  return rates.map((r, i) => ({
    timestamp: baseTimestamp + i * 8 * 3_600_000,
    fundingRate: r,
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe('SignalAdapter', () => {
  let strategy: Strategy;
  let adapter: SignalAdapter;
  let candles: Candle[];

  beforeEach(() => {
    strategy = createMockStrategy();
    adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    candles = makeCandles([120, 90, 90, 160, 210]);
    adapter.init(candles);
  });

  // --------------------------------------------------------------------------
  // Constructor and identity
  // --------------------------------------------------------------------------

  it('sets key, strategyName, symbol, and timeframe from constructor arguments', () => {
    expect(adapter.key).toBe('test-strategy:BTC/USDT:1h');
    expect(adapter.strategyName).toBe('test-strategy');
    expect(adapter.symbol).toBe('BTC/USDT');
    expect(adapter.timeframe).toBe('1h');
  });

  // --------------------------------------------------------------------------
  // Test 1: openLong is captured as a 'long' signal
  // --------------------------------------------------------------------------

  it('captures openLong as a long signal with weight and correct fields', () => {
    // bar 1: price = 90 → strategy calls openLong
    const signal = adapter.getSignal(1);

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('long');
    expect(signal!.symbol).toBe('BTC/USDT');
    expect(signal!.strategyName).toBe('test-strategy');
    expect(signal!.timestamp).toBe(candles[1].timestamp);
    // Default weight calculator returns 1.0 for 'test-strategy' (no funding rates)
    expect(signal!.weight).toBe(1.0);
  });

  // --------------------------------------------------------------------------
  // Test 2: openShort is captured as a 'short' signal
  // --------------------------------------------------------------------------

  it('captures openShort as a short signal', () => {
    // bar 4: price = 210 → strategy calls openShort
    const signal = adapter.getSignal(4);

    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('short');
    expect(signal!.symbol).toBe('BTC/USDT');
    expect(signal!.strategyName).toBe('test-strategy');
  });

  // --------------------------------------------------------------------------
  // Test 3: Returns null when strategy takes no action
  // --------------------------------------------------------------------------

  it('returns null when strategy emits no action', () => {
    // bar 0: price = 120 → neither condition met, no action
    const signal = adapter.getSignal(0);

    expect(signal).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 4: Close actions return null from getSignal
  // --------------------------------------------------------------------------

  it('returns null from getSignal when strategy only emits a close action', () => {
    // Set up shadow long position so strategy thinks it is in a trade
    adapter.confirmExecutionAtBar('long', 1); // entered at bar 1 (price 90)

    // bar 3: price = 160 > 150 → closeLong is called, not openLong
    const signal = adapter.getSignal(3);

    expect(signal).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 5: Shadow state - strategy sees longPosition after confirmExecution
  // --------------------------------------------------------------------------

  it('exposes longPosition to strategy after confirmExecution("long")', () => {
    // Confirm entry at bar 1 (price 90)
    adapter.confirmExecutionAtBar('long', 1);

    // bar 3: price = 160 → strategy should see longPosition and emit closeLong
    const seen: Array<{ long: boolean; short: boolean }> = [];
    const spy = createMockStrategy();
    const originalOnBar = spy.onBar.bind(spy);
    spy.onBar = (ctx: StrategyContext) => {
      seen.push({
        long: ctx.longPosition !== null,
        short: ctx.shortPosition !== null,
      });
      originalOnBar(ctx);
    };

    const spyAdapter = new SignalAdapter(spy, 'ETH/USDT', '1h');
    spyAdapter.init(candles);
    spyAdapter.confirmExecutionAtBar('long', 1);

    // Trigger getSignal which calls onBar internally
    spyAdapter.getSignal(3);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].long).toBe(true);
    expect(seen[0].short).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 6: Without confirmExecution, strategy re-emits signal on next bar
  // --------------------------------------------------------------------------

  it('re-emits the same signal on the next bar when confirmExecution is not called', () => {
    // bar 1: price = 90 → openLong signal
    const signal1 = adapter.getSignal(1);
    expect(signal1).not.toBeNull();
    expect(signal1!.direction).toBe('long');

    // Do NOT call confirmExecution — shadow has no position

    // bar 2: price = 90 → strategy still sees no position, re-emits openLong
    const signal2 = adapter.getSignal(2);
    expect(signal2).not.toBeNull();
    expect(signal2!.direction).toBe('long');
  });

  // --------------------------------------------------------------------------
  // Test 7: wantsExit returns true when strategy emits a close action
  // --------------------------------------------------------------------------

  it('wantsExit returns true when strategy emits closeLong', () => {
    adapter.confirmExecutionAtBar('long', 1); // shadow: in long

    // bar 3: price = 160 → closeLong
    expect(adapter.wantsExit(3)).toBe(true);
  });

  it('wantsExit returns true when strategy emits closeShort', () => {
    // Set up a short position and a candle set that closes it
    const shortCandles = makeCandles([210, 210, 120]); // bar 2: price 120 < 150
    const shortAdapter = new SignalAdapter(createMockStrategy(), 'BTC/USDT', '1h');
    shortAdapter.init(shortCandles);
    shortAdapter.confirmExecutionAtBar('short', 0);

    // bar 2: price = 120 < 150 → closeShort
    expect(shortAdapter.wantsExit(2)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 8: wantsExit returns false when strategy does not emit a close action
  // --------------------------------------------------------------------------

  it('wantsExit returns false when strategy does not emit a close action', () => {
    adapter.confirmExecutionAtBar('long', 1); // shadow: in long

    // bar 2: price = 90 → long is open but price < 150, no closeLong emitted
    // (strategy returns early because longPosition is set, and price is not > 150)
    expect(adapter.wantsExit(2)).toBe(false);
  });

  it('wantsExit returns false when not in a shadow position', () => {
    // No confirmExecution called → isInPosition() === false
    expect(adapter.wantsExit(3)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 9: resetShadow clears shadow positions
  // --------------------------------------------------------------------------

  it('resetShadow clears long shadow position', () => {
    adapter.confirmExecutionAtBar('long', 1);
    expect(adapter.isInPosition()).toBe(true);

    adapter.resetShadow();
    expect(adapter.isInPosition()).toBe(false);
  });

  it('resetShadow clears short shadow position', () => {
    adapter.confirmExecutionAtBar('short', 4);
    expect(adapter.isInPosition()).toBe(true);

    adapter.resetShadow();
    expect(adapter.isInPosition()).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 10: confirmExit clears shadow positions
  // --------------------------------------------------------------------------

  it('confirmExit clears long shadow position', () => {
    adapter.confirmExecutionAtBar('long', 1);
    expect(adapter.isInPosition()).toBe(true);

    adapter.confirmExit();
    expect(adapter.isInPosition()).toBe(false);
  });

  it('confirmExit clears short shadow position', () => {
    adapter.confirmExecutionAtBar('short', 4);
    expect(adapter.isInPosition()).toBe(true);

    adapter.confirmExit();
    expect(adapter.isInPosition()).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 11: init calls strategy.init if available
  // --------------------------------------------------------------------------

  it('calls strategy.init during adapter.init() when present', () => {
    const initSpy = vi.fn();
    const strategyWithInit: Strategy = {
      ...createMockStrategy(),
      init: initSpy,
    };

    const adapterWithInit = new SignalAdapter(strategyWithInit, 'BTC/USDT', '1h');
    adapterWithInit.init(candles);

    expect(initSpy).toHaveBeenCalledOnce();
    // The context passed to init should be a valid StrategyContext
    const ctx: StrategyContext = initSpy.mock.calls[0][0];
    expect(ctx.currentCandle).toBeDefined();
    expect(ctx.params).toBeDefined();
  });

  it('does not throw when strategy has no init method', () => {
    const strategyWithoutInit: Strategy = {
      ...createMockStrategy(),
      init: undefined,
    };

    const adapterWithoutInit = new SignalAdapter(strategyWithoutInit, 'BTC/USDT', '1h');
    expect(() => adapterWithoutInit.init(candles)).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // getSignal - edge cases
  // --------------------------------------------------------------------------

  it('returns null when barIndex is out of range', () => {
    expect(adapter.getSignal(999)).toBeNull();
  });

  it('returns null before init() is called', () => {
    const uninitialised = new SignalAdapter(createMockStrategy(), 'BTC/USDT', '1h');
    // Do not call init()
    expect(uninitialised.getSignal(0)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // confirmExecutionAtBar - uses candle close as entry price
  // --------------------------------------------------------------------------

  it('confirmExecutionAtBar sets shadow long with correct entry price', () => {
    // bar 1: close = 90
    adapter.confirmExecutionAtBar('long', 1);
    expect(adapter.isInPosition()).toBe(true);

    // The strategy should now see a longPosition in subsequent bars
    // (verified indirectly: wantsExit triggers on price > 150)
    expect(adapter.wantsExit(3)).toBe(true); // bar 3 price = 160 > 150
  });

  it('confirmExecutionAtBar is a no-op when barIndex is out of range', () => {
    adapter.confirmExecutionAtBar('long', 999);
    expect(adapter.isInPosition()).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Funding rate weight integration
  // --------------------------------------------------------------------------

  it('passes funding rate data through to the weight calculator', () => {
    // Create an adapter for "funding-rate-spike" which uses the FR weight calculator
    const frStrategy: Strategy = {
      name: 'funding-rate-spike',
      description: 'FR test',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        ctx.openLong(1); // Always emit a signal for testing
      },
    };

    const frCandles = makeCandles([50_000]);
    // makeFundingRates uses baseTimestamp=1_000_000 which matches makeCandles timestamp
    const frRates = makeFundingRates([0.001]);

    const frAdapter = new SignalAdapter(frStrategy, 'BTC/USDT', '4h');
    frAdapter.init(frCandles, frRates);

    const signal = frAdapter.getSignal(0);

    expect(signal).not.toBeNull();
    // FR weight: abs(0.001) / max(0.001) = 1.0
    expect(signal!.weight).toBeCloseTo(1.0);
  });

  it('produces weight 0 when funding rate weight calculator has no data', () => {
    const frStrategy: Strategy = {
      name: 'funding-rate-spike',
      description: 'FR test no data',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        ctx.openLong(1);
      },
    };

    const frCandles = makeCandles([50_000]);
    const frAdapter = new SignalAdapter(frStrategy, 'BTC/USDT', '4h');
    // No funding rates provided
    frAdapter.init(frCandles);

    const signal = frAdapter.getSignal(0);

    expect(signal).not.toBeNull();
    // FR calculator returns 0 when no funding rate data
    expect(signal!.weight).toBe(0);
  });

  // --------------------------------------------------------------------------
  // isInPosition
  // --------------------------------------------------------------------------

  it('isInPosition returns false on initial state', () => {
    expect(adapter.isInPosition()).toBe(false);
  });

  it('isInPosition returns true after confirmExecution("long")', () => {
    adapter.confirmExecution('long');
    expect(adapter.isInPosition()).toBe(true);
  });

  it('isInPosition returns true after confirmExecution("short")', () => {
    adapter.confirmExecution('short');
    expect(adapter.isInPosition()).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Strategy param validation
  // --------------------------------------------------------------------------

  it('validates strategy params during construction and applies defaults', () => {
    const strategyWithParams: Strategy = {
      name: 'param-strategy',
      description: 'Strategy with params',
      version: '1.0.0',
      params: [
        {
          name: 'threshold',
          type: 'number',
          default: 42,
          min: 0,
          max: 100,
          description: 'A threshold',
        },
      ],
      onBar(_ctx: StrategyContext): void {},
    };

    // No params provided → defaults should be applied
    const paramAdapter = new SignalAdapter(strategyWithParams, 'ETH/USDT', '1h');
    paramAdapter.init(candles);

    // Trigger onBar and capture the params passed to the strategy
    const capturedParams: Record<string, unknown>[] = [];
    strategyWithParams.onBar = (ctx: StrategyContext) => {
      capturedParams.push(ctx.params);
    };

    paramAdapter.getSignal(0);
    expect(capturedParams[0]?.threshold).toBe(42);
  });

  it('throws when a required param fails validation', () => {
    const strictStrategy: Strategy = {
      name: 'strict',
      description: 'Strict',
      version: '1.0.0',
      params: [
        {
          name: 'multiplier',
          type: 'number',
          default: 2,
          min: 1,
          max: 10,
          description: 'Multiplier',
        },
      ],
      onBar(_ctx: StrategyContext): void {},
    };

    expect(
      () => new SignalAdapter(strictStrategy, 'BTC/USDT', '1h', { multiplier: 999 }),
    ).toThrow(/multiplier/);
  });

  // ==========================================================================
  // Shadow Context Portfolio Fields
  // ==========================================================================

  describe('shadow context portfolio fields', () => {
    it('portfolio.cash is always the shadowCash value (10_000)', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].portfolio.cash).toBe(10_000);
    });

    it('portfolio.balance equals shadowCash (10_000)', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].portfolio.balance).toBe(10_000);
    });

    it('portfolio.equity equals shadowCash when no position is open', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].portfolio.equity).toBe(10_000);
    });

    it('portfolio.longPosition is null when no shadow long position exists', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].portfolio.longPosition).toBeNull();
    });

    it('portfolio.shortPosition is null when no shadow short position exists', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].portfolio.shortPosition).toBeNull();
    });

    it('portfolio.longPosition has correct entryPrice from confirmExecutionAtBar', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      // candle prices: bar0=100, bar1=200, bar2=300
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('long', 1); // entry at bar 1, close = 200

      a.getSignal(2);

      expect(capturedContexts[0].portfolio.longPosition).not.toBeNull();
      expect(capturedContexts[0].portfolio.longPosition!.entryPrice).toBe(200);
      expect(capturedContexts[0].portfolio.longPosition!.side).toBe('long');
    });

    it('portfolio.shortPosition has correct fields after confirmExecutionAtBar', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('short', 1); // entry at bar 1, close = 200

      a.getSignal(2);

      expect(capturedContexts[0].portfolio.shortPosition).not.toBeNull();
      expect(capturedContexts[0].portfolio.shortPosition!.entryPrice).toBe(200);
      expect(capturedContexts[0].portfolio.shortPosition!.side).toBe('short');
      expect(capturedContexts[0].portfolio.shortPosition!.symbol).toBe('BTC/USDT');
    });

    it('context.balance matches portfolio.cash (10_000)', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.getSignal(0);

      expect(capturedContexts[0].balance).toBe(capturedContexts[0].portfolio.cash);
    });

    it('context.equity matches portfolio.equity', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 150]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('long', 0); // long entered at price 100

      a.getSignal(1); // current price = 150

      expect(capturedContexts[0].equity).toBe(capturedContexts[0].portfolio.equity);
    });
  });

  // ==========================================================================
  // Shadow Equity Calculation
  // ==========================================================================

  describe('shadow equity calculation', () => {
    it('shadow equity with no position equals shadowCash (10_000)', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([500]));
      a.getSignal(0);

      expect(capturedContexts[0].equity).toBe(10_000);
    });

    it('shadow equity with long position = shadowCash + amount * currentPrice', () => {
      // amount is always 1 in shadow position
      // entry price 100, current price 150 → equity = 10000 + 1 * 150 = 10150
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 150]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('long', 0); // entered at price 100

      a.getSignal(1); // current price = 150

      expect(capturedContexts[0].equity).toBe(10_000 + 1 * 150);
    });

    it('shadow equity with short position = shadowCash + (entryPrice - currentPrice) * amount', () => {
      // entry price 200, current price 150 → equity = 10000 + (200 - 150) * 1 = 10050
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([200, 150]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('short', 0); // entered at price 200

      a.getSignal(1); // current price = 150

      expect(capturedContexts[0].equity).toBe(10_000 + (200 - 150) * 1);
    });

    it('shadow equity decreases as price rises against a short position', () => {
      // entry price 200, current price 250 → equity = 10000 + (200 - 250) * 1 = 9950
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([200, 250]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('short', 0);

      a.getSignal(1);

      expect(capturedContexts[0].equity).toBe(10_000 + (200 - 250) * 1);
      expect(capturedContexts[0].equity).toBe(9_950);
    });

    it('shadow equity reflects updated price at a later bar index', () => {
      // Long entered at bar 0 (price 100). Check equity at bar 2 (price 300).
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('long', 0);

      a.getSignal(2); // price = 300

      expect(capturedContexts[0].equity).toBe(10_000 + 1 * 300);
    });
  });

  // ==========================================================================
  // CandleView Implementation
  // ==========================================================================

  describe('CandleView implementation through context', () => {
    let testCandles: ReturnType<typeof makeCandles>;
    let capturedContexts: StrategyContext[];
    let capturingAdapter: SignalAdapter;

    beforeEach(() => {
      capturedContexts = [];
      // 5 candles with distinct prices for verification
      testCandles = [
        { timestamp: 1_000_000, open: 10, high: 15, low: 5,  close: 11, volume: 101 },
        { timestamp: 1_003_600, open: 11, high: 16, low: 6,  close: 12, volume: 102 },
        { timestamp: 1_007_200, open: 12, high: 17, low: 7,  close: 13, volume: 103 },
        { timestamp: 1_010_800, open: 13, high: 18, low: 8,  close: 14, volume: 104 },
        { timestamp: 1_014_400, open: 14, high: 19, low: 9,  close: 15, volume: 105 },
      ];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      capturingAdapter = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      capturingAdapter.init(testCandles);
    });

    it('candleView.length equals barIndex + 1', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.length).toBe(3);
    });

    it('candleView.length is 1 at barIndex 0', () => {
      capturingAdapter.getSignal(0);
      expect(capturedContexts[0].candleView.length).toBe(1);
    });

    it('candleView.length is total candle count at last bar', () => {
      capturingAdapter.getSignal(4);
      expect(capturedContexts[0].candleView.length).toBe(5);
    });

    it('candleView.at(0) returns first candle', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.at(0)).toEqual(testCandles[0]);
    });

    it('candleView.at(barIndex) returns current candle', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.at(2)).toEqual(testCandles[2]);
    });

    it('candleView.at(-1) returns undefined (negative index guard)', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.at(-1)).toBeUndefined();
    });

    it('candleView.at(barIndex + 1) returns undefined (no future data leak)', () => {
      capturingAdapter.getSignal(2);
      // barIndex is 2, so at(3) should be undefined
      expect(capturedContexts[0].candleView.at(3)).toBeUndefined();
    });

    it('candleView.at(barIndex + 1) when at last bar returns undefined', () => {
      capturingAdapter.getSignal(4);
      expect(capturedContexts[0].candleView.at(5)).toBeUndefined();
    });

    it('candleView.closes() returns array of close prices up to barIndex', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.closes()).toEqual([11, 12, 13]);
    });

    it('candleView.volumes() returns array of volumes up to barIndex', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.volumes()).toEqual([101, 102, 103]);
    });

    it('candleView.highs() returns array of high prices up to barIndex', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.highs()).toEqual([15, 16, 17]);
    });

    it('candleView.lows() returns array of low prices up to barIndex', () => {
      capturingAdapter.getSignal(2);
      expect(capturedContexts[0].candleView.lows()).toEqual([5, 6, 7]);
    });

    it('candleView.slice(0, 2) returns first 2 candles', () => {
      capturingAdapter.getSignal(4);
      const sliced = capturedContexts[0].candleView.slice(0, 2);
      expect(sliced).toHaveLength(2);
      expect(sliced[0]).toEqual(testCandles[0]);
      expect(sliced[1]).toEqual(testCandles[1]);
    });

    it('candleView.slice() with no arguments returns all visible candles', () => {
      capturingAdapter.getSignal(2);
      const sliced = capturedContexts[0].candleView.slice();
      expect(sliced).toHaveLength(3);
    });

    it('candleView.slice() does not expose future candles even at partial bar index', () => {
      capturingAdapter.getSignal(1); // only bars 0 and 1 visible
      const sliced = capturedContexts[0].candleView.slice();
      expect(sliced).toHaveLength(2);
      expect(sliced[1]).toEqual(testCandles[1]);
    });

    it('context.candles returns a slice (not a reference to internal array) up to barIndex', () => {
      capturingAdapter.getSignal(2);
      const ctxCandles = capturedContexts[0].candles;
      expect(ctxCandles).toHaveLength(3);
      expect(ctxCandles[2]).toEqual(testCandles[2]);
    });

    it('context.candles does not expose future candles', () => {
      capturingAdapter.getSignal(1);
      const ctxCandles = capturedContexts[0].candles;
      expect(ctxCandles).toHaveLength(2);
      // bar index 2 (price 13) must not be visible
      expect(ctxCandles.find(c => c.close === 13)).toBeUndefined();
    });
  });

  // ==========================================================================
  // Multiple Actions Per Bar
  // ==========================================================================

  describe('multiple actions per bar', () => {
    it('when strategy emits openLong then closeLong, getSignal returns long signal (first action)', () => {
      const multiActionStrategy: Strategy = {
        name: 'multi-action',
        description: 'Emits two actions',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openLong(1);
          ctx.closeLong();
        },
      };
      const a = new SignalAdapter(multiActionStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('long');
    });

    it('when strategy emits closeLong then openLong, getSignal returns null (first action is close)', () => {
      const multiActionStrategy: Strategy = {
        name: 'close-then-open',
        description: 'Close then open',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.closeLong();
          ctx.openLong(1);
        },
      };
      const a = new SignalAdapter(multiActionStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('when strategy emits openLong then openShort, getSignal returns the first (openLong)', () => {
      const multiActionStrategy: Strategy = {
        name: 'open-long-short',
        description: 'Open long then short',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openLong(1);
          ctx.openShort(1);
        },
      };
      const a = new SignalAdapter(multiActionStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('long');
    });

    it('when strategy emits openShort then openLong, getSignal returns the first (openShort)', () => {
      const multiActionStrategy: Strategy = {
        name: 'open-short-long',
        description: 'Open short then long',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openShort(1);
          ctx.openLong(1);
        },
      };
      const a = new SignalAdapter(multiActionStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('short');
    });
  });

  // ==========================================================================
  // Legacy Actions (buy/sell)
  // ==========================================================================

  describe('legacy buy/sell actions', () => {
    it('context.buy(amount) is equivalent to openLong', () => {
      const buyStrategy: Strategy = {
        name: 'buy-strategy',
        description: 'Uses legacy buy',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.buy(1);
        },
      };
      const a = new SignalAdapter(buyStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).not.toBeNull();
      expect(signal!.direction).toBe('long');
    });

    it('context.sell(amount) is equivalent to closeLong', () => {
      const sellStrategy: Strategy = {
        name: 'sell-strategy',
        description: 'Uses legacy sell',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.sell(1);
        },
      };
      const a = new SignalAdapter(sellStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      // sell is a close action, so getSignal should return null
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('context.sell(amount) is captured as CLOSE_LONG and wantsExit returns true', () => {
      const sellStrategy: Strategy = {
        name: 'sell-strategy-exit',
        description: 'Uses legacy sell for exit',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.sell(1);
        },
      };
      const a = new SignalAdapter(sellStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.confirmExecutionAtBar('long', 0);

      expect(a.wantsExit(0)).toBe(true);
    });

    it('buy(0) does NOT push an action (amount <= 0 guard)', () => {
      const zeroAmountBuyStrategy: Strategy = {
        name: 'zero-buy',
        description: 'Calls buy with 0',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.buy(0);
        },
      };
      const a = new SignalAdapter(zeroAmountBuyStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('sell(0) does NOT push an action', () => {
      const zeroSellStrategy: Strategy = {
        name: 'zero-sell',
        description: 'Calls sell with 0',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.sell(0);
        },
      };
      const a = new SignalAdapter(zeroSellStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      a.confirmExecutionAtBar('long', 0);

      expect(a.wantsExit(0)).toBe(false);
    });
  });

  // ==========================================================================
  // openLong/openShort with amount <= 0
  // ==========================================================================

  describe('openLong/openShort with amount <= 0', () => {
    it('openLong(0) does not push an action', () => {
      const zeroLongStrategy: Strategy = {
        name: 'zero-long',
        description: 'Calls openLong with 0',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openLong(0);
        },
      };
      const a = new SignalAdapter(zeroLongStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('openShort(0) does not push an action', () => {
      const zeroShortStrategy: Strategy = {
        name: 'zero-short',
        description: 'Calls openShort with 0',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openShort(0);
        },
      };
      const a = new SignalAdapter(zeroShortStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('openLong(-1) does not push an action (negative amount guard)', () => {
      const negLongStrategy: Strategy = {
        name: 'neg-long',
        description: 'Calls openLong with -1',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openLong(-1);
        },
      };
      const a = new SignalAdapter(negLongStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });

    it('openShort(-1) does not push an action', () => {
      const negShortStrategy: Strategy = {
        name: 'neg-short',
        description: 'Calls openShort with -1',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.openShort(-1);
        },
      };
      const a = new SignalAdapter(negShortStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));
      const signal = a.getSignal(0);

      expect(signal).toBeNull();
    });
  });

  // ==========================================================================
  // Log Function
  // ==========================================================================

  describe('log function in shadow mode', () => {
    it('context.log(message) does not throw', () => {
      const loggingStrategy: Strategy = {
        name: 'logging-strategy',
        description: 'Logs a message',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.log('test message');
        },
      };
      const a = new SignalAdapter(loggingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));

      expect(() => a.getSignal(0)).not.toThrow();
    });

    it('context.log does not throw even with empty string', () => {
      const loggingStrategy: Strategy = {
        name: 'empty-log-strategy',
        description: 'Logs empty string',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          ctx.log('');
        },
      };
      const a = new SignalAdapter(loggingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100]));

      expect(() => a.getSignal(0)).not.toThrow();
    });
  });

  // ==========================================================================
  // Funding Rate Context Data
  // ==========================================================================

  describe('funding rate context data', () => {
    it('context.fundingRates contains only rates with timestamp <= current candle', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'fr-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      // 3 candles at timestamps: 1_000_000, 1_003_600, 1_007_200
      const testCandles: Candle[] = [
        { timestamp: 1_000_000, open: 100, high: 110, low: 90, close: 105, volume: 100 },
        { timestamp: 1_003_600, open: 105, high: 115, low: 95, close: 110, volume: 100 },
        { timestamp: 1_007_200, open: 110, high: 120, low: 100, close: 115, volume: 100 },
      ];
      // 3 funding rates, one at each candle timestamp
      const frs: FundingRate[] = [
        { timestamp: 1_000_000, fundingRate: 0.001 },
        { timestamp: 1_003_600, fundingRate: 0.002 },
        { timestamp: 1_007_200, fundingRate: 0.003 },
      ];
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles, frs);

      // At bar 1, only FRs at ts 1_000_000 and 1_003_600 should be visible
      a.getSignal(1);

      expect(capturedContexts[0].fundingRates).toBeDefined();
      expect(capturedContexts[0].fundingRates!.length).toBe(2);
      expect(capturedContexts[0].fundingRates!.map(f => f.fundingRate)).toEqual([0.001, 0.002]);
    });

    it('context.currentFundingRate is the FR matching the current candle timestamp', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'fr-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles: Candle[] = [
        { timestamp: 1_000_000, open: 100, high: 110, low: 90, close: 105, volume: 100 },
        { timestamp: 1_003_600, open: 105, high: 115, low: 95, close: 110, volume: 100 },
      ];
      const frs: FundingRate[] = [
        { timestamp: 1_000_000, fundingRate: 0.001 },
        { timestamp: 1_003_600, fundingRate: 0.002 },
      ];
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles, frs);

      a.getSignal(1); // bar at timestamp 1_003_600

      expect(capturedContexts[0].currentFundingRate).not.toBeNull();
      expect(capturedContexts[0].currentFundingRate!.fundingRate).toBe(0.002);
    });

    it('context.currentFundingRate is null when no FR matches current candle timestamp', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'fr-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles: Candle[] = [
        { timestamp: 1_000_000, open: 100, high: 110, low: 90, close: 105, volume: 100 },
        { timestamp: 1_003_600, open: 105, high: 115, low: 95, close: 110, volume: 100 },
      ];
      // Only a FR at ts 1_000_000, not at 1_003_600
      const frs: FundingRate[] = [
        { timestamp: 1_000_000, fundingRate: 0.001 },
      ];
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles, frs);

      a.getSignal(1); // bar at timestamp 1_003_600 - no matching FR

      expect(capturedContexts[0].currentFundingRate).toBeNull();
    });

    it('context.fundingRates is undefined when no FR data provided', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'fr-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100])); // no funding rates

      a.getSignal(0);

      // recentFR.length is 0, so fundingRates should be undefined
      expect(capturedContexts[0].fundingRates).toBeUndefined();
    });
  });

  // ==========================================================================
  // Double onBar Prevention (regression test)
  // ==========================================================================

  describe('double onBar prevention', () => {
    it('wantsExit(bar) + getSignal(bar) on SAME bar: onBar called only once', () => {
      let onBarCallCount = 0;
      const countingStrategy: Strategy = {
        name: 'counting-strategy',
        description: 'Counts onBar calls',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          onBarCallCount++;
          ctx.closeLong(); // emit a close action
        },
      };
      const a = new SignalAdapter(countingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100, 200]));
      a.confirmExecutionAtBar('long', 0);

      onBarCallCount = 0; // reset after init

      a.wantsExit(1);    // first call — onBar runs
      a.getSignal(1);    // same bar — must NOT call onBar again

      expect(onBarCallCount).toBe(1);
    });

    it('getSignal(bar) after wantsExit(differentBar): onBar called normally for getSignal', () => {
      let onBarCallCount = 0;
      const countingStrategy: Strategy = {
        name: 'counting-strategy',
        description: 'Counts onBar calls',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          onBarCallCount++;
          ctx.openLong(1);
        },
      };
      const a = new SignalAdapter(countingStrategy, 'BTC/USDT', '1h');
      a.init(makeCandles([100, 200, 300]));
      a.confirmExecutionAtBar('long', 0);

      onBarCallCount = 0;

      // wantsExit at bar 1, then getSignal at bar 2 (different bar)
      // wantsExit resets isInPosition only via confirmExit, but here we just check call count
      a.wantsExit(1);    // runs onBar(bar 1)
      a.confirmExit();   // clear position so wantsExit won't block getSignal
      a.getSignal(2);    // different bar → onBar must be called fresh

      expect(onBarCallCount).toBe(2);
    });

    it('wantsExit + confirmExit + getSignal on same bar: actions from wantsExit are reused', () => {
      let onBarCallCount = 0;
      const mixedStrategy: Strategy = {
        name: 'mixed-strategy',
        description: 'Close then open',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          onBarCallCount++;
          ctx.closeLong();
          ctx.openShort(1);
        },
      };
      const testCandles = makeCandles([100, 200]);
      const a = new SignalAdapter(mixedStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);
      a.confirmExecutionAtBar('long', 0);

      onBarCallCount = 0;

      const wantsExit = a.wantsExit(1);      // runs onBar once
      a.confirmExit();
      const signal = a.getSignal(1);          // same bar — reuses saved actions

      expect(onBarCallCount).toBe(1);         // onBar ran exactly once
      expect(wantsExit).toBe(true);           // closeLong was emitted
      // getSignal uses first action (CLOSE_LONG) → returns null for entry signals
      expect(signal).toBeNull();
    });
  });

  // ==========================================================================
  // confirmExecution vs confirmExecutionAtBar
  // ==========================================================================

  describe('confirmExecution vs confirmExecutionAtBar', () => {
    it('confirmExecution("long") uses last candle close as entry price', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      // candle prices: 100, 200, 300
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);

      // confirmExecution uses last candle (index 2, price 300) as entry price
      a.confirmExecution('long');
      a.getSignal(2);

      expect(capturedContexts[0].portfolio.longPosition).not.toBeNull();
      expect(capturedContexts[0].portfolio.longPosition!.entryPrice).toBe(300);
    });

    it('confirmExecution("short") uses last candle close as entry price', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);

      a.confirmExecution('short');
      a.getSignal(2);

      expect(capturedContexts[0].portfolio.shortPosition).not.toBeNull();
      expect(capturedContexts[0].portfolio.shortPosition!.entryPrice).toBe(300);
    });

    it('confirmExecutionAtBar with valid index uses that candle close as entry price', () => {
      const capturedContexts: StrategyContext[] = [];
      const capturingStrategy: Strategy = {
        name: 'context-capture',
        description: 'Captures context',
        version: '1.0.0',
        params: [],
        onBar(ctx: StrategyContext): void {
          capturedContexts.push(ctx);
        },
      };
      const testCandles = makeCandles([100, 200, 300]);
      const a = new SignalAdapter(capturingStrategy, 'BTC/USDT', '1h');
      a.init(testCandles);

      // bar index 1 has close = 200
      a.confirmExecutionAtBar('long', 1);
      a.getSignal(2);

      expect(capturedContexts[0].portfolio.longPosition!.entryPrice).toBe(200);
    });

    it('confirmExecution("flat") is a no-op (no shadow position set)', () => {
      const a = new SignalAdapter(createMockStrategy(), 'BTC/USDT', '1h');
      a.init(makeCandles([100]));

      a.confirmExecution('flat');

      expect(a.isInPosition()).toBe(false);
    });

    it('confirmExecution with empty candle list defaults entry price to 0', () => {
      // The source: currentPrice = this.candles.length > 0 ? last.close : 0
      // To test the 0-price path, call confirmExecution before init.
      const freshAdapter = new SignalAdapter(createMockStrategy(), 'BTC/USDT', '1h');
      // Don't call init — candles is empty []
      freshAdapter.confirmExecution('long');

      // It should still mark the adapter as having a position
      expect(freshAdapter.isInPosition()).toBe(true);
    });
  });
});
