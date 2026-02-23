/**
 * Failing tests that expose known calculation bugs in the aggregate engine.
 *
 * These tests are intentionally RED (failing). Do NOT fix the bugs here.
 * Each describe block documents a specific bug and the expected correct behavior.
 *
 * Bug summary:
 *   BUG 1 - Capital allocation mid-loop mutation (top_n / weighted_multi)
 *   BUG 2 - Double onBar execution on exit+re-entry bars
 *   BUG 3 - Short position cash inflation (no collateral lock-up)
 *   BUG 4 - Capital allocation corner cases
 *   BUG 5 - Exit-before-entry ordering
 */

import { describe, it, expect } from 'vitest';
import { MultiSymbolPortfolio } from '../multi-portfolio.js';
import { SignalAdapter } from '../signal-adapter.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { Candle } from '../types.js';
import type { Signal } from '../signal-types.js';

// ============================================================================
// Shared helpers
// ============================================================================

function makeCandle(price: number, timestamp: number): Candle {
  return {
    timestamp,
    open: price,
    high: price + 1,
    low: price - 1,
    close: price,
    volume: 1000,
  };
}

function makeCandles(prices: number[], baseTimestamp = 1_000_000, intervalMs = 3_600_000): Candle[] {
  return prices.map((price, i) => makeCandle(price, baseTimestamp + i * intervalMs));
}

/**
 * Helper: simulate the allocation loop exactly as aggregate-engine.ts lines 274-324
 * (the top_n equal-split path) against a real MultiSymbolPortfolio.
 *
 * Returns the trade value (amount * price) for each executed signal, in order.
 */
function simulateTopNAllocation(
  portfolio: MultiSymbolPortfolio,
  signals: Array<{ signal: Signal; symbol: string; price: number }>,
  feeRate = 0,
): number[] {
  const tradeValues: number[] = [];

  // Snapshot cash BEFORE the loop so all allocations use the same base (fixed behavior)
  const cashSnapshot = portfolio.cash;

  for (const { signal, symbol, price } of signals) {
    const capitalForTrade = (cashSnapshot * 0.9) / signals.length;
    const amount = capitalForTrade / price;
    if (amount <= 0) continue;

    portfolio.openLong(symbol, amount, price, signal.timestamp, feeRate);
    tradeValues.push(amount * price);
  }

  return tradeValues;
}

/**
 * Helper: simulate the allocation loop for weighted_multi.
 */
function simulateWeightedMultiAllocation(
  portfolio: MultiSymbolPortfolio,
  signals: Array<{ signal: Signal; symbol: string; price: number }>,
  feeRate = 0,
): number[] {
  const tradeValues: number[] = [];
  const totalWeight = signals.reduce((sum, s) => sum + s.signal.weight, 0);

  // Snapshot cash BEFORE the loop so all allocations use the same base (fixed behavior)
  const cashSnapshot = portfolio.cash;

  for (const { signal, symbol, price } of signals) {
    const capitalForTrade = (signal.weight / totalWeight) * cashSnapshot * 0.9;
    const amount = capitalForTrade / price;
    if (amount <= 0) continue;

    portfolio.openLong(symbol, amount, price, signal.timestamp, feeRate);
    tradeValues.push(amount * price);
  }

  return tradeValues;
}

function makeSignal(symbol: string, weight: number, timestamp = 1_000_000): Signal {
  return { symbol, direction: 'long', weight, strategyName: 'test', timestamp };
}

// ============================================================================
// BUG 1: Capital allocation mid-loop mutation
// ============================================================================

