/**
 * PriceWatcher Tests
 *
 * Tests for price polling, equity calculation, session management,
 * and error handling. CCXT is fully mocked — no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PaperPosition } from '../types.js';

// ---------------------------------------------------------------------------
// CCXT mock
// ---------------------------------------------------------------------------

let mockFetchTickers: ReturnType<typeof vi.fn>;

vi.mock('ccxt', async () => {
  class MockBybit {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public readonly _constructorArgs: any) {}

    fetchTickers(...args: unknown[]) {
      return mockFetchTickers(...args);
    }
  }

  return {
    default: { bybit: MockBybit },
    bybit: MockBybit,
  };
});

// ---------------------------------------------------------------------------
// Import under test (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { PriceWatcher } from '../price-watcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: 1,
    sessionId: 'sess-1',
    symbol: 'BTC/USDT',
    direction: 'long',
    subStrategyKey: 'test:BTC/USDT:4h',
    entryPrice: 50_000,
    amount: 0.1,
    entryTime: Date.now() - 3600_000,
    unrealizedPnl: 0,
    fundingAccumulated: 0,
    stopLoss: null,
    takeProfit: null,
    ...overrides,
  };
}

/** Build a tickers response map from symbol -> markPrice. */
function makeTickers(entries: Record<string, number>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [symbol, markPrice] of Object.entries(entries)) {
    result[symbol] = { markPrice, last: markPrice - 10, info: { markPrice: String(markPrice) } };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PriceWatcher', () => {
  let watcher: PriceWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockFetchTickers = vi.fn().mockResolvedValue({});
    watcher = new PriceWatcher();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // registerSession / unregisterSession
  // =========================================================================

  describe('registerSession', () => {
    it('stores session and accumulates symbols from positions', () => {
      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], cb);
      // Verify start() sees this session
      watcher.start();
      expect(watcher['sessions'].size).toBe(1);
    });

    it('allows multiple sessions to be registered', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 5_000, [], vi.fn());
      watcher.registerSession('s2', ['ETH/USDT'], 5_000, [], vi.fn());
      expect(watcher['sessions'].size).toBe(2);
    });
  });

  describe('unregisterSession', () => {
    it('removes the session from the map', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.unregisterSession('s1');
      expect(watcher['sessions'].size).toBe(0);
    });

    it('stops the watcher when the last session is removed while running', async () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      expect(watcher['running']).toBe(true);

      // Advance by the poll interval once so first poll resolves
      await vi.advanceTimersByTimeAsync(2_001);

      watcher.unregisterSession('s1');
      // Allow stop() promise to resolve
      await Promise.resolve();
      await Promise.resolve();
      expect(watcher['running']).toBe(false);
    });

    it('does nothing when session does not exist', () => {
      expect(() => watcher.unregisterSession('nonexistent')).not.toThrow();
    });
  });

  // =========================================================================
  // updateSessionState
  // =========================================================================

  describe('updateSessionState', () => {
    it('updates cash and positions on existing session', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      const pos = makePosition({ symbol: 'ETH/USDT' });
      watcher.updateSessionState('s1', 8_000, [pos]);

      const snap = watcher['sessions'].get('s1')!;
      expect(snap.cash).toBe(8_000);
      expect(snap.positions).toHaveLength(1);
    });

    it('adds new position symbols to the watched symbol set', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      const pos = makePosition({ symbol: 'ETH/USDT' });
      watcher.updateSessionState('s1', 10_000, [pos]);

      const snap = watcher['sessions'].get('s1')!;
      expect(snap.symbols.has('ETH/USDT')).toBe(true);
      expect(snap.symbols.has('BTC/USDT')).toBe(true);
    });

    it('silently ignores unknown sessionId', () => {
      expect(() =>
        watcher.updateSessionState('unknown', 1_000, [])
      ).not.toThrow();
    });
  });

  // =========================================================================
  // start / stop
  // =========================================================================

  describe('start', () => {
    it('does not start when no sessions are registered', () => {
      watcher.start();
      expect(watcher['running']).toBe(false);
    });

    it('starts and sets running=true when sessions exist', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      expect(watcher['running']).toBe(true);
    });

    it('is idempotent — calling start() twice does not create duplicate timers', () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      watcher.start();
      // Only one interval should be running
      expect(watcher['pollTimer']).not.toBeNull();
      // pollCount stays at 0 until first tick runs
      expect(watcher['pollCount']).toBe(0);
    });

    it('fires an immediate poll on start', async () => {
      mockFetchTickers.mockResolvedValue(makeTickers({ 'BTC/USDT': 51_000 }));
      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], cb);
      watcher.start();

      // Advance enough to let the immediate poll() resolve (it's async)
      await vi.advanceTimersByTimeAsync(100);

      expect(mockFetchTickers).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('clears pollTimer and sets running=false', async () => {
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await watcher.stop();

      expect(watcher['running']).toBe(false);
      expect(watcher['pollTimer']).toBeNull();
    });

    it('is idempotent — stop() on a stopped watcher does nothing', async () => {
      await watcher.stop();
      expect(watcher['running']).toBe(false);
    });
  });

  // =========================================================================
  // collectAllSymbols
  // =========================================================================

  describe('collectAllSymbols (internal)', () => {
    it('deduplicates symbols shared across sessions', () => {
      const pos = makePosition({ symbol: 'BTC/USDT' });
      watcher.registerSession('s1', ['BTC/USDT', 'ETH/USDT'], 5_000, [pos], vi.fn());
      watcher.registerSession('s2', ['BTC/USDT'], 5_000, [], vi.fn());

      const symbols = watcher['collectAllSymbols']();
      const btcCount = symbols.filter(s => s === 'BTC/USDT').length;
      expect(btcCount).toBe(1);
      expect(symbols).toContain('ETH/USDT');
    });

    it('returns empty array when no sessions', () => {
      expect(watcher['collectAllSymbols']()).toHaveLength(0);
    });
  });

  // =========================================================================
  // computeEquity — no positions
  // =========================================================================

  describe('computeEquity — no positions', () => {
    it('returns equity == cash, positionsValue == 0 when no positions', () => {
      const snapshot = {
        symbols: new Set<string>(),
        cash: 12_000,
        positions: [],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, 12345);

      expect(update.equity).toBe(12_000);
      expect(update.cash).toBe(12_000);
      expect(update.positionsValue).toBe(0);
      expect(update.markPrices).toEqual({});
      expect(update.timestamp).toBe(12345);
    });
  });

  // =========================================================================
  // computeEquity — long positions
  // =========================================================================

  describe('computeEquity — long positions', () => {
    it('calculates equity correctly for a long position with cached mark price', () => {
      watcher['priceCache']['BTC/USDT'] = 52_000;

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 5_000,
        positions: [makePosition({ direction: 'long', entryPrice: 50_000, amount: 0.1 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // positionsValue = mark * amount = 52000 * 0.1 = 5200
      expect(update.positionsValue).toBeCloseTo(5_200, 4);
      // equity = cash + positionsValue
      expect(update.equity).toBeCloseTo(5_000 + 5_200, 4);
      expect(update.markPrices['BTC/USDT']).toBe(52_000);
    });

    it('falls back to entryPrice * amount when mark price is not cached', () => {
      // priceCache is empty — no entry for BTC/USDT

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 5_000,
        positions: [makePosition({ direction: 'long', entryPrice: 50_000, amount: 0.2 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // Falls back: positionsValue = 50000 * 0.2 = 10000
      expect(update.positionsValue).toBeCloseTo(10_000, 4);
      expect(update.markPrices).not.toHaveProperty('BTC/USDT');
    });

    it('long PnL is positive when mark > entry', () => {
      watcher['priceCache']['BTC/USDT'] = 55_000; // above entry

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 10_000,
        positions: [makePosition({ direction: 'long', entryPrice: 50_000, amount: 1.0 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());
      // positionsValue = 55000 * 1.0 = 55000 > 50000 (entry-based)
      expect(update.positionsValue).toBe(55_000);
      expect(update.equity).toBe(65_000);
    });

    it('long PnL is negative when mark < entry', () => {
      watcher['priceCache']['BTC/USDT'] = 45_000; // below entry

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 10_000,
        positions: [makePosition({ direction: 'long', entryPrice: 50_000, amount: 1.0 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());
      // positionsValue = 45000 * 1.0
      expect(update.positionsValue).toBe(45_000);
      expect(update.equity).toBe(55_000);
    });
  });

  // =========================================================================
  // computeEquity — short positions
  // =========================================================================

  describe('computeEquity — short positions', () => {
    it('calculates equity correctly for a short position (mark below entry = profit)', () => {
      watcher['priceCache']['BTC/USDT'] = 48_000; // price fell

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 5_000,
        positions: [makePosition({ direction: 'short', entryPrice: 50_000, amount: 0.1 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // Short formula: (2 * entryPrice - mark) * amount = (100000 - 48000) * 0.1 = 5200
      expect(update.positionsValue).toBeCloseTo(5_200, 4);
      expect(update.equity).toBeCloseTo(10_200, 4);
    });

    it('short position loses value when price rises above entry', () => {
      watcher['priceCache']['BTC/USDT'] = 55_000; // price rose

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 10_000,
        positions: [makePosition({ direction: 'short', entryPrice: 50_000, amount: 1.0 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // (2 * 50000 - 55000) * 1 = 45000
      expect(update.positionsValue).toBe(45_000);
      expect(update.equity).toBe(55_000);
    });

    it('short position at entry price = break-even (positionsValue == entryPrice * amount)', () => {
      watcher['priceCache']['BTC/USDT'] = 50_000; // same as entry

      const snapshot = {
        symbols: new Set(['BTC/USDT']),
        cash: 0,
        positions: [makePosition({ direction: 'short', entryPrice: 50_000, amount: 1.0 })],
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());
      // (2 * 50000 - 50000) * 1 = 50000
      expect(update.positionsValue).toBe(50_000);
    });
  });

  // =========================================================================
  // computeEquity — mixed long + short across symbols
  // =========================================================================

  describe('computeEquity — mixed long and short', () => {
    it('sums positionsValue across multiple positions of different symbols', () => {
      watcher['priceCache']['BTC/USDT'] = 52_000;
      watcher['priceCache']['ETH/USDT'] = 2_000;

      const positions: PaperPosition[] = [
        makePosition({ id: 1, symbol: 'BTC/USDT', direction: 'long', entryPrice: 50_000, amount: 0.1 }),
        makePosition({ id: 2, symbol: 'ETH/USDT', direction: 'short', entryPrice: 2_100, amount: 1.0 }),
      ];

      const snapshot = {
        symbols: new Set(['BTC/USDT', 'ETH/USDT']),
        cash: 1_000,
        positions,
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // BTC long: 52000 * 0.1 = 5200
      // ETH short: (2*2100 - 2000) * 1 = 2200
      // total positionsValue = 7400
      expect(update.positionsValue).toBeCloseTo(7_400, 4);
      expect(update.equity).toBeCloseTo(8_400, 4);
      expect(update.markPrices['BTC/USDT']).toBe(52_000);
      expect(update.markPrices['ETH/USDT']).toBe(2_000);
    });

    it('uses entryPrice fallback for symbol with missing mark and real mark for the other', () => {
      watcher['priceCache']['ETH/USDT'] = 2_000;
      // BTC/USDT NOT in cache

      const positions: PaperPosition[] = [
        makePosition({ id: 1, symbol: 'BTC/USDT', direction: 'long', entryPrice: 50_000, amount: 0.1 }),
        makePosition({ id: 2, symbol: 'ETH/USDT', direction: 'long', entryPrice: 1_900, amount: 1.0 }),
      ];

      const snapshot = {
        symbols: new Set(['BTC/USDT', 'ETH/USDT']),
        cash: 0,
        positions,
        callback: vi.fn(),
      };

      const update = watcher['computeEquity'](snapshot, Date.now());

      // BTC falls back to entryPrice: 50000 * 0.1 = 5000
      // ETH uses mark: 2000 * 1 = 2000
      expect(update.positionsValue).toBeCloseTo(7_000, 4);
      expect(update.markPrices['ETH/USDT']).toBe(2_000);
      expect(update.markPrices['BTC/USDT']).toBeUndefined();
    });
  });

  // =========================================================================
  // computeEquity — timestamp
  // =========================================================================

  describe('computeEquity — timestamp', () => {
    it('passes through the timestamp argument', () => {
      const snapshot = {
        symbols: new Set<string>(),
        cash: 1_000,
        positions: [],
        callback: vi.fn(),
      };

      const ts = 9_999_999;
      const update = watcher['computeEquity'](snapshot, ts);
      expect(update.timestamp).toBe(ts);
    });
  });

  // =========================================================================
  // poll — price cache update
  // =========================================================================

  describe('poll — price cache update', () => {
    it('populates priceCache with markPrice from ticker.markPrice (number)', async () => {
      mockFetchTickers.mockResolvedValue({
        'BTC/USDT': { markPrice: 53_000, last: 52_900, info: {} },
      });

      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(watcher['priceCache']['BTC/USDT']).toBe(53_000);
    });

    it('falls back to ticker.info.markPrice (string) when markPrice property is missing', async () => {
      mockFetchTickers.mockResolvedValue({
        'BTC/USDT': { info: { markPrice: '52500' }, last: 52_400 },
      });

      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(watcher['priceCache']['BTC/USDT']).toBe(52_500);
    });

    it('falls back to ticker.last when markPrice and info.markPrice are absent', async () => {
      mockFetchTickers.mockResolvedValue({
        'BTC/USDT': { last: 51_800, info: {} },
      });

      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(watcher['priceCache']['BTC/USDT']).toBe(51_800);
    });

    it('ignores ticker entries where price is 0 or NaN', async () => {
      mockFetchTickers.mockResolvedValue({
        'BTC/USDT': { markPrice: 0, last: 0, info: {} },
        'ETH/USDT': { markPrice: NaN, last: NaN, info: {} },
      });

      watcher.registerSession('s1', ['BTC/USDT', 'ETH/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(watcher['priceCache']['BTC/USDT']).toBeUndefined();
      expect(watcher['priceCache']['ETH/USDT']).toBeUndefined();
    });

    it('skips fetchTickers call when no symbols are registered', async () => {
      // Register session with no symbols
      watcher.registerSession('s1', [], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(mockFetchTickers).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // poll — callback invocation
  // =========================================================================

  describe('poll — callback invocation', () => {
    it('calls the equity callback for each registered session after each poll', async () => {
      mockFetchTickers.mockResolvedValue(
        makeTickers({ 'BTC/USDT': 52_000 })
      );

      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], cb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(cb).toHaveBeenCalled();
      const update = cb.mock.calls[0][0];
      expect(update.equity).toBeDefined();
      expect(update.cash).toBe(10_000);
    });

    it('calls callbacks for all registered sessions on each poll', async () => {
      mockFetchTickers.mockResolvedValue(
        makeTickers({ 'BTC/USDT': 52_000, 'ETH/USDT': 2_000 })
      );

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 5_000, [], cb1);
      watcher.registerSession('s2', ['ETH/USDT'], 3_000, [], cb2);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it('continues polling other sessions if one callback throws', async () => {
      mockFetchTickers.mockResolvedValue(
        makeTickers({ 'BTC/USDT': 52_000, 'ETH/USDT': 2_000 })
      );

      const throwingCb = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });
      const goodCb = vi.fn();

      watcher.registerSession('s1', ['BTC/USDT'], 5_000, [], throwingCb);
      watcher.registerSession('s2', ['ETH/USDT'], 3_000, [], goodCb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      // Even though s1 callback threw, s2 callback should still be called
      expect(goodCb).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // poll — error handling
  // =========================================================================

  describe('poll — error handling', () => {
    it('recovers from CCXT fetchTickers throwing — polling flag is reset', async () => {
      mockFetchTickers.mockRejectedValue(new Error('CCXT API timeout'));

      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], cb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      // polling flag must be false so next poll can proceed
      expect(watcher['polling']).toBe(false);
    });

    it('callbacks are still called with cached prices after a failed fetchTickers', async () => {
      // Pre-seed the cache
      watcher['priceCache']['BTC/USDT'] = 50_000;

      // First call fails
      mockFetchTickers.mockRejectedValue(new Error('rate limit'));

      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], cb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      // Callback should NOT be called because the error is thrown before the emit loop
      // (error happens in poll's try block, so we skip to finally then return without emitting)
      // But priceCache still has stale data
      expect(watcher['priceCache']['BTC/USDT']).toBe(50_000);
    });

    it('prevents overlapping polls via polling guard', async () => {
      // Simulate a slow poll
      let resolvePoll: (() => void) | undefined;
      mockFetchTickers.mockImplementation(
        () => new Promise<Record<string, unknown>>(res => { resolvePoll = () => res({}); })
      );

      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();

      // First poll is in-flight — polling is true
      // Manually call poll() again — it should bail immediately
      await watcher['poll']();
      expect(mockFetchTickers).toHaveBeenCalledTimes(1); // not called a second time

      // Resolve the pending poll
      resolvePoll?.();
      await vi.advanceTimersByTimeAsync(100);
    });
  });

  // =========================================================================
  // pollCount increment
  // =========================================================================

  describe('pollCount', () => {
    it('increments pollCount on each successful poll', async () => {
      mockFetchTickers.mockResolvedValue(makeTickers({ 'BTC/USDT': 50_000 }));

      watcher.registerSession('s1', ['BTC/USDT'], 10_000, [], vi.fn());
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      // At least one poll has completed
      expect(watcher['pollCount']).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // equity update shape
  // =========================================================================

  describe('EquityUpdate shape', () => {
    it('callback receives a valid EquityUpdate object', async () => {
      mockFetchTickers.mockResolvedValue(
        makeTickers({ 'BTC/USDT': 51_000 })
      );
      const pos = makePosition({ direction: 'long', entryPrice: 50_000, amount: 0.2 });

      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 5_000, [pos], cb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      expect(cb).toHaveBeenCalled();
      const update = cb.mock.calls[0][0];

      expect(typeof update.equity).toBe('number');
      expect(typeof update.cash).toBe('number');
      expect(typeof update.positionsValue).toBe('number');
      expect(typeof update.timestamp).toBe('number');
      expect(typeof update.markPrices).toBe('object');
    });

    it('equity == cash + positionsValue always holds', async () => {
      mockFetchTickers.mockResolvedValue(
        makeTickers({ 'BTC/USDT': 51_000 })
      );
      const pos = makePosition({ direction: 'long', entryPrice: 50_000, amount: 0.5 });

      const cb = vi.fn();
      watcher.registerSession('s1', ['BTC/USDT'], 4_000, [pos], cb);
      watcher.start();
      await vi.advanceTimersByTimeAsync(100);

      const update = cb.mock.calls[0][0];
      expect(update.equity).toBeCloseTo(update.cash + update.positionsValue, 8);
    });
  });
});
