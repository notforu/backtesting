/**
 * Unit tests for intra-bar SL/TP resolution module.
 * Tests pure logic: checkSlTpTrigger, resolveAmbiguousExit, getSubTimeframe.
 *
 * These tests are written FIRST (TDD) before the implementation exists.
 */

import { describe, it, expect } from 'vitest';
import {
  checkSlTpTrigger,
  resolveAmbiguousExit,
  getSubTimeframe,
} from '../intra-bar.js';
import type { Candle } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCandle(overrides: Partial<Candle> & { timestamp: number; close: number }): Candle {
  return {
    open: overrides.close,
    high: overrides.high ?? overrides.close,
    low: overrides.low ?? overrides.close,
    volume: 100,
    ...overrides,
  };
}

// ============================================================================
// checkSlTpTrigger — Long positions
// ============================================================================

describe('checkSlTpTrigger — long position', () => {
  const candle = makeCandle({ timestamp: 1000, open: 100, high: 110, low: 90, close: 105 });

  it('SL triggered (candle.low <= SL), TP not triggered (candle.high < TP)', () => {
    // low=90 <= SL=95, high=110 < TP=120
    const result = checkSlTpTrigger(candle, 'long', 95, 120);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('TP triggered (candle.high >= TP), SL not triggered (candle.low > SL)', () => {
    // high=110 >= TP=108, low=90 > SL=80
    const result = checkSlTpTrigger(candle, 'long', 80, 108);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });

  it('both SL and TP triggered on same bar', () => {
    // low=90 <= SL=95, high=110 >= TP=108
    const result = checkSlTpTrigger(candle, 'long', 95, 108);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(true);
  });

  it('neither SL nor TP triggered', () => {
    // low=90 > SL=85, high=110 < TP=120
    const result = checkSlTpTrigger(candle, 'long', 85, 120);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(false);
  });

  it('SL at exactly candle.low: triggers', () => {
    // low=90 <= SL=90 (exact)
    const result = checkSlTpTrigger(candle, 'long', 90, 120);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('TP at exactly candle.high: triggers', () => {
    // high=110 >= TP=110 (exact)
    const result = checkSlTpTrigger(candle, 'long', 85, 110);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });

  it('SL is null: only TP checked', () => {
    // TP triggered, but SL is null
    const result = checkSlTpTrigger(candle, 'long', null, 108);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });

  it('TP is null: only SL checked', () => {
    // SL triggered, but TP is null
    const result = checkSlTpTrigger(candle, 'long', 95, null);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('both null: returns {sl: false, tp: false}', () => {
    const result = checkSlTpTrigger(candle, 'long', null, null);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(false);
  });
});

// ============================================================================
// checkSlTpTrigger — Short positions
// ============================================================================

describe('checkSlTpTrigger — short position', () => {
  const candle = makeCandle({ timestamp: 1000, open: 100, high: 110, low: 90, close: 105 });

  it('SL triggered (candle.high >= SL), TP not triggered (candle.low > TP)', () => {
    // short: SL is above entry; high=110 >= SL=105, low=90 > TP=80
    const result = checkSlTpTrigger(candle, 'short', 105, 80);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('TP triggered (candle.low <= TP), SL not triggered (candle.high < SL)', () => {
    // short: TP is below entry; low=90 <= TP=92, high=110 < SL=120
    const result = checkSlTpTrigger(candle, 'short', 120, 92);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });

  it('both SL and TP triggered on same bar', () => {
    // high=110 >= SL=105, low=90 <= TP=92
    const result = checkSlTpTrigger(candle, 'short', 105, 92);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(true);
  });

  it('neither SL nor TP triggered', () => {
    // high=110 < SL=120, low=90 > TP=80
    const result = checkSlTpTrigger(candle, 'short', 120, 80);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(false);
  });

  it('SL is null: only TP checked', () => {
    // TP triggered (low=90 <= TP=92), SL null
    const result = checkSlTpTrigger(candle, 'short', null, 92);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });

  it('TP is null: only SL checked', () => {
    // SL triggered (high=110 >= SL=105), TP null
    const result = checkSlTpTrigger(candle, 'short', 105, null);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('SL at exactly candle.high: triggers', () => {
    // high=110 >= SL=110 (exact)
    const result = checkSlTpTrigger(candle, 'short', 110, 80);
    expect(result.slTriggered).toBe(true);
    expect(result.tpTriggered).toBe(false);
  });

  it('TP at exactly candle.low: triggers', () => {
    // low=90 <= TP=90 (exact)
    const result = checkSlTpTrigger(candle, 'short', 120, 90);
    expect(result.slTriggered).toBe(false);
    expect(result.tpTriggered).toBe(true);
  });
});

// ============================================================================
// resolveAmbiguousExit — Long positions
// ============================================================================

describe('resolveAmbiguousExit — long position', () => {
  /**
   * Build sub-candles: each is a 1-minute candle with distinct high/low.
   * Timestamps: t, t+60000, t+120000, ...
   */
  function makeSubCandles(
    specs: Array<{ high: number; low: number }>,
    startTs = 0
  ): Candle[] {
    return specs.map((s, i) =>
      makeCandle({
        timestamp: startTs + i * 60_000,
        open: (s.high + s.low) / 2,
        high: s.high,
        low: s.low,
        close: (s.high + s.low) / 2,
      })
    );
  }

  it('empty sub-candles: falls back to stop_loss (pessimistic)', () => {
    const result = resolveAmbiguousExit([], 'long', 95, 120);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(95);
  });

  it('SL hit first (sub-candle 2 triggers SL, sub-candle 5 triggers TP): returns stop_loss', () => {
    // SL=95, TP=115
    const subs = makeSubCandles([
      { high: 105, low: 100 }, // neither
      { high: 105, low: 100 }, // neither
      { high: 105, low: 93 },  // SL hit (low=93 <= SL=95)
      { high: 105, low: 100 }, // neither
      { high: 116, low: 100 }, // TP hit (high=116 >= TP=115)
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 95, 115);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(95);
  });

  it('TP hit first (sub-candle 1 triggers TP, sub-candle 4 triggers SL): returns take_profit', () => {
    // SL=85, TP=112
    const subs = makeSubCandles([
      { high: 113, low: 100 }, // TP hit (high=113 >= TP=112)
      { high: 110, low: 100 }, // neither
      { high: 110, low: 100 }, // neither
      { high: 110, low: 84 },  // SL hit (low=84 <= SL=85)
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 85, 112);
    expect(result.exitType).toBe('take_profit');
    expect(result.exitPrice).toBe(112);
  });

  it('single sub-candle triggers both SL and TP: pessimistic (stop_loss)', () => {
    // SL=95, TP=108, sub-candle has low=93 AND high=110
    const subs = makeSubCandles([
      { high: 110, low: 93 }, // both triggered on same sub-candle
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 95, 108);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(95);
  });

  it('sub-candles where neither triggers (gap): falls back to stop_loss', () => {
    // SL=80, TP=130 — sub-candles only reach high=115 and low=90
    const subs = makeSubCandles([
      { high: 115, low: 90 },
      { high: 115, low: 90 },
      { high: 115, low: 90 },
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 80, 130);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(80);
  });

  it('exit price is exactly the SL level, not sub-candle low', () => {
    const subs = makeSubCandles([
      { high: 110, low: 80 }, // SL=90 triggered (low=80 <= 90)
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 90, 115);
    expect(result.exitPrice).toBe(90); // exact SL level
  });

  it('exit price is exactly the TP level, not sub-candle high', () => {
    const subs = makeSubCandles([
      { high: 120, low: 100 }, // TP=115 triggered (high=120 >= 115)
    ]);
    const result = resolveAmbiguousExit(subs, 'long', 85, 115);
    expect(result.exitPrice).toBe(115); // exact TP level
  });

  it('exitTimestamp is the sub-candle timestamp where exit occurred', () => {
    const subs = makeSubCandles(
      [
        { high: 105, low: 100 }, // ts=0
        { high: 105, low: 100 }, // ts=60000
        { high: 105, low: 83 },  // ts=120000, SL hit
      ],
      1_000_000
    );
    const result = resolveAmbiguousExit(subs, 'long', 85, 115);
    expect(result.exitTimestamp).toBe(1_120_000); // 1_000_000 + 2 * 60_000
  });
});

// ============================================================================
// resolveAmbiguousExit — Short positions
// ============================================================================

describe('resolveAmbiguousExit — short position', () => {
  function makeSubCandles(
    specs: Array<{ high: number; low: number }>,
    startTs = 0
  ): Candle[] {
    return specs.map((s, i) =>
      makeCandle({
        timestamp: startTs + i * 60_000,
        open: (s.high + s.low) / 2,
        high: s.high,
        low: s.low,
        close: (s.high + s.low) / 2,
      })
    );
  }

  it('empty sub-candles: falls back to stop_loss (pessimistic)', () => {
    // short: SL above, TP below
    const result = resolveAmbiguousExit([], 'short', 115, 85);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(115);
  });

  it('short SL hit first (high triggers SL before low triggers TP): returns stop_loss', () => {
    // short SL=115, TP=85
    const subs = makeSubCandles([
      { high: 110, low: 90 }, // neither
      { high: 116, low: 90 }, // SL hit (high=116 >= SL=115)
      { high: 110, low: 84 }, // TP hit (low=84 <= TP=85)
    ]);
    const result = resolveAmbiguousExit(subs, 'short', 115, 85);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(115);
  });

  it('short TP hit first (low triggers TP before high triggers SL): returns take_profit', () => {
    // short SL=115, TP=85
    const subs = makeSubCandles([
      { high: 110, low: 84 }, // TP hit (low=84 <= TP=85)
      { high: 116, low: 90 }, // SL hit (high=116 >= SL=115)
    ]);
    const result = resolveAmbiguousExit(subs, 'short', 115, 85);
    expect(result.exitType).toBe('take_profit');
    expect(result.exitPrice).toBe(85);
  });

  it('short: single sub-candle triggers both: pessimistic (stop_loss)', () => {
    // high=118 >= SL=115, low=83 <= TP=85
    const subs = makeSubCandles([
      { high: 118, low: 83 },
    ]);
    const result = resolveAmbiguousExit(subs, 'short', 115, 85);
    expect(result.exitType).toBe('stop_loss');
    expect(result.exitPrice).toBe(115);
  });

  it('short exit price is exactly the TP level', () => {
    const subs = makeSubCandles([
      { high: 110, low: 82 }, // TP=85, low=82 <= 85
    ]);
    const result = resolveAmbiguousExit(subs, 'short', 120, 85);
    expect(result.exitPrice).toBe(85);
  });
});

// ============================================================================
// getSubTimeframe
// ============================================================================

describe('getSubTimeframe', () => {
  it('4h → 5m', () => {
    expect(getSubTimeframe('4h')).toBe('5m');
  });

  it('1d → 15m', () => {
    expect(getSubTimeframe('1d')).toBe('15m');
  });

  it('1h → 1m', () => {
    expect(getSubTimeframe('1h')).toBe('1m');
  });

  it('1w → 1h', () => {
    expect(getSubTimeframe('1w')).toBe('1h');
  });

  it('5m → 1m', () => {
    expect(getSubTimeframe('5m')).toBe('1m');
  });

  it('1m → 1m (already smallest)', () => {
    expect(getSubTimeframe('1m')).toBe('1m');
  });

  it('15m → 1m', () => {
    expect(getSubTimeframe('15m')).toBe('1m');
  });

  it('30m → 1m', () => {
    expect(getSubTimeframe('30m')).toBe('1m');
  });
});
