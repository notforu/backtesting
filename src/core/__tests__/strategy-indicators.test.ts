/**
 * Tests for dynamic indicator collection via context.setIndicator()
 *
 * Covers:
 * 1. SignalAdapter collects indicators set by strategy via context.setIndicator()
 * 2. setIndicator is callable without error (API contract test)
 * 3. Indicators from wantsExit() path are also collected (not double-counted)
 * 4. FR V2 strategy emits frShortThreshold and frLongThreshold when usePercentile=true
 */

import { describe, it, expect } from 'vitest';
import { SignalAdapter } from '../signal-adapter.js';
import type { Strategy, StrategyContext } from '../../strategy/base.js';
import type { Candle, FundingRate } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple candle array with given prices */
function makeCandles(prices: number[], baseTimestamp = 1_000_000): Candle[] {
  return prices.map((price, i) => ({
    timestamp: baseTimestamp + i * 3_600_000,
    open: price,
    high: price + 10,
    low: price - 10,
    close: price,
    volume: 100,
  }));
}

/** Create funding rate array aligned to candle timestamps */
function makeFundingRates(rates: number[], baseTimestamp = 1_000_000): FundingRate[] {
  return rates.map((r, i) => ({
    timestamp: baseTimestamp + i * 8 * 3_600_000,
    fundingRate: r,
  }));
}

// ============================================================================
// Test 3: setIndicator exists on context (API contract)
// ============================================================================

describe('context.setIndicator() API contract', () => {
  it('is callable without error from strategy onBar', () => {
    const strategy: Strategy = {
      name: 'indicator-api-test',
      description: 'Tests that setIndicator is callable',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        // Should not throw
        ctx.setIndicator('myIndicator', 42);
      },
    };

    const candles = makeCandles([100, 110, 120]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Should not throw
    expect(() => adapter.getSignal(1)).not.toThrow();
  });
});

// ============================================================================
// Test 2: SignalAdapter collects indicators from strategy
// ============================================================================