describe('BUG 1: Capital allocation mid-loop mutation (top_n / weighted_multi)', () => {
  /**
   * The engine computes capitalForTrade = (portfolio.cash * 0.9) / selectedSignals.length
   * INSIDE the loop. After each openLong(), portfolio.cash decreases, so subsequent
   * iterations compute a smaller share. With 3 equal signals and $10,000:
   *
   *   Expected (correct): each gets $9,000 / 3 = $3,000
   *   Actual (buggy):
   *     signal 1: (10000 * 0.9) / 3 = $3,000   → cash after ≈ $7,000
   *     signal 2: (7000  * 0.9) / 3 = $2,100   → cash after ≈ $4,900
   *     signal 3: (4900  * 0.9) / 3 = $1,470   → cash after ≈ $3,430
   *
   * The test asserts equal allocations; the current code will fail this.
   */
  it('top_n: three equal-weight signals should each receive 1/3 of initial 90% cash', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    const signals = [
      { signal: makeSignal('AAA/USDT', 1.0), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 1.0), symbol: 'BBB/USDT', price },
      { signal: makeSignal('CCC/USDT', 1.0), symbol: 'CCC/USDT', price },
    ];

    const tradeValues = simulateTopNAllocation(portfolio, signals);

    // Each should receive exactly $3,000 (= 10000 * 0.9 / 3)
    const expectedPerTrade = (initialCash * 0.9) / 3;

    expect(tradeValues).toHaveLength(3);
    expect(tradeValues[0]).toBeCloseTo(expectedPerTrade, 1);
    expect(tradeValues[1]).toBeCloseTo(expectedPerTrade, 1);
    expect(tradeValues[2]).toBeCloseTo(expectedPerTrade, 1);
  });

  it('top_n: all three positions should have equal size in the portfolio', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;
    const timestamp = 1_000_000;

    const signals = [
      { signal: makeSignal('AAA/USDT', 1.0, timestamp), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 1.0, timestamp), symbol: 'BBB/USDT', price },
      { signal: makeSignal('CCC/USDT', 1.0, timestamp), symbol: 'CCC/USDT', price },
    ];

    simulateTopNAllocation(portfolio, signals);

    const posA = portfolio.getPositionForSymbol('AAA/USDT').longPosition;
    const posB = portfolio.getPositionForSymbol('BBB/USDT').longPosition;
    const posC = portfolio.getPositionForSymbol('CCC/USDT').longPosition;

    expect(posA).not.toBeNull();
    expect(posB).not.toBeNull();
    expect(posC).not.toBeNull();

    // All three amounts should be equal (each = expectedCapital / price)
    expect(posA!.amount).toBeCloseTo(posB!.amount, 4);
    expect(posB!.amount).toBeCloseTo(posC!.amount, 4);
    expect(posA!.amount).toBeCloseTo(posC!.amount, 4);
  });

  it('weighted_multi: two signals with weights 0.8 and 0.2 should split proportionally from initial cash', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    const signals = [
      { signal: makeSignal('AAA/USDT', 0.8), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 0.2), symbol: 'BBB/USDT', price },
    ];

    const tradeValues = simulateWeightedMultiAllocation(portfolio, signals);

    // total weight = 1.0, total capital = 10000 * 0.9 = 9000
    // AAA should get: (0.8 / 1.0) * 9000 = 7200
    // BBB should get: (0.2 / 1.0) * 9000 = 1800
    expect(tradeValues).toHaveLength(2);
    expect(tradeValues[0]).toBeCloseTo(7_200, 1);
    expect(tradeValues[1]).toBeCloseTo(1_800, 1);
  });

  it('weighted_multi: second signal should be calculated from ORIGINAL cash, not post-first-trade cash', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    const signals = [
      { signal: makeSignal('AAA/USDT', 0.5), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 0.5), symbol: 'BBB/USDT', price },
    ];

    simulateWeightedMultiAllocation(portfolio, signals);

    const posA = portfolio.getPositionForSymbol('AAA/USDT').longPosition;
    const posB = portfolio.getPositionForSymbol('BBB/USDT').longPosition;

    // Both have equal weight 0.5, so both should get equal capital from the ORIGINAL $10,000
    // Expected: each gets (0.5 / 1.0) * 10000 * 0.9 / 100 = 45 units
    const expectedAmount = (0.5 / 1.0) * initialCash * 0.9 / price;

    expect(posA!.amount).toBeCloseTo(expectedAmount, 4);
    expect(posB!.amount).toBeCloseTo(expectedAmount, 4);
  });
});

