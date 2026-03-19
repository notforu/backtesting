/**
 * Tests for sub-candle resolution of ambiguous SL/TP in the aggregate engine.
 *
 * When both SL and TP are triggered on the same bar, the aggregate engine should
 * fetch sub-candles (finer timeframe) and determine which level was hit first.
 * If sub-candles are unavailable, it falls back to pessimistic fill (SL wins).
 *
 * These tests follow TDD: written first (Red phase) before the implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAggregateBacktest } from '../aggregate-engine.js';
import type { AggregateBacktestConfig } from '../signal-types.js';
import type { Candle } from '../types.js';

// ============================================================================
// Mocks
// ============================================================================

// All DB calls are mocked so no real I/O occurs
const mockGetCandles = vi.fn();
const mockGetFundingRates = vi.fn();
const mockSaveBacktestRun = vi.fn();

vi.mock('../../data/db.js', () => ({
  getCandles: (...args: unknown[]) => mockGetCandles(...args),
  getFundingRates: (...args: unknown[]) => mockGetFundingRates(...args),
  saveBacktestRun: (...args: unknown[]) => mockSaveBacktestRun(...args),
}));

// Mock strategy loader — we supply a real inline strategy object
vi.mock('../../strategy/loader.js', () => ({
  loadStrategy: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return { timestamp, open, high, low, close, volume: 1000 };
}

/** Build a strategy that opens a long on bar 0 and sets SL/TP */
function makeSlTpStrategy(sl: number, tp: number) {
  let barCount = 0;
  return {
    name: 'sl-tp-test',
    description: 'Test SL/TP',
    version: '1.0.0',
    params: [],
    onBar(ctx: { longPosition: unknown; openLong: (n: number) => void; setStopLoss: (n: number) => void; setTakeProfit: (n: number) => void }) {
      barCount++;
      if (barCount === 1 && !ctx.longPosition) {
        ctx.openLong(1);
        ctx.setStopLoss(sl);
        ctx.setTakeProfit(tp);
      }
    },
  };
}

