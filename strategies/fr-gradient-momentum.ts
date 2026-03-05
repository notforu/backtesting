/**
 * FR Gradient Momentum
 *
 * Hypothesis: The RATE OF CHANGE (gradient) of the funding rate is an earlier
 * signal than the absolute FR level. When FR is accelerating rapidly in one
 * direction, the crowd imbalance is still BUILDING — we can enter before the
 * eventual squeeze.
 *
 * FR Gradient Calculation:
 *   gradient = (FR[now] - FR[now - frGradientWindow]) / frGradientWindow
 *   Percentile rank of |gradient| among last frLookbackPeriods gradients.
 *   Signal ACTIVE when gradient percentile > gradientPercentileThreshold.
 *
 * Direction (contrarian):
 *   gradient > 0 (longs paying increasingly more) → SHORT
 *   gradient < 0 (shorts paying increasingly more) → LONG
 *
 * Entry (ALL must be true):
 *   1. FR gradient signal is active (gradient percentile > threshold)
 *   2. Price confirmation: price moving against the FR pressure
 *      - For LONG: price below SMA(confirmSmaPeriod)
 *      - For SHORT: price above SMA(confirmSmaPeriod)
 *   3. RSI filter: rsiLow < RSI < rsiHigh (avoid climactic moves)
 *   4. No existing position AND not already traded this gradient activation
 *
 * Exit (ANY):
 *   1. ATR stop-loss (slAtrMultiplier × ATR)
 *   2. ATR take-profit (tpAtrMultiplier × ATR, 2.5:1 R:R by default)
 *   3. Time exit (timeExitBars bars)
 *   4. Gradient sign reversal — the pressure has reversed
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data: run scripts/cache-funding-rates.ts first
 */