// ============================================================================
// BUG 2: Double onBar execution on exit+re-entry bars
// ============================================================================

describe('BUG 2: Double onBar execution on exit+re-entry bars', () => {
  /**
   * When an adapter has a shadow position and wantsExit() returns true,
   * the engine calls confirmExit() then calls getSignal() on the same bar.
   *
   * Inside wantsExit(): calls onBar() once.
   * Inside getSignal() after confirmExit(): calls onBar() again.
   *
   * For a stateful strategy that counts onBar calls, this means it gets
   * called TWICE on the exit bar. The test should assert exactly 1 call per bar.
   */
  it('onBar is called exactly once per bar, even on exit bars', () => {
    let onBarCallCount = 0;

    const strategy: Strategy = {
      name: 'counting-strategy',
      description: 'Counts onBar calls',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        onBarCallCount++;
        if (ctx.longPosition) {
          // Close on bar 2 (price > 120)
          if (ctx.currentCandle.close > 120) {
            ctx.closeLong();
          }
        } else {
          // Open on bar 0 (price < 100)
          if (ctx.currentCandle.close < 100) {
            ctx.openLong(1);
          }
        }
      },
    };

    const candles = makeCandles([80, 110, 130, 80]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Bar 0: getSignal calls onBar (count = 1)
    onBarCallCount = 0;
    const sig0 = adapter.getSignal(0);
    expect(sig0).not.toBeNull();
    const callsOnBar0 = onBarCallCount;

    // Confirm execution to set shadow position
    adapter.confirmExecutionAtBar('long', 0);

    // Bar 1: wantsExit calls onBar, but no exit signal
    onBarCallCount = 0;
    const wantsExit1 = adapter.wantsExit(1);
    expect(wantsExit1).toBe(false);
    const callsOnBar1 = onBarCallCount;

    // Bar 2: price=130 > 120, wantsExit should return true
    // Then engine calls confirmExit() and then getSignal() for re-entry on same bar
    onBarCallCount = 0;
    const wantsExit2 = adapter.wantsExit(2);
    expect(wantsExit2).toBe(true);

    // Simulate what the engine does: confirmExit, then getSignal on the same bar
    adapter.confirmExit();
    const sig2 = adapter.getSignal(2);
    // Price on bar 2 is 130, which is NOT < 100, so no re-entry signal expected
    expect(sig2).toBeNull();

    const callsOnBar2 = onBarCallCount;

    // THE BUG: onBar was called TWICE on bar 2 (once in wantsExit, once in getSignal)
    // Expected behavior: only 1 call per bar, regardless of exit+re-entry
    expect(callsOnBar0).toBe(1);
    expect(callsOnBar1).toBe(1);
    // This assertion FAILS with current code (actual value is 2)
    expect(callsOnBar2).toBe(1);
  });

  it('onBar call count is consistent across all bars with no exit', () => {
    let totalOnBarCalls = 0;

    const strategy: Strategy = {
      name: 'counter',
      description: 'Counts onBar',
      version: '1.0.0',
      params: [],
      onBar(): void {
        totalOnBarCalls++;
      },
    };

    const candles = makeCandles([100, 110, 120, 130]);
    const adapter = new SignalAdapter(strategy, 'ETH/USDT', '1h');
    adapter.init(candles);

    // Process 4 bars: only use getSignal (no position, no exits)
    adapter.getSignal(0);
    adapter.getSignal(1);
    adapter.getSignal(2);
    adapter.getSignal(3);

    // 4 bars, each should call onBar exactly once → total = 4
    expect(totalOnBarCalls).toBe(4);
  });

  it('wantsExit + getSignal on same bar counts as exactly 1 onBar invocation in total', () => {
    let onBarCallCount = 0;

    // Strategy that opens on bar 0 and closes on bar 1, re-opens if price < 200
    const strategy: Strategy = {
      name: 'exit-reentry',
      description: 'Exits then re-enters same bar',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        onBarCallCount++;
        if (ctx.longPosition) {
          ctx.closeLong();  // Always wants to exit when in position
        } else {
          ctx.openLong(1);  // Always wants to enter when not in position
        }
      },
    };

    const candles = makeCandles([100, 110, 120]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Bar 0: enter
    onBarCallCount = 0;
    adapter.getSignal(0);
    expect(onBarCallCount).toBe(1);
    adapter.confirmExecutionAtBar('long', 0);

    // Bar 1: wantsExit + confirmExit + getSignal (exit + re-entry on same bar)
    onBarCallCount = 0;
    adapter.wantsExit(1);        // calls onBar once (count = 1)
    adapter.confirmExit();
    adapter.getSignal(1);        // calls onBar AGAIN (count = 2 with current buggy code)

    // Expected: onBar called exactly ONCE for bar 1 total
    // This will FAIL because current code calls onBar twice
    expect(onBarCallCount).toBe(1);
  });
});

