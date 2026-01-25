/**
 * GPT LONG ULTIMATE Strategy
 *
 * A sophisticated trend-following strategy combining multiple technical indicators:
 * - Williams Fractals for trend structure
 * - SMA/EMA filters for trend direction
 * - BB% RSI for momentum confirmation
 * - KVO (Klinger Volume Oscillator) for volume confirmation
 * - Fractal-based dynamic stops
 *
 * Entry Methods:
 * 1. Fractal Breakout Long: Price breaks above fractal high with confirmations
 * 2. CHoCH Long: Change of Character - trend reversal from down to up
 *
 * Exit Methods:
 * - Dynamic stops based on 3rd recent fractal down
 * - CHoCH exits using opposite fractal levels
 *
 * Parameters:
 * - positionSizePercent: % of equity per trade (default: 10)
 * - breakoutOffsetPercent: % offset for breakout/stop levels (default: 0.1)
 * - smaLength: SMA period (default: 60)
 * - emaLength: EMA period (default: 120)
 * - rsiLength: RSI period (default: 14)
 * - rsiBBLength: BB period applied to RSI (default: 20)
 * - kvoFast: KVO fast period (default: 34)
 * - kvoSlow: KVO slow period (default: 55)
 * - kvoSignal: KVO signal line period (default: 13)
 * - fractalTrendCount: Consecutive fractals for trend (default: 3)
 * - lookbackStart: Start of lookback range (default: 90)
 * - lookbackEnd: End of lookback range (default: 120)
 * - ma20Length: MA period for lookback fractal check (default: 20)
 * - enableShorts: Whether to enable short positions (default: true)
 */

import { SMA, EMA, RSI } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) {
    return new Array(closes.length).fill(undefined);
  }

  const result = SMA.calculate({
    values: closes,
    period: period,
  });

  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate Exponential Moving Average
 */
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) {
    return new Array(closes.length).fill(undefined);
  }

  const result = EMA.calculate({
    values: closes,
    period: period,
  });

  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate RSI
 */
function calculateRSI(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period + 1) {
    return new Array(closes.length).fill(undefined);
  }

  const result = RSI.calculate({
    values: closes,
    period: period,
  });

  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate Standard Deviation
 */
function calculateStdDev(values: number[], period: number): (number | undefined)[] {
  if (values.length < period) {
    return new Array(values.length).fill(undefined);
  }

  const result: (number | undefined)[] = new Array(period - 1).fill(undefined);

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    result.push(Math.sqrt(variance));
  }

  return result;
}

/**
 * Calculate BB% RSI
 * Returns the position of RSI within its Bollinger Bands
 */
function calculateBBPercentRSI(
  closes: number[],
  rsiLength: number,
  bbLength: number
): (number | undefined)[] {
  const rsiValues = calculateRSI(closes, rsiLength);
  const validRSI = rsiValues.filter((v) => v !== undefined) as number[];

  if (validRSI.length < bbLength) {
    return new Array(closes.length).fill(undefined);
  }

  const basis = calculateSMA(validRSI, bbLength);
  const dev = calculateStdDev(validRSI, bbLength);

  const bbPercent: (number | undefined)[] = [];
  const offset = rsiValues.length - validRSI.length;

  for (let i = 0; i < offset; i++) {
    bbPercent.push(undefined);
  }

  for (let i = 0; i < validRSI.length; i++) {
    const b = basis[i];
    const d = dev[i];

    if (b === undefined || d === undefined) {
      bbPercent.push(undefined);
      continue;
    }

    const upper = b + d;
    const lower = b - d;
    const range = upper - lower;

    if (range === 0) {
      bbPercent.push(0.5);
    } else {
      bbPercent.push((validRSI[i] - lower) / range);
    }
  }

  return bbPercent;
}

/**
 * Calculate KVO (Klinger Volume Oscillator)
 */
