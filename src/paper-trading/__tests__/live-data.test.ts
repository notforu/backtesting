/**
 * LiveDataFetcher Tests
 *
 * Tests for candle filtering, warmup buffer logic, and funding rate fetching.
 * BybitProvider is fully mocked — no real network calls.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Candle, FundingRate } from '../../core/types.js';
import { timeframeToMs } from '../../core/types.js';

// ---------------------------------------------------------------------------
// Mock BybitProvider
// ---------------------------------------------------------------------------

const mockFetchCandles = vi.fn();
const mockFetchFundingRateHistory = vi.fn();

vi.mock('../../data/providers/bybit.js', () => ({
  BybitProvider: vi.fn().mockImplementation(function () {
    return {
      fetchCandles: mockFetchCandles,
      fetchFundingRateHistory: mockFetchFundingRateHistory,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Import under test (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import { LiveDataFetcher } from '../live-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandle(timestamp: number, close = 50_000): Candle {
  return { timestamp, open: close, high: close + 100, low: close - 100, close, volume: 1_000 };
}

/**
 * Build N closed candles at intervals of `tfMs` before `now`.
 * All candles satisfy `timestamp + tfMs <= now` (i.e., they are closed).
 */
function makeClosedCandles(count: number, tfMs: number, now: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = count; i >= 1; i--) {
    // The oldest is `count * tfMs` behind now-tfMs
    const ts = now - i * tfMs;
    candles.push(makeCandle(ts));
  }
  return candles;
}