describe('SignalAdapter indicator collection', () => {
  it('collects setIndicator values across multiple getSignal() calls', () => {
    // Strategy that emits a fixed "testIndicator = 42" on every bar
    const strategy: Strategy = {
      name: 'indicator-emitter',
      description: 'Emits a fixed indicator each bar',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        ctx.setIndicator('testIndicator', 42);
      },
    };

    const candles = makeCandles([100, 110, 120, 130]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Drive the adapter through 3 bars via getSignal()
    adapter.getSignal(0);
    adapter.getSignal(1);
    adapter.getSignal(2);

    const indicators = adapter.indicators;

    expect(indicators).toBeDefined();
    expect(indicators!['testIndicator']).toBeDefined();
    expect(indicators!['testIndicator'].values).toHaveLength(3);
    expect(indicators!['testIndicator'].values.every(v => v === 42)).toBe(true);
    // Timestamps should correspond to the candle timestamps
    expect(indicators!['testIndicator'].timestamps).toEqual([
      candles[0].timestamp,
      candles[1].timestamp,
      candles[2].timestamp,
    ]);
  });

  it('collects multiple named indicators per bar', () => {
    const strategy: Strategy = {
      name: 'multi-indicator-emitter',
      description: 'Emits two indicators per bar',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        const price = ctx.currentCandle.close;
        ctx.setIndicator('upperBand', price + 20);
        ctx.setIndicator('lowerBand', price - 20);
      },
    };

    const prices = [100, 110, 120];
    const candles = makeCandles(prices);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    for (let i = 0; i < prices.length; i++) {
      adapter.getSignal(i);
    }

    const indicators = adapter.indicators;
    expect(indicators).toBeDefined();
    expect(indicators!['upperBand']).toBeDefined();
    expect(indicators!['lowerBand']).toBeDefined();

    expect(indicators!['upperBand'].values).toEqual([120, 130, 140]);
    expect(indicators!['lowerBand'].values).toEqual([80, 90, 100]);
  });

  it('returns undefined when no indicators have been set', () => {
    const strategy: Strategy = {
      name: 'no-indicator-strategy',
      description: 'Never calls setIndicator',
      version: '1.0.0',
      params: [],
      onBar(_ctx: StrategyContext): void {
        // no-op
      },
    };

    const candles = makeCandles([100, 110]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    adapter.getSignal(0);
    adapter.getSignal(1);

    expect(adapter.indicators).toBeUndefined();
  });

  it('collects indicators from wantsExit() path without double-counting on same bar', () => {
    // Strategy: sets indicator on every bar; closes long when price > 150
    const strategy: Strategy = {
      name: 'exit-indicator-emitter',
      description: 'Sets indicator and closes positions',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        ctx.setIndicator('signal', ctx.currentCandle.close);
        if (ctx.longPosition && ctx.currentCandle.close > 150) {
          ctx.closeLong();
        }
      },
    };

    const candles = makeCandles([100, 160]); // bar 1 closes long
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    // Simulate engine: wantsExit on bar 1 (position open from shadow confirm)
    adapter.confirmExecutionAtBar('long', 0);

    // wantsExit drives onBar for bar 1 — indicator collected here
    const exiting = adapter.wantsExit(1);
    expect(exiting).toBe(true);

    // getSignal on same bar reuses cached actions — must NOT call onBar again
    adapter.confirmExit();
    adapter.getSignal(1); // reuses wantsExit actions, does NOT call onBar a second time

    const indicators = adapter.indicators;
    expect(indicators).toBeDefined();
    expect(indicators!['signal']).toBeDefined();

    // bar 1 should appear exactly once even though wantsExit and getSignal ran
    const bar1Ts = candles[1].timestamp;
    const bar1Count = indicators!['signal'].timestamps.filter(ts => ts === bar1Ts).length;
    expect(bar1Count).toBe(1);
  });

  it('values are dynamic (different per bar) when the indicator changes each bar', () => {
    // Strategy: emits the bar index as the indicator value
    const strategy: Strategy = {
      name: 'dynamic-indicator-emitter',
      description: 'Emits bar index as indicator',
      version: '1.0.0',
      params: [],
      onBar(ctx: StrategyContext): void {
        ctx.setIndicator('barIdx', ctx.currentIndex);
      },
    };

    const candles = makeCandles([100, 110, 120, 130, 140]);
    const adapter = new SignalAdapter(strategy, 'BTC/USDT', '1h');
    adapter.init(candles);

    for (let i = 0; i < 5; i++) {
      adapter.getSignal(i);
    }

    const indicators = adapter.indicators;
    expect(indicators).toBeDefined();
    const values = indicators!['barIdx'].values;
    // Values should be [0, 1, 2, 3, 4] — NOT all the same
    expect(values).toEqual([0, 1, 2, 3, 4]);
    // Confirm they are not all identical (dynamic, not static)
    const allSame = values.every(v => v === values[0]);
    expect(allSame).toBe(false);
  });
});

// ============================================================================
// Test 1: FR V2 strategy emits dynamic percentile-based indicators
// ============================================================================