function calculateKVO(
  candles: Array<{ close: number; volume: number }>,
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): {
  kvo: (number | undefined)[];
  signal: (number | undefined)[];
} {
  if (candles.length < Math.max(fastPeriod, slowPeriod)) {
    return {
      kvo: new Array(candles.length).fill(undefined),
      signal: new Array(candles.length).fill(undefined),
    };
  }

  // Calculate directional movement and volume force
  const volumeForce: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      volumeForce.push(0);
      continue;
    }

    const dm =
      candles[i].close > candles[i - 1].close
        ? 1
        : candles[i].close < candles[i - 1].close
          ? -1
          : 0;
    volumeForce.push(dm * candles[i].volume);
  }

  // Calculate fast and slow EMAs of volume force
  const fastEMA = calculateEMA(volumeForce, fastPeriod);
  const slowEMA = calculateEMA(volumeForce, slowPeriod);

  // KVO = fast EMA - slow EMA
  const kvo: (number | undefined)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (fastEMA[i] === undefined || slowEMA[i] === undefined) {
      kvo.push(undefined);
    } else {
      kvo.push(fastEMA[i]! - slowEMA[i]!);
    }
  }

  // Signal line = EMA of KVO
  const validKVO = kvo.filter((v) => v !== undefined) as number[];
  const signalLine = calculateEMA(validKVO, signalPeriod);

  // Align signal line with kvo array
  const signal: (number | undefined)[] = [];
  const offset = kvo.length - validKVO.length;
  for (let i = 0; i < offset; i++) {
    signal.push(undefined);
  }
  for (let i = 0; i < signalLine.length; i++) {
    signal.push(signalLine[i]);
  }

  return { kvo, signal };
}

/**
 * Detect Williams Fractals
 */
function detectFractals(candles: Array<{ high: number; low: number }>, index: number): {
  fractalUp: boolean;
  fractalDown: boolean;
  fractalUpPrice?: number;
  fractalDownPrice?: number;
} {
  // Need at least 5 candles (2 before, current, 2 after)
  if (index < 2 || index >= candles.length - 2) {
    return { fractalUp: false, fractalDown: false };
  }

  const high = candles[index].high;
  const low = candles[index].low;

  // Fractal Up: high[2] is higher than 2 before and 2 after
  const fractalUp =
    high > candles[index - 1].high &&
    high > candles[index - 2].high &&
    high > candles[index + 1].high &&
    high > candles[index + 2].high;

  // Fractal Down: low[2] is lower than 2 before and 2 after
  const fractalDown =
    low < candles[index - 1].low &&
    low < candles[index - 2].low &&
    low < candles[index + 1].low &&
    low < candles[index + 2].low;

  return {
    fractalUp,
    fractalDown,
    fractalUpPrice: fractalUp ? high : undefined,
    fractalDownPrice: fractalDown ? low : undefined,
  };
}

// ============================================================================
// Strategy State
// ============================================================================

interface StrategyState {
  // Fractal tracking
  lastFractalUp: number | null;
  lastFractalDown: number | null;
  upCount: number;
  downCount: number;
  trend: 'up' | 'down' | 'none';
  recentFractalUps: number[];
  recentFractalDowns: number[];

  // Entry tracking
  waitingForFractal: boolean;
  waitingForFractalShort: boolean;
  breakoutLevel: number | null;
  breakdownLevel: number | null;

  // CHoCH tracking
  chochHigh: number | null;
  chochLow: number | null;
}

const strategyState = new WeakMap<StrategyContext, StrategyState>();

function getState(context: StrategyContext): StrategyState {
  if (!strategyState.has(context)) {
    strategyState.set(context, {
      lastFractalUp: null,
      lastFractalDown: null,
      upCount: 0,
      downCount: 0,
      trend: 'none',
      recentFractalUps: [],
      recentFractalDowns: [],
      waitingForFractal: false,
      waitingForFractalShort: false,
      breakoutLevel: null,
      breakdownLevel: null,
      chochHigh: null,
      chochLow: null,
    });
  }
  return strategyState.get(context)!;
}

// ============================================================================
// Strategy Implementation
// ============================================================================