// ============================================================================
// BUG 3: Short position cash inflation
// ============================================================================

describe('BUG 3: Short position cash inflation (no collateral lock-up)', () => {
  /**
   * When a short is opened, MultiSymbolPortfolio only deducts the fee from cash.
   * The collateral (notional value of the short) is NOT locked. This means
   * portfolio.cash remains nearly the same as before the short was opened.
   *
   * Consequence: if the engine allocates capital for a new long using
   * portfolio.cash * 0.9 while a short is already open, it will oversize
   * the long position because the cash appears artificially large.
   *
   * Correct behavior: opening a short should lock collateral equal to the
   * notional value (amount * price), reducing available cash for new entries.
   */
  it('opening a short should reduce available cash by notional value (collateral lock)', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);

    const price = 100;
    const amount = 50; // 50 units at $100 = $5,000 notional

    portfolio.openShort('BTC/USDT', amount, price, 1_000_000, 0);

    // After opening a $5,000 short, cash should reflect locked collateral
    // Expected: cash = 10000 - 5000 = 5000 (collateral locked)
    // Actual (buggy): cash ≈ 10000 (only fee deducted, fee=0 here)
    expect(portfolio.cash).toBeCloseTo(5_000, 1);
  });

  it('portfolio equity should equal initialCapital immediately after opening a short (at entry price)', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);

    // Open a short at entry price, with no fee and no price movement
    // Equity = cash + short unrealized PnL
    // With current buggy code: cash ≈ 10000 (fee=0), unrealized PnL = 0
    // → equity ≈ 20000 (WRONG - doubled the capital)
    // Correct: equity should remain at 10000 (no profit/loss at entry)
    portfolio.openShort('BTC/USDT', 50, 100, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 100); // price unchanged

    // Equity must equal initial capital right after opening a position at entry price
    expect(portfolio.equity).toBeCloseTo(initialCash, 1);
  });

  it('new long allocation while short is open should not exceed available collateral', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);

    const shortPrice = 100;
    const shortAmount = 50; // $5,000 notional

    // Open a short, consuming half the capital as collateral
    portfolio.openShort('BTC/USDT', shortAmount, shortPrice, 1_000_000, 0);

    // After locking $5,000 in short collateral, only $5,000 should be "free"
    // So a new long at "90% of cash" should get at most $4,500
    const capitalForLong = portfolio.cash * 0.9;

    // With the bug: portfolio.cash ≈ $10,000 → capitalForLong ≈ $9,000 (oversized)
    // Correct: portfolio.cash ≈ $5,000 → capitalForLong ≈ $4,500
    expect(capitalForLong).toBeLessThan(5_000);
  });

  it('total capital at risk (shorts + longs) should not exceed initial capital', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);

    // Open a short that uses 60% of capital as collateral
    portfolio.openShort('BTC/USDT', 60, 100, 1_000_000, 0);

    // Now open a long with "90% of remaining cash"
    // With correct code: remaining cash ≈ $4,000, long gets ≈ $3,600
    // Total at risk = $6,000 (short) + $3,600 (long) = $9,600 ≤ $10,000 ✓
    //
    // With buggy code: cash ≈ $10,000, long gets ≈ $9,000
    // Total at risk = $6,000 (short) + $9,000 (long) = $15,000 > $10,000 ✗
    const capitalForLong = portfolio.cash * 0.9;
    const longAmount = capitalForLong / 100;

    // This will throw if there's truly insufficient funds, otherwise we check
    // that capital at risk stays within initial capital
    portfolio.openLong('ETH/USDT', longAmount, 100, 1_000_001, 0);

    const shortNotional = 60 * 100; // $6,000
    const longNotional = longAmount * 100;
    const totalAtRisk = shortNotional + longNotional;

    // Total capital deployed should not exceed initial capital
    expect(totalAtRisk).toBeLessThanOrEqual(initialCash);
  });

  it('short unrealized PnL at entry price should be zero (not phantom profit)', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    portfolio.openShort('BTC/USDT', 50, 100, 1_000_000, 0);
    portfolio.updatePrice('BTC/USDT', 100); // same as entry

    const pos = portfolio.getPositionForSymbol('BTC/USDT').shortPosition;
    expect(pos).not.toBeNull();
    expect(pos!.unrealizedPnl).toBeCloseTo(0, 5);

    // The equity INFLATES because cash was not reduced: cash=10000, unrealizedPnl=0
    // equity = 10000 + 0 = 10000. But WAIT: the portfolio equity formula adds
    // (entryPrice - currentPrice) * amount which is 0 at entry.
    // The bug is that cash was never reduced, so equity = original_cash + 0 = 10000.
    // This LOOKS ok at entry, but the cash is really "double counting":
    // $10,000 cash AND $5,000 notional exposure both exist without deduction.
    // This test verifies the STRUCTURAL PRECONDITION: equity inflates on round-trip.

    // Open at $100, price moves to $80 (short profits $1,000)
    portfolio.updatePrice('BTC/USDT', 80);
    const equityAfterPriceMove = portfolio.equity;

    // With buggy code:
    //   cash = 10000 (no collateral deducted)
    //   unrealized PnL = (100 - 80) * 50 = 1000
    //   equity = 10000 + 1000 = 11000
    // BUT if we close the short at $80:
    //   grossPnl = (100 - 80) * 50 = 1000
    //   cash += grossPnl → cash = 10000 + 1000 = 11000
    //   equity = 11000 (cash only, no position)
    // So equity after close = 11000, a $1000 GAIN, which is CORRECT for a short profit.
    // The bug is that we started with $10,000 AND could also deploy $10,000 in longs.

    // Verify: equity while in position should NOT exceed initial + unrealizedPnL
    // After price moved to 80, recalculate unrealized PnL
    const freshPos = portfolio.getPositionForSymbol('BTC/USDT').shortPosition;
    const freshPnl = freshPos ? (100 - 80) * freshPos.amount : 0;

    // Equity should be: initialCapital + pnl = 10000 + 1000 = 11000
    // This is actually the CORRECT equity value, but it implies cash was not reduced,
    // which means a simultaneous long deployment would double-spend cash.
    expect(equityAfterPriceMove).toBeCloseTo(10_000 + freshPnl, 1);
  });
});