function makeFundingRate(timestamp: number, rate = 0.0001): FundingRate {
  return { timestamp, fundingRate: rate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LiveDataFetcher', () => {
  let fetcher: LiveDataFetcher;
  const NOW = 1_700_000_000_000; // fixed reference timestamp

  beforeEach(() => {
    vi.clearAllMocks();
    // Pin Date.now() to a fixed value so filtering is deterministic
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    fetcher = new LiveDataFetcher();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // fetchLatestCandles — basic filtering
  // =========================================================================

  describe('fetchLatestCandles — closed candle filtering', () => {
    it('returns only closed candles (timestamp + tfMs <= now)', async () => {
      const tfMs = timeframeToMs('5m'); // 300_000 ms

      // One closed candle + one still-forming candle
      const closedTs = NOW - tfMs; // closed: closedTs + tfMs == NOW (boundary)
      const formingTs = NOW - 100; // forming: formingTs + tfMs > NOW

      mockFetchCandles.mockResolvedValue([
        makeCandle(closedTs),
        makeCandle(formingTs),
      ]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '5m', 10);

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(closedTs);
    });

    it('includes candle exactly at the boundary (timestamp + tfMs == now)', async () => {
      const tfMs = timeframeToMs('5m');
      const boundaryTs = NOW - tfMs; // boundaryTs + tfMs == NOW exactly

      mockFetchCandles.mockResolvedValue([makeCandle(boundaryTs)]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '5m', 10);

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(boundaryTs);
    });

    it('excludes candle when timestamp + tfMs > now (forming bar)', async () => {
      const tfMs = timeframeToMs('5m');
      const formingTs = NOW - tfMs + 1; // +1 ms past the boundary => still forming

      mockFetchCandles.mockResolvedValue([makeCandle(formingTs)]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '5m', 10);

      expect(result).toHaveLength(0);
    });

    it('excludes candle at NOW itself (definitely forming)', async () => {
      const tfMs = timeframeToMs('1h');

      mockFetchCandles.mockResolvedValue([makeCandle(NOW)]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', 10);

      expect(result).toHaveLength(0);
    });

    it('returns all candles when all are closed', async () => {
      const tfMs = timeframeToMs('1h');
      const closed = makeClosedCandles(5, tfMs, NOW);

      mockFetchCandles.mockResolvedValue(closed);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', 10);

      expect(result).toHaveLength(5);
    });
  });

  // =========================================================================
  // fetchLatestCandles — warmup buffer (count + 2)
  // =========================================================================

  describe('fetchLatestCandles — warmup buffer', () => {
    it('passes start = now - (count+2)*tfMs to provider', async () => {
      const tfMs = timeframeToMs('4h');
      const count = 100;

      mockFetchCandles.mockResolvedValue([]);

      await fetcher.fetchLatestCandles('BTC/USDT', '4h', count);

      expect(mockFetchCandles).toHaveBeenCalledOnce();
      const [, , startDate] = mockFetchCandles.mock.calls[0] as [string, string, Date, Date];
      const expectedStart = new Date(NOW - (count + 2) * tfMs);
      expect(startDate.getTime()).toBe(expectedStart.getTime());
    });

    it('passes end = now to provider', async () => {
      mockFetchCandles.mockResolvedValue([]);

      await fetcher.fetchLatestCandles('BTC/USDT', '1h', 50);

      const [, , , endDate] = mockFetchCandles.mock.calls[0] as [string, string, Date, Date];
      expect(endDate.getTime()).toBe(NOW);
    });

    it('warmup buffer allows for count+2 to be fetched even when some are filtered', async () => {
      const tfMs = timeframeToMs('5m');
      const count = 3;

      // Provider returns 5 candles (count+2), all closed
      const candles = makeClosedCandles(count + 2, tfMs, NOW);
      mockFetchCandles.mockResolvedValue(candles);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '5m', count);

      // Only last `count` returned
      expect(result).toHaveLength(count);
    });
  });

  // =========================================================================
  // fetchLatestCandles — slice to last `count`
  // =========================================================================

  describe('fetchLatestCandles — returns last `count` candles', () => {
    it('returns at most `count` candles', async () => {
      const tfMs = timeframeToMs('1h');
      const count = 3;
      const candles = makeClosedCandles(20, tfMs, NOW);

      mockFetchCandles.mockResolvedValue(candles);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', count);

      expect(result).toHaveLength(count);
    });

    it('returns the most recent closed candles (last in array)', async () => {
      const tfMs = timeframeToMs('1h');
      const count = 2;
      const candles = makeClosedCandles(5, tfMs, NOW);

      mockFetchCandles.mockResolvedValue(candles);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', count);

      // Last two candles of the closed set
      const expected = candles.slice(-count);
      expect(result[0].timestamp).toBe(expected[0].timestamp);
      expect(result[1].timestamp).toBe(expected[1].timestamp);
    });

    it('returns fewer than count when provider returns fewer closed candles', async () => {
      const tfMs = timeframeToMs('4h');
      const count = 200;
      const candles = makeClosedCandles(3, tfMs, NOW);

      mockFetchCandles.mockResolvedValue(candles);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '4h', count);

      expect(result).toHaveLength(3);
    });
  });

  // =========================================================================
  // fetchLatestCandles — empty/edge responses
  // =========================================================================

  describe('fetchLatestCandles — empty response', () => {
    it('returns empty array when provider returns empty array', async () => {
      mockFetchCandles.mockResolvedValue([]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', 200);

      expect(result).toHaveLength(0);
    });

    it('returns empty array when all returned candles are still forming', async () => {
      const tfMs = timeframeToMs('1m');
      // Only one candle, still forming
      mockFetchCandles.mockResolvedValue([makeCandle(NOW - tfMs + 1)]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1m', 10);

      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // fetchLatestCandles — count=1 edge case
  // =========================================================================

  describe('fetchLatestCandles — count=1', () => {
    it('returns exactly one closed candle when count=1 and one is available', async () => {
      const tfMs = timeframeToMs('1h');
      const closedTs = NOW - tfMs;
      mockFetchCandles.mockResolvedValue([makeCandle(closedTs)]);

      const result = await fetcher.fetchLatestCandles('BTC/USDT', '1h', 1);

      expect(result).toHaveLength(1);
      expect(result[0].timestamp).toBe(closedTs);
    });
  });

  // =========================================================================
  // fetchLatestCandles — different timeframes
  // =========================================================================

  describe('fetchLatestCandles — different timeframes', () => {
    const timeframes: Array<[string, number]> = [
      ['1m', 60_000],
      ['5m', 300_000],
      ['15m', 900_000],
      ['1h', 3_600_000],
      ['4h', 14_400_000],
      ['1d', 86_400_000],
    ];

    for (const [tf, expectedTfMs] of timeframes) {
      it(`correctly filters candles for ${tf} timeframe`, async () => {
        const closedTs = NOW - expectedTfMs; // exactly at boundary
        const formingTs = NOW - expectedTfMs + 1; // one ms past boundary = forming

        mockFetchCandles.mockResolvedValue([
          makeCandle(closedTs),
          makeCandle(formingTs),
        ]);

        const result = await fetcher.fetchLatestCandles('BTC/USDT', tf as Parameters<typeof fetcher.fetchLatestCandles>[1], 10);

        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toBe(closedTs);
      });
    }
  });

  // =========================================================================
  // fetchCurrentPrice
  // =========================================================================

  describe('fetchCurrentPrice', () => {
    it('returns price and timestamp of the last closed candle', async () => {
      const tfMs = timeframeToMs('5m');
      const ts = NOW - tfMs;
      mockFetchCandles.mockResolvedValue([makeCandle(ts, 48_000)]);

      const result = await fetcher.fetchCurrentPrice('BTC/USDT', '5m');

      expect(result.price).toBe(48_000);
      expect(result.timestamp).toBe(ts);
    });

    it('throws when no closed candles are available', async () => {
      mockFetchCandles.mockResolvedValue([]);

      await expect(
        fetcher.fetchCurrentPrice('BTC/USDT', '5m')
      ).rejects.toThrow('No closed candles available for BTC/USDT 5m');
    });

    it('returns the last candle when multiple closed candles are returned', async () => {
      const tfMs = timeframeToMs('1h');
      const candles = makeClosedCandles(5, tfMs, NOW);
      mockFetchCandles.mockResolvedValue(candles);

      const result = await fetcher.fetchCurrentPrice('BTC/USDT', '1h');

      // fetchCurrentPrice internally calls fetchLatestCandles(symbol, tf, 1)
      // which returns last 1 candle
      expect(result.timestamp).toBe(candles[candles.length - 1].timestamp);
    });
  });

  // =========================================================================
  // fetchLatestFundingRates
  // =========================================================================

  describe('fetchLatestFundingRates', () => {
    it('returns funding rates from provider', async () => {
      const rates: FundingRate[] = [
        makeFundingRate(NOW - 8 * 3600 * 1000, 0.0001),
        makeFundingRate(NOW - 16 * 3600 * 1000, 0.0002),
      ];
      mockFetchFundingRateHistory.mockResolvedValue(rates);

      const result = await fetcher.fetchLatestFundingRates('BTC/USDT', 10);

      expect(result).toEqual(rates);
    });

    it('calls provider with correct start date (count * 8h back)', async () => {
      mockFetchFundingRateHistory.mockResolvedValue([]);

      await fetcher.fetchLatestFundingRates('BTC/USDT', 5);

      const [, startDate] = mockFetchFundingRateHistory.mock.calls[0] as [string, Date, Date];
      const expectedStart = NOW - 5 * 8 * 3600 * 1000;
      expect(startDate.getTime()).toBe(expectedStart);
    });

    it('calls provider with end = now', async () => {
      mockFetchFundingRateHistory.mockResolvedValue([]);

      await fetcher.fetchLatestFundingRates('BTC/USDT', 3);

      const [, , endDate] = mockFetchFundingRateHistory.mock.calls[0] as [string, Date, Date];
      expect(endDate.getTime()).toBe(NOW);
    });

    it('returns empty array when provider returns no rates', async () => {
      mockFetchFundingRateHistory.mockResolvedValue([]);

      const result = await fetcher.fetchLatestFundingRates('BTC/USDT', 10);

      expect(result).toHaveLength(0);
    });

    it('passes through the symbol to the provider', async () => {
      mockFetchFundingRateHistory.mockResolvedValue([]);

      await fetcher.fetchLatestFundingRates('ETH/USDT', 3);

      const [symbol] = mockFetchFundingRateHistory.mock.calls[0] as [string];
      expect(symbol).toBe('ETH/USDT');
    });
  });
});