const gptLongUltimate: Strategy = {
  name: 'gpt-long-ultimate',
  description:
    'Advanced trend-following strategy using Williams Fractals, MA filters, BB% RSI, KVO, and fractal-based stops. Supports both long and short positions with CHoCH detection.',
  version: '1.0.0',

  params: [
    {
      name: 'positionSizePercent',
      label: 'Position Size %',
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      step: 1,
      description: 'Percentage of equity per trade',
    },
    {
      name: 'breakoutOffsetPercent',
      label: 'Breakout Offset %',
      type: 'number',
      default: 0.1,
      min: 0,
      max: 5,
      step: 0.1,
      description: 'Percentage offset for breakout and stop levels',
    },
    {
      name: 'smaLength',
      label: 'SMA Length',
      type: 'number',
      default: 60,
      min: 10,
      max: 200,
      step: 5,
      description: 'Period for Simple Moving Average',
    },
    {
      name: 'emaLength',
      label: 'EMA Length',
      type: 'number',
      default: 120,
      min: 20,
      max: 300,
      step: 10,
      description: 'Period for Exponential Moving Average',
    },
    {
      name: 'rsiLength',
      label: 'RSI Length',
      type: 'number',
      default: 14,
      min: 5,
      max: 50,
      step: 1,
      description: 'Period for RSI calculation',
    },
    {
      name: 'rsiBBLength',
      label: 'RSI BB Length',
      type: 'number',
      default: 20,
      min: 5,
      max: 50,
      step: 1,
      description: 'Bollinger Bands period applied to RSI',
    },
    {
      name: 'kvoFast',
      label: 'KVO Fast Period',
      type: 'number',
      default: 34,
      min: 10,
      max: 100,
      step: 1,
      description: 'Fast period for Klinger Volume Oscillator',
    },
    {
      name: 'kvoSlow',
      label: 'KVO Slow Period',
      type: 'number',
      default: 55,
      min: 20,
      max: 150,
      step: 1,
      description: 'Slow period for Klinger Volume Oscillator',
    },
    {
      name: 'kvoSignal',
      label: 'KVO Signal Period',
      type: 'number',
      default: 13,
      min: 5,
      max: 50,
      step: 1,
      description: 'Signal line period for KVO',
    },
    {
      name: 'fractalTrendCount',
      label: 'Fractal Trend Count',
      type: 'number',
      default: 3,
      min: 2,
      max: 10,
      step: 1,
      description: 'Consecutive fractals required to confirm trend',
    },
    {
      name: 'lookbackStart',
      label: 'Lookback Start',
      type: 'number',
      default: 90,
      min: 10,
      max: 200,
      step: 10,
      description: 'Start of lookback range for confirmations',
    },
    {
      name: 'lookbackEnd',
      label: 'Lookback End',
      type: 'number',
      default: 120,
      min: 20,
      max: 300,
      step: 10,
      description: 'End of lookback range for confirmations',
    },
    {
      name: 'ma20Length',
      label: 'MA20 Length',
      type: 'number',
      default: 20,
      min: 10,
      max: 50,
      step: 1,
      description: 'MA period for lookback fractal validation',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short position entries',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    context.log(
      `Initialized GPT LONG ULTIMATE with SMA=${params.smaLength}, EMA=${params.emaLength}, ` +
        `RSI=${params.rsiLength}, KVO=${params.kvoFast}/${params.kvoSlow}/${params.kvoSignal}, ` +
        `fractalTrend=${params.fractalTrendCount}, shorts=${params.enableShorts}`
    );

    // Initialize state
    getState(context);
  },

  onBar(context: StrategyContext): void {
    const {
      candles,
      currentIndex,
      params,
      longPosition,
      shortPosition,
      equity,
      currentCandle,
    } = context;

    // Extract parameters
    const positionSizePercent = params.positionSizePercent as number;
    const offsetPercent = params.breakoutOffsetPercent as number;
    const smaLength = params.smaLength as number;
    const emaLength = params.emaLength as number;
    const rsiLength = params.rsiLength as number;
    const rsiBBLength = params.rsiBBLength as number;
    const kvoFast = params.kvoFast as number;
    const kvoSlow = params.kvoSlow as number;
    const kvoSignal = params.kvoSignal as number;
    const fractalTrendCount = params.fractalTrendCount as number;
    const lookbackStart = params.lookbackStart as number;
    const lookbackEnd = params.lookbackEnd as number;
    const ma20Length = params.ma20Length as number;
    const enableShorts = params.enableShorts as boolean;

    const state = getState(context);

    // Need enough candles for indicators
    const maxPeriod = Math.max(emaLength, lookbackEnd);
    if (currentIndex < maxPeriod + 5) {
      return;
    }

    // Get historical data up to current candle (use candleView for efficiency)
    const closes = context.candleView.closes();
    const highs = context.candleView.highs();
    const lows = context.candleView.lows();
    const historicalCandles = context.candleView.slice();

    // ========================================================================
    // Calculate Indicators
    // ========================================================================

    // MA filters
    const ma60 = calculateSMA(closes, smaLength);
    const ema120 = calculateEMA(closes, emaLength);

    const currentMA60 = ma60[ma60.length - 1];
    const prevMA60 = ma60[ma60.length - 2];
    const currentEMA120 = ema120[ema120.length - 1];
    const prevEMA120 = ema120[ema120.length - 2];

    if (
      currentMA60 === undefined ||
      prevMA60 === undefined ||
      currentEMA120 === undefined ||
      prevEMA120 === undefined
    ) {
      return;
    }

    // MA Trend filters
    const isMAtrendDown =
      currentMA60 < currentEMA120 && currentMA60 < prevMA60 && currentEMA120 < prevEMA120;
    const isMAtrendUp =
      currentMA60 > currentEMA120 && currentMA60 > prevMA60 && currentEMA120 > prevEMA120;

    // BB% RSI
    const bbPercent = calculateBBPercentRSI(closes, rsiLength, rsiBBLength);
    const currentBBPercent = bbPercent[bbPercent.length - 1];

    // KVO
    const kvoData = calculateKVO(historicalCandles, kvoFast, kvoSlow, kvoSignal);
    const currentKVO = kvoData.kvo[kvoData.kvo.length - 1];
    const currentKVOSignal = kvoData.signal[kvoData.signal.length - 1];

    const kvoConfirm =
      currentKVO !== undefined && currentKVOSignal !== undefined && currentKVO > currentKVOSignal;
    const kvoBearish =
      currentKVO !== undefined && currentKVOSignal !== undefined && currentKVO < currentKVOSignal;

    // ========================================================================
    // Fractal Detection (check at index - 2 for confirmed fractals)
    // ========================================================================

    if (currentIndex >= 4) {
      const fractalCheckIndex = currentIndex - 2;
      const fractal = detectFractals(historicalCandles, fractalCheckIndex);

      if (fractal.fractalUp && fractal.fractalUpPrice !== undefined) {
        state.lastFractalUp = fractal.fractalUpPrice;
        state.upCount += 1;
        state.downCount = 0;

        // Track recent fractals
        state.recentFractalUps.unshift(fractal.fractalUpPrice);
        if (state.recentFractalUps.length > 5) {
          state.recentFractalUps.pop();
        }

        if (state.upCount >= fractalTrendCount) {
          state.trend = 'up';
        }

        context.log(`Fractal Up detected at ${fractal.fractalUpPrice.toFixed(2)}`);
      }

      if (fractal.fractalDown && fractal.fractalDownPrice !== undefined) {
        state.lastFractalDown = fractal.fractalDownPrice;
        state.downCount += 1;
        state.upCount = 0;

        // Track recent fractals
        state.recentFractalDowns.unshift(fractal.fractalDownPrice);
        if (state.recentFractalDowns.length > 5) {
          state.recentFractalDowns.pop();
        }

        if (state.downCount >= fractalTrendCount) {
          state.trend = 'down';
        }

        context.log(`Fractal Down detected at ${fractal.fractalDownPrice.toFixed(2)}`);
      }
    }

    // ========================================================================
    // Lookback Conditions
    // ========================================================================

    // MA20 for lookback
    const ma20 = calculateSMA(closes, ma20Length);

    let hasFractalAboveMA20 = false;
    let hasFractalBelowMA20 = false;
    let bbBuySignal = false;
    let bbSellSignal = false;

    for (let i = lookbackStart; i <= Math.min(lookbackEnd, currentIndex); i++) {
      const lookbackIndex = currentIndex - i;
      if (lookbackIndex < 0) break;

      // Check for semi-fractals (2-bar pattern) above/below MA20
      if (lookbackIndex >= 1 && lookbackIndex < historicalCandles.length - 1) {
        const high1 = historicalCandles[lookbackIndex + 1].high;
        const high0 = historicalCandles[lookbackIndex].high;
        const high2 = historicalCandles[lookbackIndex - 1]?.high;

        if (high2 !== undefined && high1 > high0 && high1 > high2) {
          const ma20AtIndex = ma20[lookbackIndex + 1];
          if (ma20AtIndex !== undefined && high1 > ma20AtIndex) {
            hasFractalAboveMA20 = true;
          }
        }

        const low1 = historicalCandles[lookbackIndex + 1].low;
        const low0 = historicalCandles[lookbackIndex].low;
        const low2 = historicalCandles[lookbackIndex - 1]?.low;

        if (low2 !== undefined && low1 < low0 && low1 < low2) {
          const ma20AtIndex = ma20[lookbackIndex + 1];
          if (ma20AtIndex !== undefined && low1 < ma20AtIndex) {
            hasFractalBelowMA20 = true;
          }
        }
      }

      // Check BB% RSI
      const bbAtIndex = bbPercent[lookbackIndex];
      if (bbAtIndex !== undefined) {
        if (bbAtIndex > 0.5) {
          bbBuySignal = true;
        }
        if (bbAtIndex < 0.5) {
          bbSellSignal = true;
        }
      }
    }

    // ========================================================================
    // Position Sizing
    // ========================================================================

    const positionValue = (equity * positionSizePercent) / 100;
    const amount = positionValue / currentCandle.close;

    // ========================================================================
    // LONG ENTRY LOGIC
    // ========================================================================

    // 1. Fractal Breakout Long Setup
    if (
      currentCandle.close > currentMA60 &&
      state.trend === 'up' &&
      !isMAtrendDown &&
      !longPosition &&
      !shortPosition
    ) {
      state.waitingForFractal = true;
    }

    // Set breakout level when fractal up forms above MA60
    if (
      state.waitingForFractal &&
      state.lastFractalUp !== null &&
      state.lastFractalUp > currentMA60
    ) {
      state.breakoutLevel = state.lastFractalUp * (1 + offsetPercent / 100);
      state.waitingForFractal = false;
      context.log(`Breakout level set at ${state.breakoutLevel.toFixed(2)}`);
    }

    // Execute fractal breakout long
    if (
      state.breakoutLevel !== null &&
      currentCandle.close > state.breakoutLevel &&
      kvoConfirm &&
      hasFractalAboveMA20 &&
      bbBuySignal &&
      !isMAtrendDown &&
      !longPosition &&
      !shortPosition &&
      amount > 0
    ) {
      context.log(
        `OPEN LONG (Fractal Breakout): price=${currentCandle.close.toFixed(2)}, ` +
          `breakout=${state.breakoutLevel.toFixed(2)}, trend=${state.trend}`
      );
      context.openLong(amount);
      state.breakoutLevel = null;
    }

    // 2. CHoCH Long Entry
    if (
      state.trend === 'down' &&
      state.lastFractalUp !== null &&
      currentCandle.close > state.lastFractalUp &&
      !isMAtrendDown &&
      !longPosition &&
      !shortPosition &&
      amount > 0
    ) {
      context.log(
        `OPEN LONG (CHoCH): price=${currentCandle.close.toFixed(2)}, ` +
          `fractalUp=${state.lastFractalUp.toFixed(2)}`
      );
      context.openLong(amount);
      state.chochHigh = state.lastFractalUp;
    }

    // ========================================================================
    // SHORT ENTRY LOGIC
    // ========================================================================

    if (enableShorts) {
      // 1. Fractal Breakdown Short Setup
      if (
        currentCandle.close < currentMA60 &&
        state.trend === 'down' &&
        !isMAtrendUp &&
        !longPosition &&
        !shortPosition
      ) {
        state.waitingForFractalShort = true;
      }

      // Set breakdown level when fractal down forms below MA60
      if (
        state.waitingForFractalShort &&
        state.lastFractalDown !== null &&
        state.lastFractalDown < currentMA60
      ) {
        state.breakdownLevel = state.lastFractalDown * (1 - offsetPercent / 100);
        state.waitingForFractalShort = false;
        context.log(`Breakdown level set at ${state.breakdownLevel.toFixed(2)}`);
      }

      // Execute fractal breakdown short
      if (
        state.breakdownLevel !== null &&
        currentCandle.close < state.breakdownLevel &&
        kvoBearish &&
        hasFractalBelowMA20 &&
        bbSellSignal &&
        !isMAtrendUp &&
        !longPosition &&
        !shortPosition &&
        amount > 0
      ) {
        context.log(
          `OPEN SHORT (Fractal Breakdown): price=${currentCandle.close.toFixed(2)}, ` +
            `breakdown=${state.breakdownLevel.toFixed(2)}, trend=${state.trend}`
        );
        context.openShort(amount);
        state.breakdownLevel = null;
      }

      // 2. CHoCH Short Entry
      if (
        state.trend === 'up' &&
        state.lastFractalDown !== null &&
        currentCandle.close < state.lastFractalDown &&
        !isMAtrendUp &&
        !longPosition &&
        !shortPosition &&
        amount > 0
      ) {
        context.log(
          `OPEN SHORT (CHoCH): price=${currentCandle.close.toFixed(2)}, ` +
            `fractalDown=${state.lastFractalDown.toFixed(2)}`
        );
        context.openShort(amount);
        state.chochLow = state.lastFractalDown;
      }
    }

    // ========================================================================
    // EXIT LOGIC
    // ========================================================================

    // Long position stop: 3rd recent fractal down
    if (longPosition && state.recentFractalDowns.length >= 3) {
      const thirdFractalDown = state.recentFractalDowns[2];
      const stopLevel = thirdFractalDown * (1 - offsetPercent / 100);

      if (currentCandle.close <= stopLevel) {
        context.log(
          `CLOSE LONG (Stop): price=${currentCandle.close.toFixed(2)}, ` +
            `stop=${stopLevel.toFixed(2)}, 3rdFractal=${thirdFractalDown.toFixed(2)}`
        );
        context.closeLong();
      }
    }

    // Short position stop: 3rd recent fractal up
    if (shortPosition && state.recentFractalUps.length >= 3) {
      const thirdFractalUp = state.recentFractalUps[2];
      const stopLevel = thirdFractalUp * (1 + offsetPercent / 100);

      if (currentCandle.close >= stopLevel) {
        context.log(
          `CLOSE SHORT (Stop): price=${currentCandle.close.toFixed(2)}, ` +
            `stop=${stopLevel.toFixed(2)}, 3rdFractal=${thirdFractalUp.toFixed(2)}`
        );
        context.closeShort();
      }
    }

    // CHoCH exit for long: use last fractal down
    if (
      longPosition &&
      state.chochHigh !== null &&
      state.lastFractalDown !== null &&
      currentCandle.close <= state.lastFractalDown * (1 - offsetPercent / 100)
    ) {
      context.log(
        `CLOSE LONG (CHoCH Exit): price=${currentCandle.close.toFixed(2)}, ` +
          `fractalDown=${state.lastFractalDown.toFixed(2)}`
      );
      context.closeLong();
      state.chochHigh = null;
    }

    // CHoCH exit for short: use last fractal up
    if (
      shortPosition &&
      state.chochLow !== null &&
      state.lastFractalUp !== null &&
      currentCandle.close >= state.lastFractalUp * (1 + offsetPercent / 100)
    ) {
      context.log(
        `CLOSE SHORT (CHoCH Exit): price=${currentCandle.close.toFixed(2)}, ` +
          `fractalUp=${state.lastFractalUp.toFixed(2)}`
      );
      context.closeShort();
      state.chochLow = null;
    }
  },

  onEnd(context: StrategyContext): void {
    const { longPosition, shortPosition } = context;

    // Close any remaining positions
    if (longPosition) {
      context.log('Closing remaining long position at end of backtest');
      context.closeLong();
    }

    if (shortPosition) {
      context.log('Closing remaining short position at end of backtest');
      context.closeShort();
    }
  },
};

export default gptLongUltimate;