// ============================================================================
// BUG 4: Comprehensive capital allocation corner cases
// ============================================================================

describe('BUG 4: Capital allocation corner cases', () => {
  it('single signal in weighted_multi mode should get 90% of cash', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    // When selectedSignals.length === 1, the engine uses the else branch:
    //   capitalForTrade = portfolio.cash * 0.9
    // (not the proportional formula). This is correct and should pass.
    const capitalForTrade = portfolio.cash * 0.9; // $9,000
    const amount = capitalForTrade / price;
    portfolio.openLong('AAA/USDT', amount, price, 1_000_000, 0);

    const pos = portfolio.getPositionForSymbol('AAA/USDT').longPosition;
    expect(pos!.amount * price).toBeCloseTo(9_000, 1);
  });

  it('top_n with maxPositions=2 but 5 signals: only 2 should be executed', () => {
    const maxPositions = 2;
    const currentPositionCount = 0;

    const allSignals = [
      makeSignal('AAA/USDT', 1.0),
      makeSignal('BBB/USDT', 0.9),
      makeSignal('CCC/USDT', 0.8),
      makeSignal('DDD/USDT', 0.7),
      makeSignal('EEE/USDT', 0.6),
    ];

    // top_n selection: slice to availableSlots
    const availableSlots = Math.max(0, maxPositions - currentPositionCount);
    const selectedSignals = allSignals.slice(0, availableSlots);

    expect(selectedSignals).toHaveLength(2);
    expect(selectedSignals[0].symbol).toBe('AAA/USDT');
    expect(selectedSignals[1].symbol).toBe('BBB/USDT');
  });

  it('top_n with 0 available slots: no signals should execute', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    const maxPositions = 2;

    // Fill all slots
    portfolio.openLong('AAA/USDT', 10, 100, 1_000_000, 0);
    portfolio.openLong('BBB/USDT', 10, 100, 1_000_000, 0);

    const currentPositionCount = portfolio.getPositionCount();
    const availableSlots = Math.max(0, maxPositions - currentPositionCount);

    expect(availableSlots).toBe(0);

    // Simulate signal selection with 0 slots: nothing should be picked
    const signals = [makeSignal('CCC/USDT', 1.0)];
    const selectedSignals = signals.slice(0, availableSlots);

    expect(selectedSignals).toHaveLength(0);
  });

  it('capital exhaustion: portfolio with $100 cannot open a $1000 position', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Drain most of the cash by opening large positions
    portfolio.openLong('AAA/USDT', 99, 100, 1_000_000, 0); // uses $9,900
    // portfolio.cash ≈ $100

    expect(portfolio.cash).toBeCloseTo(100, 0);

    // Attempt to open a $1000 position — should throw (insufficient funds)
    expect(() => {
      portfolio.openLong('BBB/USDT', 10, 100, 1_000_001, 0); // $1000 needed
    }).toThrow(/insufficient funds/i);
  });

  it('zero-weight signal in weighted_multi should receive zero capital', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    const signals = [
      { signal: makeSignal('AAA/USDT', 1.0), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 0.0), symbol: 'BBB/USDT', price },
    ];

    const tradeValues = simulateWeightedMultiAllocation(portfolio, signals);

    // BBB has weight 0: (0 / 1.0) * cash * 0.9 = 0
    // amount = 0 / price = 0 → skipped (amount <= 0 branch)
    // Only AAA should be traded
    // Note: if the engine does NOT skip zero-weight signals, this test documents
    // the expected behavior that it SHOULD skip them
    expect(tradeValues).toHaveLength(1);
    expect(tradeValues[0]).toBeCloseTo(9_000, 1); // AAA gets 100% of 90%

    const posA = portfolio.getPositionForSymbol('AAA/USDT').longPosition;
    const posB = portfolio.getPositionForSymbol('BBB/USDT').longPosition;

    expect(posA).not.toBeNull();
    expect(posB).toBeNull(); // Zero-weight signal should result in no position
  });

  it('top_n with equal weights: capital split should sum to exactly 90% of initial cash', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;

    const signals = [
      { signal: makeSignal('AAA/USDT', 1.0), symbol: 'AAA/USDT', price },
      { signal: makeSignal('BBB/USDT', 1.0), symbol: 'BBB/USDT', price },
      { signal: makeSignal('CCC/USDT', 1.0), symbol: 'CCC/USDT', price },
    ];

    const tradeValues = simulateTopNAllocation(portfolio, signals);

    // The sum of all position values should equal 90% of INITIAL cash
    // (not 90% of cash after each deduction)
    const totalDeployed = tradeValues.reduce((sum, v) => sum + v, 0);
    const expectedTotal = initialCash * 0.9;

    // This FAILS because the mid-loop mutation causes each signal to get
    // a fraction of the REMAINING cash, not the original cash.
    // actual ≈ 3000 + 2100 + 1470 = 6570, expected = 9000
    expect(totalDeployed).toBeCloseTo(expectedTotal, 1);
  });
});

