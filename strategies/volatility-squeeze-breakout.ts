/**
 * Volatility Squeeze Breakout Strategy
 *
 * This strategy exploits the volatility clustering phenomenon in crypto markets.
 * It detects "squeeze" conditions where Bollinger Bands contract inside Keltner
 * Channels, then enters on the breakout with momentum confirmation and an EMA
 * trend filter.
 *
 * PERFORMANCE: Uses incremental/streaming indicator computation (O(n) per backtest
 * instead of O(n²)). Indicators are computed once per bar using nextValue() API
 * rather than recalculating from scratch over the entire history each bar.
 *
 * Entry Rules:
 * - Squeeze Release: BB expands outside KC after being inside (squeeze "fires")
 * - Momentum Direction: Linear regression of (close - BB middle) confirms direction
 * - Trend Filter: Price must be on correct side of EMA (50-period default)
 *
 * Exit Rules:
 * - Stop Loss: ATR-based (2.5x ATR default)
 * - Take Profit: ATR-based (2.5x ATR default)
 * - Momentum Reversal: When momentum crosses zero against position
 * - Time-Based: Maximum holding period (45 bars / ~7.5 days on 4h chart)
 */

import ti from 'technicalindicators';
const { BollingerBands, EMA, ATR } = ti;
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

// ============================================================================
// Streaming indicator state (stored on `this` between onBar calls)
// ============================================================================

interface IndicatorState {
  bbStream: InstanceType<typeof BollingerBands>;
  kcEmaStream: InstanceType<typeof EMA>;
  kcAtrStream: InstanceType<typeof ATR>;
  trendEmaStream: InstanceType<typeof EMA>;
  riskAtrStream: InstanceType<typeof ATR>;

  // Cached indicator values per bar
  bbValues: { upper: number; middle: number; lower: number }[];
  kcValues: { upper: number; middle: number; lower: number }[];
  emaValues: number[];
  atrValues: number[];

  // Deviation buffer for linear regression momentum
  deviationBuffer: number[];
  momentumValues: number[];

  // Params cached for linear regression
  momentumPeriod: number;
  kcMultiplier: number;

  // Track how many bars we've processed
  processedBars: number;
}

/**
 * Compute linear regression value over the last `period` values of a buffer.
 * Returns the regression value at the most recent point.
 */