/** Minimal aggregate config for a single sub-strategy */
function makeConfig(exchange = 'bybit'): AggregateBacktestConfig {
  return {
    subStrategies: [
      {
        strategyName: 'sl-tp-test',
        symbol: 'BTC/USDT',
        timeframe: '4h',
        params: {},
        exchange,
      },
    ],
    allocationMode: 'single_strongest',
    maxPositions: 1,
    initialCapital: 10_000,
    exchange,
    startDate: 0,
    endDate: 999_999_999,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Aggregate Engine: sub-candle SL/TP resolution', () => {
  beforeEach(() => {
    // Use resetAllMocks() (not clearAllMocks()) to also clear the mockResolvedValueOnce queues
    // from previous tests — otherwise unconsumed once-values bleed into subsequent tests.
    vi.resetAllMocks();
    mockGetFundingRates.mockResolvedValue([]);
    mockSaveBacktestRun.mockResolvedValue(undefined);
  });

  // --------------------------------------------------------------------------
  // Test A: Pessimistic fallback when no sub-candles available
  // --------------------------------------------------------------------------
  it('A: both SL and TP triggered, no sub-candles → pessimistic fill (SL wins)', async () => {
    // Bar 0 (timestamp=0): entry bar, price=100, open long
    // Bar 1 (timestamp=14400000 = 4h): low=80 (< SL=90), high=120 (> TP=110) → both triggered
    // No sub-candles → pessimistic: SL wins → exit at 90

    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both SL=90 and TP=110 triggered
      makeCandle(28_800_000, 100, 105, 95, 101), // never reached
    ];

    // First call: main candles for BTC/USDT 4h
    // Second call: sub-candle query (5m for 4h bar) → empty (no sub-candles cached)
    mockGetCandles
      .mockResolvedValueOnce(mainCandles) // main candles
      .mockResolvedValue([]); // sub-candles: empty

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90); // SL wins (pessimistic)
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  // --------------------------------------------------------------------------
  // Test B: Sub-candles resolve TP wins (hit first)
  // --------------------------------------------------------------------------
  it('B: both triggered, sub-candles show TP hit first → exit at TP', async () => {
    // Main bar (4h): both SL=90 and TP=110 triggered
    // Sub-candles (5m): first sub-candle hits TP, later sub-candle hits SL
    // → TP should win

    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both triggered
    ];

    const subCandles: Candle[] = [
      makeCandle(14_400_000, 100, 112, 95, 111),     // high=112 >= TP=110 → TP hit first
      makeCandle(14_700_000, 111, 112, 85, 88),       // low=85 <= SL=90 → SL hit later
    ];

    mockGetCandles
      .mockResolvedValueOnce(mainCandles) // main candles for BTC/USDT 4h
      .mockResolvedValueOnce(subCandles); // sub-candles (5m) for the ambiguous bar

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(110); // TP level (hit first)
    expect(closeTrade!.exitReason).toBe('take_profit');
  });

  // --------------------------------------------------------------------------
  // Test C: Sub-candles resolve SL wins (hit first)
  // --------------------------------------------------------------------------
  it('C: both triggered, sub-candles show SL hit first → exit at SL', async () => {
    // Sub-candles: first sub-candle hits SL, later sub-candle hits TP
    // → SL should win

    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both triggered
    ];

    const subCandles: Candle[] = [
      makeCandle(14_400_000, 100, 105, 85, 95),      // low=85 <= SL=90 → SL hit first
      makeCandle(14_700_000, 95, 115, 90, 112),       // high=115 >= TP=110 → TP hit later
    ];

    mockGetCandles
      .mockResolvedValueOnce(mainCandles)
      .mockResolvedValueOnce(subCandles);

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90); // SL level (hit first)
    expect(closeTrade!.exitReason).toBe('stop_loss');
  });

  // --------------------------------------------------------------------------
  // Test D: intraBarTimeframe: null → skip sub-candle fetch (pure pessimistic)
  // --------------------------------------------------------------------------
  it('D: intraBarTimeframe=null disables sub-candle fetching → always pessimistic', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100),
    ];

    mockGetCandles.mockResolvedValueOnce(mainCandles);
    // sub-candle getCandles should NOT be called

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
      intraBarTimeframe: null, // disable sub-candle resolution
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90); // SL wins (pessimistic)
    expect(closeTrade!.exitReason).toBe('stop_loss');

    // getCandles should have been called exactly once (main candles only, no sub-candle call)
    expect(mockGetCandles).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test E: Only SL triggered (not ambiguous) → still exits at SL, no sub-candle fetch
  // --------------------------------------------------------------------------
  it('E: only SL triggered → exits at SL without fetching sub-candles', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 108, 80, 90), // low=80 <= SL=90, high=108 < TP=110 → SL only
      makeCandle(28_800_000, 90, 95, 88, 92),
    ];

    mockGetCandles.mockResolvedValueOnce(mainCandles);

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(90);
    expect(closeTrade!.exitReason).toBe('stop_loss');

    // getCandles called only once (main candles; no sub-candle call for unambiguous trigger)
    expect(mockGetCandles).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test F: Only TP triggered (not ambiguous) → exits at TP, no sub-candle fetch
  // --------------------------------------------------------------------------
  it('F: only TP triggered → exits at TP without fetching sub-candles', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 115, 92, 112), // high=115 >= TP=110, low=92 > SL=90 → TP only
      makeCandle(28_800_000, 112, 115, 110, 113),
    ];

    mockGetCandles.mockResolvedValueOnce(mainCandles);

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    const closeTrade = result.trades.find(t => t.action === 'CLOSE_LONG');
    expect(closeTrade).toBeDefined();
    expect(closeTrade!.price).toBe(110);
    expect(closeTrade!.exitReason).toBe('take_profit');

    // getCandles called only once (no sub-candle call for unambiguous trigger)
    expect(mockGetCandles).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Test G: pessimisticSlTpCount and subCandleResolvedCount in metrics
  // --------------------------------------------------------------------------
  it('G: metrics.pessimisticSlTpCount reflects all ambiguous bars, subCandleResolvedCount reflects resolved ones', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both triggered (ambiguous)
    ];

    const subCandles: Candle[] = [
      makeCandle(14_400_000, 100, 112, 95, 111),  // TP hit first
      makeCandle(14_700_000, 111, 112, 85, 88),    // SL hit later
    ];

    mockGetCandles
      .mockResolvedValueOnce(mainCandles)
      .mockResolvedValueOnce(subCandles);

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    // pessimisticSlTpCount should be 1 (one ambiguous bar)
    expect((result.metrics as any).pessimisticSlTpCount).toBe(1);
    // subCandleResolvedCount should be 1 (one bar had sub-candles available)
    expect((result.metrics as any).subCandleResolvedCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test H: subCandleResolvedCount=0 when no sub-candles returned
  // --------------------------------------------------------------------------
  it('H: subCandleResolvedCount=0 when sub-candles not available (empty array)', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both triggered
    ];

    mockGetCandles
      .mockResolvedValueOnce(mainCandles)
      .mockResolvedValue([]); // no sub-candles

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    const result = await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
    });

    // pessimisticSlTpCount=1, subCandleResolvedCount not set (or 0)
    expect((result.metrics as any).pessimisticSlTpCount).toBe(1);
    // subCandleResolvedCount should not be attached (0 resolved, so skipped)
    expect((result.metrics as any).subCandleResolvedCount).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Test I: intraBarTimeframe override uses specified timeframe for sub-candle fetch
  // --------------------------------------------------------------------------
  it('I: intraBarTimeframe override passes custom timeframe to getCandles', async () => {
    const mainCandles: Candle[] = [
      makeCandle(0, 100, 105, 95, 100),
      makeCandle(14_400_000, 100, 120, 80, 100), // both triggered
    ];

    const subCandles: Candle[] = [
      makeCandle(14_400_000, 100, 112, 95, 111), // TP hit first
    ];

    mockGetCandles
      .mockResolvedValueOnce(mainCandles)
      .mockResolvedValueOnce(subCandles);

    const { loadStrategy } = await import('../../strategy/loader.js');
    vi.mocked(loadStrategy).mockResolvedValue(makeSlTpStrategy(90, 110) as any);

    await runAggregateBacktest(makeConfig(), {
      saveResults: false,
      skipFundingRateValidation: true,
      skipCandleValidation: true,
      enableLogging: false,
      intraBarTimeframe: '1m', // explicit override
    });

    // Second getCandles call should use '1m' as the timeframe
    expect(mockGetCandles).toHaveBeenCalledTimes(2);
    const subCandleCall = mockGetCandles.mock.calls[1];
    expect(subCandleCall[2]).toBe('1m'); // 3rd arg is timeframe
  });
});