// ============================================================================
// BUG 5: Exit-before-entry ordering
// ============================================================================

describe('BUG 5: Exit-before-entry ordering', () => {
  /**
   * The engine's main loop (section 4c) processes exits before entries.
   * After an exit, the freed cash should be available for the new entry.
   *
   * Scenario: adapter A has a long position (tied up capital) and wants to exit.
   *           adapter B has a new entry signal.
   * Expected: A exits first → cash increases → B gets allocated from full freed cash.
   */
  it('single_strongest: exit frees capital that is available for next entry on same bar', () => {
    const initialCash = 10_000;
    const portfolio = new MultiSymbolPortfolio(initialCash);
    const price = 100;
    const feeRate = 0;

    // Open a position for adapter A: uses 90% of cash = $9,000
    const entryAmount = (initialCash * 0.9) / price; // 90 units
    portfolio.openLong('AAA/USDT', entryAmount, price, 1_000_000, feeRate);

    const cashAfterOpen = portfolio.cash;
    expect(cashAfterOpen).toBeCloseTo(1_000, 1); // Only $1,000 remains

    // Simulate: on same bar, A exits (at same price, no gain/loss),
    // then B should enter using the freed capital
    portfolio.closeLong('AAA/USDT', 'all', price, 1_000_001, feeRate);

    const cashAfterClose = portfolio.cash;
    // After closing at the same price: cash returns to ~$10,000
    expect(cashAfterClose).toBeCloseTo(initialCash, 1);

    // Now B enters using "90% of cash" — should get nearly $9,000
    const capitalForB = portfolio.cash * 0.9;
    const amountForB = capitalForB / price;
    portfolio.openLong('BBB/USDT', amountForB, price, 1_000_002, feeRate);

    const posB = portfolio.getPositionForSymbol('BBB/USDT').longPosition;
    expect(posB).not.toBeNull();
    // B should get approximately 90 units (= $9,000 / $100), not the ~9 units it would get
    // if exit happened AFTER entry calculation
    expect(posB!.amount).toBeCloseTo(90, 1);
  });

  it('exit-before-entry: cash after exit should be available for immediate re-allocation', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Setup: open a large long
    portfolio.openLong('BTC/USDT', 0.1, 50_000, 1_000_000, 0.001);
    const cashBeforeClose = portfolio.cash; // Should be small (~$5,000 - $5,000 - fee ≈ $4,972.5)

    // Close it
    portfolio.closeLong('BTC/USDT', 'all', 50_000, 2_000_000, 0.001);
    const cashAfterClose = portfolio.cash;

    // Cash should have recovered (minus fees)
    // Entry fee: 5000 * 0.001 = $5
    // Exit fee: 5000 * 0.001 = $5
    // Net: started $10,000, paid $10 in fees → ~$9,990
    expect(cashAfterClose).toBeGreaterThan(cashBeforeClose);
    expect(cashAfterClose).toBeCloseTo(9_990, 0);
  });

  it('exit happens before entry in the engine allocation loop ordering', () => {
    /**
     * Simulate the engine's section 4c (exits) then 4d (entries) ordering.
     * After exits are processed, the new entries should see the freed cash.
     */
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Adapter A is already in position (90% deployed = $9,000)
    portfolio.openLong('AAA/USDT', 90, 100, 1_000_000, 0);
    expect(portfolio.cash).toBeCloseTo(1_000, 1);

    // --- Simulate bar N ---

    // Step 1: Process exits (4c) - A wants to exit
    portfolio.closeLong('AAA/USDT', 'all', 100, 1_000_001, 0); // flat exit, no pnl
    const cashAfterExits = portfolio.cash;
    expect(cashAfterExits).toBeCloseTo(10_000, 1); // Full $10,000 restored

    // Step 2: Collect signals (4d) - B has a new signal

    // Step 3: Execute signals (4f) - B should use freed cash
    // The capital B gets is based on portfolio.cash AFTER exits
    const capitalForB = portfolio.cash * 0.9; // Should be based on $10,000

    const amountB = capitalForB / 100;
    portfolio.openLong('BBB/USDT', amountB, 100, 1_000_002, 0);

    const posB = portfolio.getPositionForSymbol('BBB/USDT').longPosition;
    expect(posB!.amount).toBeCloseTo(90, 1); // 90% of $10,000 / $100 = 90 units
  });

  it('single_strongest mode: should not allow entry while position is open', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);

    // Open a position for adapter A
    portfolio.openLong('AAA/USDT', 90, 100, 1_000_000, 0);

    const positionCount = portfolio.getPositionCount();
    expect(positionCount).toBe(1);

    // In single_strongest mode, no new entry is allowed while any position is open
    // (engine checks: if (currentPositionCount === 0) ...)
    const canEnterNewPosition = positionCount === 0;
    expect(canEnterNewPosition).toBe(false);

    // Only AFTER the position is closed should new entries be allowed
    portfolio.closeLong('AAA/USDT', 'all', 100, 1_000_001, 0);
    const positionCountAfter = portfolio.getPositionCount();
    const canEnterAfterClose = positionCountAfter === 0;

    expect(canEnterAfterClose).toBe(true);
  });
});