function linRegLast(buffer: number[], period: number): number | undefined {
  if (buffer.length < period) return undefined;
  const start = buffer.length - period;
  const n = period;
  // Pre-computed constants for 0..n-1: sumX = n(n-1)/2, sumX2 = n(n-1)(2n-1)/6
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  let sumY = 0;
  let sumXY = 0;
  for (let j = 0; j < n; j++) {
    const y = buffer[start + j];
    sumY += y;
    sumXY += j * y;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return undefined;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return intercept + slope * (n - 1);
}

/**
 * Volatility Squeeze Breakout Strategy implementation
 */
const volatilitySqueezeBreakout: Strategy = {
  name: 'volatility-squeeze-breakout',
  description:
    'Volatility squeeze breakout strategy using BB/KC squeeze detection with linear regression momentum and EMA trend filter. Enters when squeeze fires in trend direction.',
  version: '1.0.0',

  params: [
    {
      name: 'bbPeriod',
      label: 'BB Period',
      type: 'number',
      default: 30,
      min: 10,
      max: 30,
      step: 5,
      description: 'Bollinger Bands period',
    },
    {
      name: 'bbStdDev',
      label: 'BB Std Dev',
      type: 'number',
      default: 1.5,
      min: 1.5,
      max: 2.5,
      step: 0.5,
      description: 'Bollinger Bands standard deviation multiplier',
    },
    {
      name: 'kcPeriod',
      label: 'KC Period',
      type: 'number',
      default: 10,
      min: 10,
      max: 30,
      step: 5,
      description: 'Keltner Channel period',
    },
    {
      name: 'kcMultiplier',
      label: 'KC Multiplier',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 2.0,
      step: 0.5,
      description: 'Keltner Channel ATR multiplier',
    },
    {
      name: 'emaPeriod',
      label: 'EMA Period',
      type: 'number',
      default: 70,
      min: 30,
      max: 80,
      step: 10,
      description: 'EMA trend filter period',
    },
    {
      name: 'momentumPeriod',
      label: 'Momentum Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 30,
      step: 5,
      description: 'Linear regression period for momentum calculation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for stop loss and take profit',
    },
    {
      name: 'atrStopMultiplier',
      label: 'ATR Stop Multiplier',
      type: 'number',
      default: 2.5,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for stop loss distance',
    },
    {
      name: 'atrProfitMultiplier',
      label: 'ATR Profit Multiplier',
      type: 'number',
      default: 2.5,
      min: 2.0,
      max: 5.0,
      step: 0.5,
      description: 'ATR multiplier for take profit distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 45,
      min: 15,
      max: 45,
      step: 15,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish squeeze fires',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const bbPeriod = params.bbPeriod as number;
    const bbStdDev = params.bbStdDev as number;
    const kcPeriod = params.kcPeriod as number;
    const kcMultiplier = params.kcMultiplier as number;
    const emaPeriod = params.emaPeriod as number;
    const momentumPeriod = params.momentumPeriod as number;
    const atrPeriod = params.atrPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrProfitMultiplier = params.atrProfitMultiplier as number;

    if (atrProfitMultiplier < atrStopMultiplier) {
      context.log(
        `WARNING: Profit multiplier (${atrProfitMultiplier}) < Stop multiplier (${atrStopMultiplier}). Negative risk-reward ratio.`
      );
    }

    // Initialize streaming indicator instances
    const state: IndicatorState = {
      bbStream: new BollingerBands({ period: bbPeriod, stdDev: bbStdDev, values: [] }),
      kcEmaStream: new EMA({ period: kcPeriod, values: [] }),
      kcAtrStream: new ATR({ period: kcPeriod, high: [], low: [], close: [] }),
      trendEmaStream: new EMA({ period: emaPeriod, values: [] }),
      riskAtrStream: new ATR({ period: atrPeriod, high: [], low: [], close: [] }),
      bbValues: [],
      kcValues: [],
      emaValues: [],
      atrValues: [],
      deviationBuffer: [],
      momentumValues: [],
      momentumPeriod,
      kcMultiplier,
      processedBars: 0,
    };

    (this as any)._state = state;

    context.log(
      `Initialized Volatility Squeeze Breakout (streaming): BB(${bbPeriod}), KC(${kcPeriod}), EMA(${emaPeriod}), Stops: ${atrStopMultiplier}x ATR, TP: ${atrProfitMultiplier}x ATR`
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
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrProfitMultiplier = params.atrProfitMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableShorts = params.enableShorts as boolean;

    const currentPrice = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;

    // --- Feed current candle to all streaming indicators (O(1) per indicator) ---

    // Bollinger Bands
    const bbVal = state.bbStream.nextValue(currentPrice);
    if (bbVal) {
      state.bbValues.push({ upper: bbVal.upper, middle: bbVal.middle, lower: bbVal.lower });
    }

    // Keltner Channel = EMA(close) +/- multiplier * ATR
    const kcEma = state.kcEmaStream.nextValue(currentPrice);
    const kcAtr = state.kcAtrStream.nextValue({ high, low, close: currentPrice });
    if (kcEma !== undefined && kcAtr !== undefined) {
      state.kcValues.push({
        upper: kcEma + state.kcMultiplier * kcAtr,
        middle: kcEma,
        lower: kcEma - state.kcMultiplier * kcAtr,
      });
    }

    // Trend EMA
    const trendEma = state.trendEmaStream.nextValue(currentPrice);
    if (trendEma !== undefined) {
      state.emaValues.push(trendEma);
    }

    // Risk ATR
    const riskAtr = state.riskAtrStream.nextValue({ high, low, close: currentPrice });
    if (riskAtr !== undefined) {
      state.atrValues.push(riskAtr);
    }

    // Momentum: linear regression of (close - BB middle)
    if (bbVal) {
      state.deviationBuffer.push(currentPrice - bbVal.middle);
      const momVal = linRegLast(state.deviationBuffer, state.momentumPeriod);
      if (momVal !== undefined) {
        state.momentumValues.push(momVal);
      }
    }

    state.processedBars++;

    // --- Check we have enough data for current + previous values ---
    if (
      state.bbValues.length < 2 ||
      state.kcValues.length < 2 ||
      state.emaValues.length < 1 ||
      state.atrValues.length < 1 ||
      state.momentumValues.length < 2
    ) {
      return;
    }

    // --- Read current and previous indicator values ---
    const currentBB = state.bbValues[state.bbValues.length - 1];
    const prevBB = state.bbValues[state.bbValues.length - 2];
    const currentKC = state.kcValues[state.kcValues.length - 1];
    const prevKC = state.kcValues[state.kcValues.length - 2];
    const currentEMA = state.emaValues[state.emaValues.length - 1];
    const currentATR = state.atrValues[state.atrValues.length - 1];
    const currentMomentum = state.momentumValues[state.momentumValues.length - 1];
    const prevMomentum = state.momentumValues[state.momentumValues.length - 2];

    // Determine squeeze state
    const prevSqueezeOn = prevBB.upper < prevKC.upper && prevBB.lower > prevKC.lower;
    const currentSqueezeOn = currentBB.upper < currentKC.upper && currentBB.lower > currentKC.lower;
    const squeezeFired = prevSqueezeOn && !currentSqueezeOn;

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryPrice = longPosition.entryPrice;
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = (this as any)._entryATR || currentATR;

      const stopPrice = entryPrice - entryATR * atrStopMultiplier;
      if (currentPrice <= stopPrice) {
        context.closeLong();
        return;
      }

      const takeProfitPrice = entryPrice + entryATR * atrProfitMultiplier;
      if (currentPrice >= takeProfitPrice) {
        context.closeLong();
        return;
      }

      if (currentMomentum < 0 && prevMomentum >= 0) {
        context.closeLong();
        return;
      }

      if (barsHeld >= maxHoldBars) {
        context.closeLong();
        return;
      }
    }

    if (shortPosition) {
      const entryPrice = shortPosition.entryPrice;
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;
      const entryATR = (this as any)._entryATR || currentATR;

      const stopPrice = entryPrice + entryATR * atrStopMultiplier;
      if (currentPrice >= stopPrice) {
        context.closeShort();
        return;
      }

      const takeProfitPrice = entryPrice - entryATR * atrProfitMultiplier;
      if (currentPrice <= takeProfitPrice) {
        context.closeShort();
        return;
      }

      if (currentMomentum > 0 && prevMomentum <= 0) {
        context.closeShort();
        return;
      }

      if (barsHeld >= maxHoldBars) {
        context.closeShort();
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition && squeezeFired) {
      // LONG ENTRY
      if (currentMomentum > 0 && currentMomentum > prevMomentum && currentPrice > currentEMA) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          (this as any)._entryBar = currentIndex;
          (this as any)._entryATR = currentATR;
          context.openLong(amount);
        }
      }

      // SHORT ENTRY
      if (
        enableShorts &&
        currentMomentum < 0 &&
        currentMomentum < prevMomentum &&
        currentPrice < currentEMA
      ) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          (this as any)._entryBar = currentIndex;
          (this as any)._entryATR = currentATR;
          context.openShort(amount);
        }
      }
    }
  },

  onEnd(context: StrategyContext): void {
    if (context.longPosition) {
      context.closeLong();
    }
    if (context.shortPosition) {
      context.closeShort();
    }
  },
};

export default volatilitySqueezeBreakout;
