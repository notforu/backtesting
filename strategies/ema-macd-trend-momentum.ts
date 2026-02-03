import { EMA, MACD, ADX, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

interface IndicatorState {
  fastEmaStream: InstanceType<typeof EMA>;
  slowEmaStream: InstanceType<typeof EMA>;
  macdStream: InstanceType<typeof MACD>;
  adxStream: InstanceType<typeof ADX>;
  atrStream: InstanceType<typeof ATR>;

  // Cached values for crossover detection (need current + previous)
  fastEmaValues: number[];
  slowEmaValues: number[];
  macdHistValues: number[];
  adxValues: number[];
  atrValues: number[];

  processedBars: number;
}

const emaMacdTrendMomentum: Strategy = {
  name: 'ema-macd-trend-momentum',
  description: 'Trend-following strategy using EMA crossover with MACD momentum confirmation and ADX trend strength filter. Uses ATR trailing stop for dynamic exits.',
  version: '1.0.0',

  params: [
    {
      name: 'fastEmaPeriod',
      label: 'Fast EMA Period',
      type: 'number',
      default: 11,
      min: 5,
      max: 15,
      step: 2,
      description: 'Fast EMA period for crossover signal',
    },
    {
      name: 'slowEmaPeriod',
      label: 'Slow EMA Period',
      type: 'number',
      default: 20,
      min: 15,
      max: 35,
      step: 5,
      description: 'Slow EMA period for crossover signal',
    },
    {
      name: 'macdFastPeriod',
      label: 'MACD Fast Period',
      type: 'number',
      default: 12,
      min: 8,
      max: 16,
      step: 4,
      description: 'MACD fast EMA period',
    },
    {
      name: 'macdSlowPeriod',
      label: 'MACD Slow Period',
      type: 'number',
      default: 20,
      min: 20,
      max: 30,
      step: 5,
      description: 'MACD slow EMA period',
    },
    {
      name: 'macdSignalPeriod',
      label: 'MACD Signal Period',
      type: 'number',
      default: 9,
      min: 5,
      max: 12,
      step: 1,
      description: 'MACD signal line period',
    },
    {
      name: 'adxPeriod',
      label: 'ADX Period',
      type: 'number',
      default: 10,
      min: 10,
      max: 20,
      step: 5,
      description: 'ADX calculation period for trend strength',
    },
    {
      name: 'adxThreshold',
      label: 'ADX Threshold',
      type: 'number',
      default: 30,
      min: 15,
      max: 30,
      step: 5,
      description: 'Minimum ADX value for trend strength confirmation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 15,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for trailing stop calculation',
    },
    {
      name: 'trailMultiplier',
      label: 'Trail Multiplier',
      type: 'number',
      default: 3.0,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for trailing stop distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 60,
      min: 30,
      max: 90,
      step: 15,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish crossovers',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const fastEmaPeriod = params.fastEmaPeriod as number;
    const slowEmaPeriod = params.slowEmaPeriod as number;
    const macdFastPeriod = params.macdFastPeriod as number;
    const macdSlowPeriod = params.macdSlowPeriod as number;
    const macdSignalPeriod = params.macdSignalPeriod as number;
    const adxPeriod = params.adxPeriod as number;
    const atrPeriod = params.atrPeriod as number;

    // Validate parameter constraints
    if (fastEmaPeriod >= slowEmaPeriod) {
      throw new Error(
        `Fast EMA period (${fastEmaPeriod}) must be less than Slow EMA period (${slowEmaPeriod})`
      );
    }

    // Initialize streaming indicator instances
    const state: IndicatorState = {
      fastEmaStream: new EMA({ period: fastEmaPeriod, values: [] }),
      slowEmaStream: new EMA({ period: slowEmaPeriod, values: [] }),
      macdStream: new MACD({
        fastPeriod: macdFastPeriod,
        slowPeriod: macdSlowPeriod,
        signalPeriod: macdSignalPeriod,
        SimpleMAOscillator: false, // Use EMA
        SimpleMASignal: false, // Use EMA for signal
        values: [],
      }),
      adxStream: new ADX({ period: adxPeriod, high: [], low: [], close: [] }),
      atrStream: new ATR({ period: atrPeriod, high: [], low: [], close: [] }),

      fastEmaValues: [],
      slowEmaValues: [],
      macdHistValues: [],
      adxValues: [],
      atrValues: [],

      processedBars: 0,
    };

    (this as any)._state = state;

    // Position tracking state
    (this as any)._entryBar = 0;
    (this as any)._trailingStop = 0;
    (this as any)._isLong = false;

    context.log(
      `Initialized EMA-MACD Trend Momentum (streaming): FastEMA(${fastEmaPeriod}), SlowEMA(${slowEmaPeriod}), MACD(${macdFastPeriod}/${macdSlowPeriod}/${macdSignalPeriod}), ADX(${adxPeriod})>=${params.adxThreshold}, Trail=${params.trailMultiplier}x ATR`
    );
  },

  onBar(context: StrategyContext): void {
    const {
      currentIndex,
      currentCandle,
      params,
      longPosition,
      shortPosition,
      balance,
    } = context;

    const state = (this as any)._state as IndicatorState;
    if (!state) return;

    // Extract parameters
    const adxThreshold = params.adxThreshold as number;
    const trailMultiplier = params.trailMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;

    const currentPrice = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;

    // --- Feed current candle to all streaming indicators (O(1) per indicator) ---

    // Fast EMA
    const fastEma = state.fastEmaStream.nextValue(currentPrice);
    if (fastEma !== undefined) {
      state.fastEmaValues.push(fastEma);
    }

    // Slow EMA
    const slowEma = state.slowEmaStream.nextValue(currentPrice);
    if (slowEma !== undefined) {
      state.slowEmaValues.push(slowEma);
    }

    // MACD
    const macdVal = state.macdStream.nextValue(currentPrice);
    if (macdVal && macdVal.histogram !== undefined) {
      state.macdHistValues.push(macdVal.histogram);
    }

    // ADX
    const adxVal = state.adxStream.nextValue({ high, low, close: currentPrice });
    if (adxVal && adxVal.adx !== undefined) {
      state.adxValues.push(adxVal.adx);
    }

    // ATR
    const atrVal = state.atrStream.nextValue({ high, low, close: currentPrice });
    if (atrVal !== undefined) {
      state.atrValues.push(atrVal);
    }

    state.processedBars++;

    // --- Check we have enough data for crossover detection (need current + previous) ---
    if (
      state.fastEmaValues.length < 2 ||
      state.slowEmaValues.length < 2 ||
      state.macdHistValues.length < 2 ||
      state.adxValues.length < 1 ||
      state.atrValues.length < 1
    ) {
      return;
    }

    // --- Read current and previous indicator values ---
    const currentFastEma = state.fastEmaValues[state.fastEmaValues.length - 1];
    const prevFastEma = state.fastEmaValues[state.fastEmaValues.length - 2];
    const currentSlowEma = state.slowEmaValues[state.slowEmaValues.length - 1];
    const prevSlowEma = state.slowEmaValues[state.slowEmaValues.length - 2];
    const currentMacdHist = state.macdHistValues[state.macdHistValues.length - 1];
    const prevMacdHist = state.macdHistValues[state.macdHistValues.length - 2];
    const currentAdx = state.adxValues[state.adxValues.length - 1];
    const currentAtr = state.atrValues[state.atrValues.length - 1];

    // Detect crossovers
    const bullishCrossover = prevFastEma <= prevSlowEma && currentFastEma > currentSlowEma;
    const bearishCrossover = prevFastEma >= prevSlowEma && currentFastEma < currentSlowEma;

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves UP for longs)
      const newTrailLevel = currentPrice - currentAtr * trailMultiplier;
      if (newTrailLevel > (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop (highest priority)
      if (currentPrice <= (this as any)._trailingStop) {
        context.log(`TRAILING STOP: Price ${currentPrice.toFixed(2)} <= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeLong();
        return;
      }

      // 2. EMA Re-Cross (bearish crossover while long)
      if (bearishCrossover) {
        context.log(`EMA RE-CROSS EXIT: Fast EMA crossed below Slow EMA`);
        context.closeLong();
        return;
      }

      // 3. MACD Momentum Exit (histogram turns negative)
      if (currentMacdHist < 0 && prevMacdHist >= 0) {
        context.log(`MACD MOMENTUM EXIT: Histogram crossed below zero (${currentMacdHist.toFixed(2)})`);
        context.closeLong();
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        return;
      }
    }

    if (shortPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves DOWN for shorts)
      const newTrailLevel = currentPrice + currentAtr * trailMultiplier;
      if (newTrailLevel < (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop
      if (currentPrice >= (this as any)._trailingStop) {
        context.log(`TRAILING STOP (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeShort();
        return;
      }

      // 2. EMA Re-Cross
      if (bullishCrossover) {
        context.log(`EMA RE-CROSS EXIT (SHORT): Fast EMA crossed above Slow EMA`);
        context.closeShort();
        return;
      }

      // 3. MACD Momentum Exit (histogram turns positive)
      if (currentMacdHist > 0 && prevMacdHist <= 0) {
        context.log(`MACD MOMENTUM EXIT (SHORT): Histogram crossed above zero`);
        context.closeShort();
        return;
      }

      // 4. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition) {
      // Check ADX trend strength
      const hasTrendStrength = currentAdx >= adxThreshold;

      // LONG ENTRY: Bullish EMA crossover + positive MACD histogram + ADX strength
      if (bullishCrossover && currentMacdHist > 0 && hasTrendStrength) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: EMA bullish crossover, MACD hist=${currentMacdHist.toFixed(2)} > 0, ADX=${currentAdx.toFixed(1)} >= ${adxThreshold}`
          );
          (this as any)._entryBar = currentIndex;
          (this as any)._trailingStop = currentPrice - currentAtr * trailMultiplier;
          (this as any)._isLong = true;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY: Bearish EMA crossover + negative MACD histogram + ADX strength
      if (enableShorts && bearishCrossover && currentMacdHist < 0 && hasTrendStrength) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: EMA bearish crossover, MACD hist=${currentMacdHist.toFixed(2)} < 0, ADX=${currentAdx.toFixed(1)} >= ${adxThreshold}`
          );
          (this as any)._entryBar = currentIndex;
          (this as any)._trailingStop = currentPrice + currentAtr * trailMultiplier;
          (this as any)._isLong = false;
          context.openShort(amount);
        }
      }
    }
  },

  onEnd(context: StrategyContext): void {
    if (context.longPosition) {
      context.log('Closing remaining long position at end of backtest');
      context.closeLong();
    }
    if (context.shortPosition) {
      context.log('Closing remaining short position at end of backtest');
      context.closeShort();
    }
  },
};

export default emaMacdTrendMomentum;
