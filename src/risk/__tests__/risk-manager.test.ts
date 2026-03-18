/**
 * Unit tests for RiskManager
 * Written FIRST (TDD) — all tests cover the interface spec.
 *
 * Test groups:
 *  1. Pre-trade validation (tests 1–10)
 *  2. Kill switch (tests 11–18)
 *  3. Equity tracking (tests 19–24)
 *  4. Daily reset (tests 25–27)
 *  5. Edge cases (tests 28–30)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RiskManager } from '../risk-manager.js';
import type { RiskManagerConfig } from '../risk-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: RiskManagerConfig = {
  maxCapital: 1000,
  maxTradeSize: 100,
  maxPositions: 5,
  killSwitchEnabled: true,
  killSwitchDDPercent: 30,
  symbolWhitelist: [],
};

function makeRM(overrides: Partial<RiskManagerConfig> = {}): RiskManager {
  return new RiskManager({ ...BASE_CONFIG, ...overrides });
}

// ---------------------------------------------------------------------------
// 1. Pre-trade validation
// ---------------------------------------------------------------------------

describe('RiskManager — pre-trade validation', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = makeRM();
    // Seed equity so kill switch doesn't fire on an empty state
    rm.onEquityUpdate(1000);
  });

  // Test 1
  it('allows a valid trade within all limits', () => {
    const result = rm.validateTrade({ symbol: 'BTC/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // Test 2
  it('rejects a trade that exceeds maxTradeSize', () => {
    const result = rm.validateTrade({ symbol: 'BTC/USDT', size: 101, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/trade size/i);
  });

  // Test 3
  it('rejects a trade when maxPositions is already reached', () => {
    for (let i = 0; i < 5; i++) {
      rm.onTradeOpened({ symbol: `SYM${i}/USDT`, size: 50 });
    }
    const result = rm.validateTrade({ symbol: 'NEW/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/positions/i);
  });

  // Test 4
  it('rejects a trade for a symbol not in the whitelist', () => {
    const rmW = makeRM({ symbolWhitelist: ['BTC/USDT', 'ETH/USDT'] });
    rmW.onEquityUpdate(1000);
    const result = rmW.validateTrade({ symbol: 'DOGE/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/whitelist/i);
  });

  // Test 5
  it('allows a trade for a symbol that is in the whitelist', () => {
    const rmW = makeRM({ symbolWhitelist: ['BTC/USDT', 'ETH/USDT'] });
    rmW.onEquityUpdate(1000);
    const result = rmW.validateTrade({ symbol: 'BTC/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(true);
  });

  // Test 6
  it('allows any symbol when whitelist is empty', () => {
    const result = rm.validateTrade({ symbol: 'RANDOM/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(true);
  });

  // Test 7
  it('rejects a trade when the kill switch is triggered', () => {
    // Drive equity down by 31% to trigger kill switch
    rm.onEquityUpdate(690); // 31% drawdown from 1000
    rm.checkKillSwitch();
    const result = rm.validateTrade({ symbol: 'BTC/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/kill switch/i);
  });

  // Test 8
  it('rejects a trade when adding it would exceed maxCapital', () => {
    // Open positions totalling 950 — next 100 would push it to 1050
    for (let i = 0; i < 4; i++) {
      rm.onTradeOpened({ symbol: `SYM${i}/USDT`, size: 100 });
    }
    // 4 × 100 = 400 committed; maxCapital = 1000, so we still have 600 headroom.
    // Use a smaller maxCapital to make this test deterministic.
    // maxTradeSize must be >= 150 so the size check does not fire first.
    const rmSmall = makeRM({ maxCapital: 300, maxPositions: 10, maxTradeSize: 200 });
    rmSmall.onEquityUpdate(300);
    rmSmall.onTradeOpened({ symbol: 'SYM0/USDT', size: 100 });
    rmSmall.onTradeOpened({ symbol: 'SYM1/USDT', size: 100 });
    // 200 committed; adding 150 would exceed 300
    const result = rmSmall.validateTrade({ symbol: 'BTC/USDT', size: 150, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/capital/i);
  });

  // Test 9
  it('rejects a trade when maxDailyTrades limit is reached', () => {
    const rmD = makeRM({ maxDailyTrades: 2 });
    rmD.onEquityUpdate(1000);
    rmD.onTradeOpened({ symbol: 'SYM0/USDT', size: 10 });
    rmD.onTradeClosed({ symbol: 'SYM0/USDT', pnl: 0 });
    rmD.onTradeOpened({ symbol: 'SYM1/USDT', size: 10 });
    rmD.onTradeClosed({ symbol: 'SYM1/USDT', pnl: 0 });
    const result = rmD.validateTrade({ symbol: 'BTC/USDT', size: 10, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily trades/i);
  });

  // Test 10
  it('rejects a trade when maxDailyLoss is reached', () => {
    const rmL = makeRM({ maxDailyLoss: 50 });
    rmL.onEquityUpdate(1000);
    rmL.onTradeOpened({ symbol: 'SYM0/USDT', size: 60 });
    rmL.onTradeClosed({ symbol: 'SYM0/USDT', pnl: -55 }); // loss exceeds $50
    const result = rmL.validateTrade({ symbol: 'BTC/USDT', size: 10, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily loss/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Kill switch
// ---------------------------------------------------------------------------

describe('RiskManager — kill switch', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = makeRM({ killSwitchDDPercent: 30 });
    rm.onEquityUpdate(1000);
  });

  // Test 11
  it('triggers when drawdown exceeds the threshold', () => {
    rm.onEquityUpdate(690); // ~31% DD
    const check = rm.checkKillSwitch();
    expect(check.triggered).toBe(true);
    expect(check.reason).toMatch(/drawdown/i);
  });

  // Test 12
  it('does NOT trigger when drawdown is below the threshold', () => {
    rm.onEquityUpdate(750); // 25% DD — below 30%
    const check = rm.checkKillSwitch();
    expect(check.triggered).toBe(false);
  });

  // Test 13
  it('correctly tracks peak equity (high water mark)', () => {
    rm.onEquityUpdate(1200); // new peak
    rm.onEquityUpdate(1100); // partial pullback
    const state = rm.getState();
    expect(state.peakEquity).toBe(1200);
    // 1100 / 1200 = 8.3% DD — well below 30%
    expect(state.isKillSwitchTriggered).toBe(false);
  });

  // Test 14
  it('remains triggered after equity recovers (manual reset required)', () => {
    rm.onEquityUpdate(600); // large drop → triggers
    rm.checkKillSwitch();
    rm.onEquityUpdate(1100); // equity recovers above peak
    const check = rm.checkKillSwitch();
    expect(check.triggered).toBe(true); // still triggered
  });

  // Test 15
  it('resetKillSwitch clears the triggered state', () => {
    rm.onEquityUpdate(600);
    rm.checkKillSwitch();
    expect(rm.getState().isKillSwitchTriggered).toBe(true);
    rm.resetKillSwitch();
    expect(rm.getState().isKillSwitchTriggered).toBe(false);
    expect(rm.getState().killSwitchTriggeredAt).toBeNull();
  });

  // Test 16
  it('kill switch can be disabled via config', () => {
    const rmOff = makeRM({ killSwitchEnabled: false });
    rmOff.onEquityUpdate(1000);
    rmOff.onEquityUpdate(100); // 90% drawdown
    const check = rmOff.checkKillSwitch();
    expect(check.triggered).toBe(false);
  });

  // Test 17
  it('when kill switch disabled, trades are still allowed even at large drawdown', () => {
    const rmOff = makeRM({ killSwitchEnabled: false });
    rmOff.onEquityUpdate(1000);
    rmOff.onEquityUpdate(100); // massive drawdown
    rmOff.checkKillSwitch();
    const result = rmOff.validateTrade({ symbol: 'BTC/USDT', size: 50, direction: 'long' });
    expect(result.allowed).toBe(true);
  });

  // Test 18
  it('updateConfig can toggle killSwitchEnabled on and off', () => {
    // Start enabled — trigger it
    rm.onEquityUpdate(600);
    rm.checkKillSwitch();
    expect(rm.getState().isKillSwitchTriggered).toBe(true);

    // Disable and reset
    rm.updateConfig({ killSwitchEnabled: false });
    rm.resetKillSwitch();
    rm.onEquityUpdate(100);
    const check = rm.checkKillSwitch();
    expect(check.triggered).toBe(false);

    // Re-enable
    rm.updateConfig({ killSwitchEnabled: true });
    // With current equity 100 vs peak 1000, DD = 90% → should trigger immediately
    rm.checkKillSwitch();
    expect(rm.getState().isKillSwitchTriggered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Equity tracking
// ---------------------------------------------------------------------------

describe('RiskManager — equity tracking', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = makeRM();
    rm.onEquityUpdate(1000);
  });

  // Test 19
  it('onEquityUpdate sets a new peak when equity is a new high', () => {
    rm.onEquityUpdate(1500);
    expect(rm.getState().peakEquity).toBe(1500);
  });

  // Test 20
  it('onEquityUpdate does NOT update peak when equity drops', () => {
    rm.onEquityUpdate(1500);
    rm.onEquityUpdate(900);
    expect(rm.getState().peakEquity).toBe(1500);
  });

  // Test 21
  it('calculates drawdown percentage correctly: (peak - current) / peak * 100', () => {
    rm.onEquityUpdate(1200); // new peak
    rm.onEquityUpdate(900);  // drop
    const state = rm.getState();
    const expectedDD = ((1200 - 900) / 1200) * 100;
    expect(state.currentDrawdownPercent).toBeCloseTo(expectedDD, 4);
  });

  // Test 22
  it('onTradeOpened increments open position count', () => {
    expect(rm.getState().openPositionCount).toBe(0);
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    expect(rm.getState().openPositionCount).toBe(1);
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 30 });
    expect(rm.getState().openPositionCount).toBe(2);
  });

  // Test 23
  it('onTradeClosed decrements position count and adds loss to dailyLoss', () => {
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 100 });
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: -20 });
    const state = rm.getState();
    expect(state.openPositionCount).toBe(0);
    expect(state.dailyLoss).toBe(20); // stored as positive magnitude
  });

  // Test 24
  it('position count never goes below 0', () => {
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: 0 }); // no matching open
    expect(rm.getState().openPositionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Daily reset
// ---------------------------------------------------------------------------

describe('RiskManager — daily reset', () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = makeRM();
    rm.onEquityUpdate(1000);
  });

  // Test 25
  it('resetDailyCounters resets dailyLoss and dailyTradeCount to 0', () => {
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: -30 });
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'ETH/USDT', pnl: -10 });
    expect(rm.getState().dailyLoss).toBeGreaterThan(0);
    expect(rm.getState().dailyTradeCount).toBeGreaterThan(0);

    rm.resetDailyCounters();

    expect(rm.getState().dailyLoss).toBe(0);
    expect(rm.getState().dailyTradeCount).toBe(0);
  });

  // Test 26
  it('daily counters accumulate correctly across multiple trades', () => {
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: -10 });
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'ETH/USDT', pnl: -15 });
    rm.onTradeOpened({ symbol: 'SOL/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'SOL/USDT', pnl: 25 }); // profit — should NOT add to loss

    const state = rm.getState();
    expect(state.dailyTradeCount).toBe(3);
    expect(state.dailyLoss).toBe(25); // only losses accumulate
  });

  // Test 27
  it('lastResetDate updates to current date on resetDailyCounters', () => {
    const before = rm.getState().lastResetDate;
    rm.resetDailyCounters();
    const after = rm.getState().lastResetDate;
    // Should be a YYYY-MM-DD string
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // In a test run, before and after are both "today" but the key thing
    // is that it IS set (not null/empty) and is valid format.
    expect(after).toBeTruthy();
    // after >= before (same or newer date)
    expect(after >= before).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------

describe('RiskManager — edge cases', () => {
  // Test 28
  it('throws on invalid config: negative maxCapital', () => {
    expect(() => makeRM({ maxCapital: -500 })).toThrow(/maxCapital/i);
  });

  it('throws on invalid config: zero maxCapital', () => {
    expect(() => makeRM({ maxCapital: 0 })).toThrow(/maxCapital/i);
  });

  it('throws on invalid config: negative maxTradeSize', () => {
    expect(() => makeRM({ maxTradeSize: -1 })).toThrow(/maxTradeSize/i);
  });

  it('throws on invalid config: maxPositions less than 1', () => {
    expect(() => makeRM({ maxPositions: 0 })).toThrow(/maxPositions/i);
  });

  it('throws on invalid config: killSwitchDDPercent not in (0, 100)', () => {
    expect(() => makeRM({ killSwitchDDPercent: 0 })).toThrow(/killSwitchDDPercent/i);
    expect(() => makeRM({ killSwitchDDPercent: 100 })).toThrow(/killSwitchDDPercent/i);
    expect(() => makeRM({ killSwitchDDPercent: -5 })).toThrow(/killSwitchDDPercent/i);
  });

  // Test 29 (was: zero maxCapital → reject all trades — now uses tiny positive capital)
  it('rejects all trades when committed capital equals maxCapital', () => {
    const rm = makeRM({ maxCapital: 100, maxTradeSize: 100, maxPositions: 10 });
    rm.onEquityUpdate(100);
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 100 });
    const result = rm.validateTrade({ symbol: 'ETH/USDT', size: 1, direction: 'long' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/capital/i);
  });

  // Test 30 — concurrent position tracking with mixed symbols
  it('tracks position count correctly with mixed symbols open/close', () => {
    const rm = makeRM();
    rm.onEquityUpdate(1000);

    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 50 });
    rm.onTradeOpened({ symbol: 'SOL/USDT', size: 50 });
    expect(rm.getState().openPositionCount).toBe(3);

    rm.onTradeClosed({ symbol: 'ETH/USDT', pnl: 10 });
    expect(rm.getState().openPositionCount).toBe(2);

    rm.onTradeOpened({ symbol: 'DOGE/USDT', size: 30 });
    expect(rm.getState().openPositionCount).toBe(3);

    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: -20 });
    rm.onTradeClosed({ symbol: 'SOL/USDT', pnl: 5 });
    rm.onTradeClosed({ symbol: 'DOGE/USDT', pnl: -5 });
    expect(rm.getState().openPositionCount).toBe(0);
  });

  // Additional: getConfig returns the current config
  it('getConfig returns a copy of the current config', () => {
    const rm = makeRM();
    const cfg = rm.getConfig();
    expect(cfg.maxCapital).toBe(BASE_CONFIG.maxCapital);
    expect(cfg.maxPositions).toBe(BASE_CONFIG.maxPositions);
  });

  // Additional: updateConfig partially updates config
  it('updateConfig updates only the specified fields', () => {
    const rm = makeRM();
    rm.updateConfig({ maxTradeSize: 200 });
    expect(rm.getConfig().maxTradeSize).toBe(200);
    expect(rm.getConfig().maxCapital).toBe(BASE_CONFIG.maxCapital); // unchanged
  });

  // Additional: updateConfig throws on invalid partial update
  it('updateConfig throws when updated value is invalid', () => {
    const rm = makeRM();
    expect(() => rm.updateConfig({ maxCapital: -1 })).toThrow(/maxCapital/i);
  });

  // Additional: dailyTradeCount increments on open, not close
  it('dailyTradeCount increments when a trade is opened', () => {
    const rm = makeRM();
    rm.onEquityUpdate(1000);
    expect(rm.getState().dailyTradeCount).toBe(0);
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    expect(rm.getState().dailyTradeCount).toBe(1);
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: 10 });
    expect(rm.getState().dailyTradeCount).toBe(1); // still 1 — counted on open
  });

  // Additional: onTradeClosed with profit does NOT increase dailyLoss
  it('onTradeClosed with a profit does not increase dailyLoss', () => {
    const rm = makeRM();
    rm.onEquityUpdate(1000);
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 50 });
    rm.onTradeClosed({ symbol: 'BTC/USDT', pnl: 100 });
    expect(rm.getState().dailyLoss).toBe(0);
  });

  // Additional: kill switch timestamp is set when triggered
  it('kill switch records a timestamp when triggered', () => {
    const rm = makeRM();
    const before = Date.now();
    rm.onEquityUpdate(1000);
    rm.onEquityUpdate(600); // 40% DD
    rm.checkKillSwitch();
    const after = Date.now();
    const ts = rm.getState().killSwitchTriggeredAt;
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  // Additional: committed capital tracks correctly
  it('committed capital is tracked across open positions', () => {
    const rm = makeRM({ maxCapital: 500, maxPositions: 10, maxTradeSize: 200 });
    rm.onEquityUpdate(1000);
    rm.onTradeOpened({ symbol: 'BTC/USDT', size: 200 });
    rm.onTradeOpened({ symbol: 'ETH/USDT', size: 200 });
    // 400 committed; 100 headroom; adding 150 should fail
    const fail = rm.validateTrade({ symbol: 'SOL/USDT', size: 150, direction: 'long' });
    expect(fail.allowed).toBe(false);
    // Adding 100 should succeed (exactly at limit)
    const ok = rm.validateTrade({ symbol: 'SOL/USDT', size: 100, direction: 'long' });
    expect(ok.allowed).toBe(true);
  });
});