import { RSI, SMA, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Internal State
// ============================================================================

interface StrategyState {
  /** Bar index at which the current position was opened */
  _entryBar: number;
  /** Direction of the current position, or null if flat */
  _direction: 'long' | 'short' | null;
  /** ATR value at the time of entry (used for fixed stop/TP levels) */
  _atrAtEntry: number;
  /**
   * Running index into the fundingRates array pointing to the last entry
   * whose timestamp is <= the current candle. Maintained incrementally for
   * O(1) amortised lookup instead of scanning the full array every bar.
   */
  _lastFRIndex: number;
  /**
   * Whether we already entered a trade during the current gradient activation.
   * Set to true on entry. Reset to false ONLY when gradient signal deactivates
   * (gradient percentile drops below threshold). Prevents re-entry spam.
   */
  _gradientTraded: boolean;
  /**
   * Direction implied by the gradient when we last entered, or null when flat.
   * Used for gradient sign-reversal exit.
   */
  _entryGradientSign: 'positive' | 'negative' | null;
  /** Whether gradient signal was active on the previous bar */
  _prevGradientActive: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate SMA values padded to align index with candles array.
 */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = SMA.calculate({ values: closes, period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate RSI values padded to align index with candles array.
 * RSI with period P produces (closes.length - period) values.
 */
function calculateRSI(closes: number[], period: number): (number | undefined)[] {
  if (closes.length <= period) return new Array(closes.length).fill(undefined);
  const result = RSI.calculate({ values: closes, period });
  // RSI produces (n - period) values; pad with `period` undefineds
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate ATR values padded to align index with candles array.
 * ATR needs (period + 1) candles for the first value.
 */
function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): (number | undefined)[] {
  if (closes.length <= period) return new Array(closes.length).fill(undefined);
  const result = ATR.calculate({ high: highs, low: lows, close: closes, period });
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate the percentile rank of `value` within `arr` (0–100).
 * e.g. percentileRank(arr, x) = 95 means 95% of values in arr are <= x.
 */
function percentileRank(arr: number[], value: number): number {
  if (arr.length === 0) return 50;
  let countBelow = 0;
  for (const v of arr) {
    if (v <= value) countBelow++;
  }
  return (countBelow / arr.length) * 100;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'fr-gradient-momentum',
  description:
    'Trades based on the rate of change (gradient) of the funding rate rather than absolute levels. ' +
    'When the FR gradient percentile exceeds the threshold, a crowd imbalance is building. ' +
    'Contrarian entries (against gradient direction) with price and RSI confirmation. ' +
    'Exits via ATR stop/TP, time limit, or gradient sign reversal. Requires futures mode.',
  version: '1.0.0',

  params: [
    {
      name: 'frGradientWindow',
      type: 'number',
      default: 6,
      min: 3,
      max: 12,
      step: 3,
      description: 'Number of FR observations used to compute the gradient (e.g. 6 = last 48h)',
    },
    {
      name: 'frLookbackPeriods',
      type: 'number',
      default: 90,
      min: 60,
      max: 150,
      step: 30,
      description: 'FR observations to keep for gradient percentile ranking (e.g. 90 ≈ 30 days)',
    },
    {
      name: 'gradientPercentileThreshold',
      type: 'number',
      default: 85,
      min: 75,
      max: 95,
      step: 5,
      description: 'Absolute gradient percentile required to activate signal (e.g. 85 = top 15%)',
    },
    {
      name: 'confirmSmaPeriod',
      type: 'number',
      default: 20,
      min: 10,
      max: 40,
      step: 10,
      description: 'SMA period for price confirmation filter',
    },
    {
      name: 'rsiPeriod',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'RSI period',
    },
    {
      name: 'rsiLow',
      type: 'number',
      default: 20,
      min: 15,
      max: 30,
      step: 5,
      description: 'RSI lower bound — avoid entering oversold territory (longs)',
    },
    {
      name: 'rsiHigh',
      type: 'number',
      default: 80,
      min: 70,
      max: 85,
      step: 5,
      description: 'RSI upper bound — avoid entering overbought territory (shorts)',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for stop-loss and take-profit calculation',
    },
    {
      name: 'tpAtrMultiplier',
      type: 'number',
      default: 2.5,
      min: 1.5,
      max: 4.0,
      step: 0.5,
      description: 'Take-profit distance in ATR units (2.5:1 R:R vs default SL)',
    },
    {
      name: 'slAtrMultiplier',
      type: 'number',
      default: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.5,
      description: 'Stop-loss distance in ATR units',
    },
    {
      name: 'timeExitBars',
      type: 'number',
      default: 48,
      min: 12,
      max: 96,
      step: 12,
      description: 'Maximum bars to hold a position before forced time exit',
    },
    {
      name: 'positionSizePct',
      type: 'number',
      default: 95,
      min: 50,
      max: 100,
      step: 25,
      description: 'Position size as percentage of available equity',
    },
    {
      name: 'leverage',
      type: 'number',
      default: 3,
      min: 1,
      max: 10,
      step: 3,
      description: 'Leverage multiplier (conservative default of 3 to limit drawdown)',
    },
  ] as StrategyParam[],

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    self._entryBar = -1;
    self._direction = null;
    self._atrAtEntry = 0;
    self._lastFRIndex = 0;
    self._gradientTraded = false;
    self._entryGradientSign = null;
    self._prevGradientActive = false;
    context.log('Initialized fr-gradient-momentum');
  },

  onBar(context: StrategyContext): void {
    const {
      fundingRates,
      longPosition,
      shortPosition,
      equity,
      currentCandle,
      currentIndex,
      params,
      candleView,
    } = context;

    const self = this as unknown as StrategyState;

    // =========================================================================
    // 1. Extract parameters
    // =========================================================================
    const frGradientWindow = params.frGradientWindow as number;
    const frLookbackPeriods = params.frLookbackPeriods as number;
    const gradientPercentileThreshold = params.gradientPercentileThreshold as number;
    const confirmSmaPeriod = params.confirmSmaPeriod as number;
    const rsiPeriod = params.rsiPeriod as number;
    const rsiLow = params.rsiLow as number;
    const rsiHigh = params.rsiHigh as number;
    const atrPeriod = params.atrPeriod as number;
    const tpAtrMultiplier = params.tpAtrMultiplier as number;
    const slAtrMultiplier = params.slAtrMultiplier as number;
    const timeExitBars = params.timeExitBars as number;
    const positionSizePct = params.positionSizePct as number;
    const leverage = params.leverage as number;

    // =========================================================================
    // 2. Require funding rate data
    // =========================================================================
    if (!fundingRates || fundingRates.length === 0) return;

    // =========================================================================
    // 3. Minimum bar warmup: need enough bars for all indicators
    // =========================================================================
    const maxLookback = Math.max(confirmSmaPeriod, rsiPeriod, atrPeriod) + 20;
    if (currentIndex < maxLookback) return;

    // =========================================================================
    // 4. Advance running FR index (O(1) amortised)
    // =========================================================================
    while (
      self._lastFRIndex < fundingRates.length - 1 &&
      fundingRates[self._lastFRIndex + 1].timestamp <= currentCandle.timestamp
    ) {
      self._lastFRIndex++;
    }

    // =========================================================================
    // 5. FR Gradient Calculation
    // =========================================================================
    // Need at least (frLookbackPeriods + frGradientWindow) observations for a
    // meaningful percentile, but we proceed with what we have (minimum check below).
    const frEndIdx = self._lastFRIndex;

    // Need at least frGradientWindow+1 FR observations to compute one gradient
    if (frEndIdx < frGradientWindow) return;

    // Compute the current gradient:
    //   gradient = (FR[now] - FR[now - frGradientWindow]) / frGradientWindow
    const currentFR = fundingRates[frEndIdx].fundingRate;
    const pastFR = fundingRates[frEndIdx - frGradientWindow].fundingRate;
    const currentGradient = (currentFR - pastFR) / frGradientWindow;
    const absCurrentGradient = Math.abs(currentGradient);

    // Build the historical gradient array for percentile ranking.
    // Iterate over the last frLookbackPeriods FR observations and compute
    // gradients wherever enough history exists.
    const frHistStart = Math.max(frGradientWindow, frEndIdx - frLookbackPeriods + 1);
    const historicalAbsGradients: number[] = [];
    for (let i = frHistStart; i <= frEndIdx; i++) {
      if (i >= frGradientWindow) {
        const g = (fundingRates[i].fundingRate - fundingRates[i - frGradientWindow].fundingRate) / frGradientWindow;
        historicalAbsGradients.push(Math.abs(g));
      }
    }

    if (historicalAbsGradients.length < 10) return; // Need minimum gradient history

    const gradientPercentile = percentileRank(historicalAbsGradients, absCurrentGradient);
    const gradientActive = gradientPercentile >= gradientPercentileThreshold;

    // Determine implied contrarian direction from gradient sign:
    //   positive gradient → longs paying increasing amounts → SHORT (contrarian)
    //   negative gradient → shorts paying increasing amounts → LONG (contrarian)
    const gradientSign: 'positive' | 'negative' = currentGradient >= 0 ? 'positive' : 'negative';
    const signalDirection: 'long' | 'short' = gradientSign === 'positive' ? 'short' : 'long';

    // Reset _gradientTraded when gradient signal deactivates.
    // This allows re-entry on the next distinct activation.
    if (!gradientActive && self._prevGradientActive) {
      self._gradientTraded = false;
    }
    self._prevGradientActive = gradientActive;

    // =========================================================================
    // 6. Windowed indicator calculations
    // =========================================================================
    const windowSize = maxLookback;
    const startIdx = Math.max(0, currentIndex - windowSize + 1);
    const windowCandles = candleView.slice(startIdx);

    const closes = windowCandles.map(c => c.close);
    const highs = windowCandles.map(c => c.high);
    const lows = windowCandles.map(c => c.low);

    const smaArr = calculateSMA(closes, confirmSmaPeriod);
    const rsiArr = calculateRSI(closes, rsiPeriod);
    const atrArr = calculateATR(highs, lows, closes, atrPeriod);

    const lastIdx = closes.length - 1;

    const currentSMA = smaArr[lastIdx];
    const currentRSI = rsiArr[lastIdx];
    const currentATR = atrArr[lastIdx];

    // Require all indicators to be available
    if (
      currentSMA === undefined ||
      currentRSI === undefined ||
      currentATR === undefined ||
      currentATR <= 0
    ) {
      return;
    }

    const price = currentCandle.close;

    // =========================================================================
    // 7. MANAGE EXISTING POSITIONS (exits before new entries)
    // =========================================================================

    if (longPosition) {
      const entryATR = self._atrAtEntry > 0 ? self._atrAtEntry : currentATR;

      // a. Stop-loss: triggered when candle LOW reaches stop level
      const stopPrice = longPosition.entryPrice - entryATR * slAtrMultiplier;
      if (currentCandle.low <= stopPrice) {
        context.closeLong();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // b. Take-profit: triggered when candle HIGH reaches TP level
      const tpPrice = longPosition.entryPrice + entryATR * tpAtrMultiplier;
      if (currentCandle.high >= tpPrice) {
        context.closeLong();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // c. Time exit: close after timeExitBars bars
      if (self._entryBar >= 0 && currentIndex - self._entryBar >= timeExitBars) {
        context.closeLong();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // d. Gradient sign reversal exit:
      //    We entered LONG because gradient was NEGATIVE (shorts paying more).
      //    If gradient flips to POSITIVE, the pressure has reversed → exit.
      if (self._entryGradientSign === 'negative' && gradientSign === 'positive' && gradientActive) {
        context.closeLong();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      return; // In long position, skip entry logic
    }

    if (shortPosition) {
      const entryATR = self._atrAtEntry > 0 ? self._atrAtEntry : currentATR;

      // a. Stop-loss: triggered when candle HIGH reaches stop level
      const stopPrice = shortPosition.entryPrice + entryATR * slAtrMultiplier;
      if (currentCandle.high >= stopPrice) {
        context.closeShort();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // b. Take-profit: triggered when candle LOW reaches TP level
      const tpPrice = shortPosition.entryPrice - entryATR * tpAtrMultiplier;
      if (currentCandle.low <= tpPrice) {
        context.closeShort();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // c. Time exit
      if (self._entryBar >= 0 && currentIndex - self._entryBar >= timeExitBars) {
        context.closeShort();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      // d. Gradient sign reversal exit:
      //    We entered SHORT because gradient was POSITIVE (longs paying more).
      //    If gradient flips to NEGATIVE, the pressure has reversed → exit.
      if (self._entryGradientSign === 'positive' && gradientSign === 'negative' && gradientActive) {
        context.closeShort();
        self._direction = null;
        self._entryGradientSign = null;
        return;
      }

      return; // In short position, skip entry logic
    }

    // =========================================================================
    // 8. ENTRY PIPELINE (no existing position)
    // =========================================================================

    // Gate 1: Gradient signal must be active AND we haven't already traded this activation
    if (!gradientActive) return;
    if (self._gradientTraded) return;

    // Gate 2: Price confirmation — price must be moving AGAINST the FR pressure direction.
    //   For LONG (gradient negative, shorts paying): price beaten down → below SMA
    //   For SHORT (gradient positive, longs paying): price pumped up → above SMA
    const priceConfirmed =
      (signalDirection === 'long' && price < currentSMA) ||
      (signalDirection === 'short' && price > currentSMA);

    if (!priceConfirmed) return;

    // Gate 3: RSI filter — avoid entering into climactic moves
    const rsiOk = currentRSI > rsiLow && currentRSI < rsiHigh;
    if (!rsiOk) return;

    // =========================================================================
    // 9. Position sizing and entry execution
    // =========================================================================
    const positionValue = (equity * positionSizePct) / 100;
    const positionSize = (positionValue * leverage) / price;
    if (positionSize <= 0) return;

    if (signalDirection === 'long') {
      context.openLong(positionSize);
      self._direction = 'long';
      self._entryBar = currentIndex;
      self._atrAtEntry = currentATR;
      self._gradientTraded = true;
      self._entryGradientSign = gradientSign; // 'negative' (shorts paying more)
    } else {
      context.openShort(positionSize);
      self._direction = 'short';
      self._entryBar = currentIndex;
      self._atrAtEntry = currentATR;
      self._gradientTraded = true;
      self._entryGradientSign = gradientSign; // 'positive' (longs paying more)
    }
  },

  onEnd(context?: StrategyContext): void {
    const self = this as unknown as StrategyState;
    if (context) {
      if (context.longPosition) context.closeLong();
      if (context.shortPosition) context.closeShort();
    }
    self._direction = null;
    self._entryGradientSign = null;
  },
};

export default strategy;