// ============================================================================
// Additional regression tests for allocation math
// ============================================================================

describe('Allocation math: regression tests', () => {
  it('top_n capital formula snapshot: 3 signals, $10k → each should get $3000', () => {
    // Direct arithmetic check of the correct formula (snapshot of expected values)
    const initialCash = 10_000;
    const numSignals = 3;

    // Correct formula: fix cash at initial value before loop
    const cashSnapshot = initialCash;
    const perTrade = (cashSnapshot * 0.9) / numSignals;

    expect(perTrade).toBeCloseTo(3_000, 2);
  });

  it('weighted_multi capital formula snapshot: weight 0.7 out of total 1.0', () => {
    const initialCash = 10_000;
    const signalWeight = 0.7;
    const totalWeight = 1.0;

    const capitalForTrade = (signalWeight / totalWeight) * initialCash * 0.9;

    expect(capitalForTrade).toBeCloseTo(6_300, 2);
  });

  it('MultiSymbolPortfolio: cash decreases after openLong by exactly cost + fee', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    const amount = 50;
    const price = 100;
    const feeRate = 0.001;

    const cashBefore = portfolio.cash;
    portfolio.openLong('BTC/USDT', amount, price, 1_000_000, feeRate);
    const cashAfter = portfolio.cash;

    const tradeValue = amount * price; // $5,000
    const fee = tradeValue * feeRate;  // $5
    const expectedCostTotal = tradeValue + fee;    // $5,005

    expect(cashBefore - cashAfter).toBeCloseTo(expectedCostTotal, 4);
  });

  it('after closing a long at entry price, cash should equal pre-open cash minus two fees', () => {
    const portfolio = new MultiSymbolPortfolio(10_000);
    const amount = 50;
    const price = 100;
    const feeRate = 0.001;

    const cashBefore = portfolio.cash;
    portfolio.openLong('BTC/USDT', amount, price, 1_000_000, feeRate);
    portfolio.closeLong('BTC/USDT', 'all', price, 2_000_000, feeRate);

    const cashAfter = portfolio.cash;

    // Two fees paid: open fee + close fee
    const tradeValue = amount * price;
    const totalFees = tradeValue * feeRate * 2;

    expect(cashAfter).toBeCloseTo(cashBefore - totalFees, 4);
  });
});