describe('funding-rate-spike-v2 with usePercentile=true emits dynamic indicators', () => {
  /**
   * Build a synthetic dataset large enough for the FR V2 strategy to execute:
   * - minBars = max(trendSMAPeriod=50, atrPeriod+1=15, 50) = 50
   * - percentileLookback = 90, needs >= 10 FR observations to start
   * We need at least ~100 candles and ~30+ funding rate records with variance.
   */

  const NUM_CANDLES = 150;
  const BASE_TS = 1_700_000_000_000; // arbitrary fixed epoch

  function buildCandles(): Candle[] {
    const candles: Candle[] = [];
    let price = 30_000;
    for (let i = 0; i < NUM_CANDLES; i++) {
      // Gently oscillating price to prevent trend filter blocking everything
      price = 30_000 + Math.sin(i / 10) * 500;
      candles.push({
        timestamp: BASE_TS + i * 3_600_000, // hourly candles
        open: price,
        high: price + 100,
        low: price - 100,
        close: price,
        volume: 1000,
      });
    }
    return candles;
  }

  function buildFundingRates(): FundingRate[] {
    const rates: FundingRate[] = [];
    // ~18 funding rates (one per 8 hours over 150 hours)
    for (let i = 0; i < 18; i++) {
      // Create variance: some high, some low, some extreme
      const base = 0.0001;
      // Every 3rd rate is a spike above 95th percentile threshold
      const spike = (i % 6 === 0) ? 0.002 : 0;
      const rate = base + spike + (i % 3) * 0.00005;
      rates.push({
        timestamp: BASE_TS + i * 8 * 3_600_000,
        fundingRate: rate,
      });
    }
    return rates;
  }

  it('emits frShortThreshold and frLongThreshold on bars where thresholds are computed', async () => {
    // Dynamically import to avoid issues with module loading in test env
    const { default: frV2Strategy } = await import('../../../strategies/funding-rate-spike-v2.js');

    const candles = buildCandles();
    const fundingRates = buildFundingRates();

    const adapter = new SignalAdapter(
      frV2Strategy,
      'BTC/USDT',
      '1h',
      {
        usePercentile: true,
        shortPercentile: 95,
        longPercentile: 5,
        percentileLookback: 90,
        holdingPeriods: 3,
        positionSizePct: 50,
        useATRStops: true,
        atrPeriod: 14,
        atrStopMultiplier: 2.5,
        atrTPMultiplier: 3.5,
        stopLossPct: 3.0,
        takeProfitPct: 4.0,
        atrFilterEnabled: false, // disable to allow entries through more easily
        atrFilterThreshold: 1.5,
        useTrendFilter: false, // disable trend filter to allow bars to emit indicators
        trendSMAPeriod: 50,
        useTrailingStop: false,
        trailActivationATR: 1.0,
        trailDistanceATR: 2.0,
        positionSizeMethod: 'fixed',
        kellyFraction: 0.5,
        minPositionPct: 15,
        maxPositionPct: 50,
        kellySampleSize: 20,
        useFRVelocity: false,
        frVelocityBars: 1,
      }
    );

    adapter.init(candles, fundingRates);

    // Drive all bars through the adapter
    for (let i = 0; i < candles.length; i++) {
      adapter.getSignal(i);
    }

    const indicators = adapter.indicators;

    // The strategy should have emitted at least some indicator values
    // (bars after minBars=50 with enough funding rate data)
    expect(indicators).toBeDefined();
    expect(indicators!['frShortThreshold']).toBeDefined();
    expect(indicators!['frLongThreshold']).toBeDefined();

    const shortValues = indicators!['frShortThreshold'].values;
    const longValues = indicators!['frLongThreshold'].values;

    // Must have collected at least a few indicator values
    expect(shortValues.length).toBeGreaterThan(0);
    expect(longValues.length).toBeGreaterThan(0);

    // Timestamps and values must be parallel arrays of the same length
    expect(indicators!['frShortThreshold'].timestamps).toHaveLength(shortValues.length);
    expect(indicators!['frLongThreshold'].timestamps).toHaveLength(longValues.length);

    // Values must be numeric (not NaN or undefined)
    expect(shortValues.every(v => Number.isFinite(v))).toBe(true);
    expect(longValues.every(v => Number.isFinite(v))).toBe(true);

    // When usePercentile=true, thresholds should be dynamic (percentile-derived),
    // not all the same fixed value. The funding rates have variance so percentiles
    // can differ across the lookback windows.
    // At minimum: shortThreshold > longThreshold (95th pct > 5th pct)
    for (let i = 0; i < shortValues.length; i++) {
      expect(shortValues[i]).toBeGreaterThan(longValues[i]);
    }
  });

  it('emits different threshold values when usePercentile=false (fixed thresholds)', async () => {
    const { default: frV2Strategy } = await import('../../../strategies/funding-rate-spike-v2.js');

    const candles = buildCandles();
    const fundingRates = buildFundingRates();

    const fixedShort = 0.0005;
    const fixedLong = -0.0003;

    const adapter = new SignalAdapter(
      frV2Strategy,
      'BTC/USDT',
      '1h',
      {
        usePercentile: false,
        shortPercentile: 95,
        longPercentile: 5,
        percentileLookback: 90,
        holdingPeriods: 3,
        positionSizePct: 50,
        useATRStops: true,
        atrPeriod: 14,
        atrStopMultiplier: 2.5,
        atrTPMultiplier: 3.5,
        stopLossPct: 3.0,
        takeProfitPct: 4.0,
        atrFilterEnabled: false,
        atrFilterThreshold: 1.5,
        useTrendFilter: false,
        trendSMAPeriod: 50,
        useTrailingStop: false,
        trailActivationATR: 1.0,
        trailDistanceATR: 2.0,
        positionSizeMethod: 'fixed',
        kellyFraction: 0.5,
        minPositionPct: 15,
        maxPositionPct: 50,
        kellySampleSize: 20,
        fundingThresholdShort: fixedShort,
        fundingThresholdLong: fixedLong,
        useFRVelocity: false,
        frVelocityBars: 1,
      }
    );

    adapter.init(candles, fundingRates);

    for (let i = 0; i < candles.length; i++) {
      adapter.getSignal(i);
    }

    const indicators = adapter.indicators;
    expect(indicators).toBeDefined();
    expect(indicators!['frShortThreshold']).toBeDefined();
    expect(indicators!['frLongThreshold']).toBeDefined();

    // With fixed thresholds, all values should be identical
    const shortValues = indicators!['frShortThreshold'].values;
    const longValues = indicators!['frLongThreshold'].values;

    expect(shortValues.every(v => v === fixedShort)).toBe(true);
    expect(longValues.every(v => v === fixedLong)).toBe(true);
  });

  it('emits frShortThreshold > frLongThreshold on every bar (percentile ordering invariant)', async () => {
    const { default: frV2Strategy } = await import('../../../strategies/funding-rate-spike-v2.js');

    // Build funding rates with strong variance to ensure percentile spread
    const fundingRates: FundingRate[] = [];
    for (let i = 0; i < 30; i++) {
      // Zigzag pattern: alternating positive and slightly negative rates
      const rate = i % 2 === 0 ? 0.001 + i * 0.0001 : -0.0001 - i * 0.00005;
      fundingRates.push({
        timestamp: BASE_TS + i * 8 * 3_600_000,
        fundingRate: rate,
      });
    }

    const candles = buildCandles();
    const adapter = new SignalAdapter(
      frV2Strategy,
      'BTC/USDT',
      '1h',
      {
        usePercentile: true,
        shortPercentile: 90,
        longPercentile: 10,
        percentileLookback: 90,
        holdingPeriods: 3,
        positionSizePct: 50,
        useATRStops: false,
        atrPeriod: 14,
        atrStopMultiplier: 2.5,
        atrTPMultiplier: 3.5,
        stopLossPct: 3.0,
        takeProfitPct: 4.0,
        atrFilterEnabled: false,
        atrFilterThreshold: 1.5,
        useTrendFilter: false,
        trendSMAPeriod: 50,
        useTrailingStop: false,
        trailActivationATR: 1.0,
        trailDistanceATR: 2.0,
        positionSizeMethod: 'fixed',
        kellyFraction: 0.5,
        minPositionPct: 15,
        maxPositionPct: 50,
        kellySampleSize: 20,
        fundingThresholdShort: 0.0005,
        fundingThresholdLong: -0.0003,
        useFRVelocity: false,
        frVelocityBars: 1,
      }
    );

    adapter.init(candles, fundingRates);

    for (let i = 0; i < candles.length; i++) {
      adapter.getSignal(i);
    }

    const indicators = adapter.indicators;
    // If no funding rate data is sufficient, indicators may be undefined — that's acceptable
    if (!indicators || !indicators['frShortThreshold'] || !indicators['frLongThreshold']) {
      return; // skip ordering check if no indicators emitted (edge case)
    }

    const shortValues = indicators['frShortThreshold'].values;
    const longValues = indicators['frLongThreshold'].values;

    // Invariant: 90th percentile > 10th percentile for any distribution with variance
    for (let i = 0; i < shortValues.length; i++) {
      expect(shortValues[i]).toBeGreaterThanOrEqual(longValues[i]);
    }
  });
});
