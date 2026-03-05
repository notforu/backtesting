/**
 * Volatility Regime Transition Scalper
 *
 * Detects Bollinger Band squeezes (periods of extremely low volatility) and
 * trades the subsequent breakouts with volume confirmation. Uses ATR-based
 * exits including take-profit, stop-loss, trailing stop, and time-based exit.
 *
 * Core logic:
 * 1. Track BB Width percentile over a rolling lookback window
 * 2. Detect squeeze: BBW percentile <= squeezePercentile for >= squeezeMinBars consecutive bars
 * 3. On breakout bar: price closes outside the band with volume surge confirmation
 * 4. Exit via TP / SL / trailing stop / time limit
 *
 * Works on any liquid spot or futures market. Recommended timeframes: 15m, 1h, 4h.
 */

import { SMA, ATR, BollingerBands } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute the percentile rank (0-100) of `value` within `window`.
 * Returns how many elements in window are strictly less than value, as a percentage.
 */
function percentileRank(window: number[], value: number): number {
  if (window.length === 0) return 50;
  const below = window.filter(v => v < value).length;
  return (below / window.length) * 100;
}

/** Reset all trail-related state fields */
function resetTrail(self: StrategyState): void {
  self._trailActive = false;
  self._trailStop = 0;
}

/** Reset full position state */
function resetPosition(self: StrategyState): void {
  resetTrail(self);
  self._entryPrice = 0;
  self._entryATR = 0;
  self._entryBarIndex = -1;
  self._side = null;
}

// ============================================================================
// Strategy Internal State
// ============================================================================

interface StrategyState {
  /** Consecutive bars where BBW percentile <= squeezePercentile */
  _squeezeCount: number;
  /** Was the previous bar inside a squeeze? */
  _wasSqueeze: boolean;
  /** Entry price of the current open trade */
  _entryPrice: number;
  /** ATR value at the time of entry (fixed for stop/TP; does not drift) */
  _entryATR: number;
  /** Bar index when trade was entered */
  _entryBarIndex: number;
  /** Whether trailing stop has activated */
  _trailActive: boolean;
  /** Current trailing stop price */
  _trailStop: number;
  /** Direction of the open trade */
  _side: 'long' | 'short' | null;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'volatility-breakout-scalper',
  description:
    'Detects Bollinger Band squeezes (low-volatility compressions) and enters on confirmed breakouts with volume surge. Uses ATR-based TP, SL, trailing stop, and time-based exit for HF scalping.',
  version: '1.0.0',

  params: [
    {
      name: 'bbPeriod',
      type: 'number',
      default: 20,
      min: 10,
      max: 50,
      step: 5,
      description: 'Bollinger Band SMA period',
    },
    {
      name: 'bbStdDev',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 3.0,
      step: 0.5,
      description: 'Bollinger Band standard deviation multiplier',
    },
    {
      name: 'bbwLookback',
      type: 'number',
      default: 200,
      min: 50,
      max: 500,
      step: 50,
      description: 'Lookback period for BB Width percentile calculation',
    },
    {
      name: 'squeezePercentile',
      type: 'number',
      default: 10,
      min: 3,
      max: 25,
      step: 1,
      description: 'BB Width percentile threshold for squeeze (lower = tighter squeeze required)',
    },
    {
      name: 'squeezeMinBars',
      type: 'number',
      default: 5,
      min: 2,
      max: 15,
      step: 1,
      description: 'Minimum consecutive bars in squeeze before a breakout is valid',
    },
    {
      name: 'volumeMultiplier',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 5.0,
      step: 0.5,
      description: 'Volume must exceed this multiple of 20-bar SMA for confirmation',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      default: 14,
      min: 7,
      max: 30,
      step: 1,
      description: 'ATR period for stop/profit calculation',
    },
    {
      name: 'tpAtrMultiplier',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 4.0,
      step: 0.5,
      description: 'Take profit distance in ATR units from entry price',
    },
    {
      name: 'slAtrMultiplier',
      type: 'number',
      default: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.25,
      description: 'Stop loss distance in ATR units from entry price',
    },
    {
      name: 'trailAtrMultiplier',
      type: 'number',
      default: 1.5,
      min: 0.5,
      max: 3.0,
      step: 0.5,
      description: 'Trailing stop distance in ATR units (activates after 1 ATR of profit)',
    },
    {
      name: 'timeExitBars',
      type: 'number',
      default: 15,
      min: 5,
      max: 60,
      step: 5,
      description: 'Maximum hold time in bars before forced exit',
    },
    {
      name: 'positionSizePct',
      type: 'number',
      default: 20,
      min: 5,
      max: 50,
      step: 5,
      description: 'Position size as % of equity (before leverage)',
    },
    {
      name: 'leverage',
      type: 'number',
      default: 20,
      min: 1,
      max: 50,
      step: 5,
      description: 'Leverage multiplier',
    },
  ] as StrategyParam[],

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    self._squeezeCount = 0;
    self._wasSqueeze = false;
    resetPosition(self);
    context.log('Initialized volatility-breakout-scalper');
  },

  onBar(context: StrategyContext): void {
    const {
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

    const bbPeriod = params.bbPeriod as number;
    const bbStdDev = params.bbStdDev as number;
    const bbwLookback = params.bbwLookback as number;
    const squeezePercentile = params.squeezePercentile as number;
    const squeezeMinBars = params.squeezeMinBars as number;
    const volumeMultiplier = params.volumeMultiplier as number;
    const atrPeriod = params.atrPeriod as number;
    const tpAtrMultiplier = params.tpAtrMultiplier as number;
    const slAtrMultiplier = params.slAtrMultiplier as number;
    const trailAtrMultiplier = params.trailAtrMultiplier as number;
    const timeExitBars = params.timeExitBars as number;
    const positionSizePct = params.positionSizePct as number;
    const leverage = params.leverage as number;

    // =========================================================================
    // 2. Warm-up guard — need enough bars for all indicators
    // =========================================================================

    const minBars = Math.max(bbPeriod, atrPeriod + 1, 20) + bbwLookback;
    if (currentIndex < minBars) return;

    // =========================================================================
    // 3. Calculate indicators using windowed slices (O(maxLookback) per bar)
    //    instead of full-array calculations (O(n) per bar → O(n²) total).
    // =========================================================================

    // Window must cover: bbwLookback BB values + bbPeriod bars to produce each BB value.
    // ATR needs atrPeriod+1 candles. Volume SMA needs 20. Add buffer of 20.
    const maxLookback = Math.max(bbPeriod, atrPeriod + 1, bbwLookback, 20) + 20;
    const startIdx = Math.max(0, currentIndex - maxLookback);
    const windowCandles = candleView.slice(startIdx, currentIndex + 1);
    const windowCloses = windowCandles.map(c => c.close);
    const windowHighs = windowCandles.map(c => c.high);
    const windowLows = windowCandles.map(c => c.low);
    const windowVolumes = windowCandles.map(c => c.volume);

    // --- ATR on window ---
    const atrResult = ATR.calculate({
      high: windowHighs,
      low: windowLows,
      close: windowCloses,
      period: atrPeriod,
    });
    if (atrResult.length === 0) return;
    const currentATR = atrResult[atrResult.length - 1];
    if (currentATR === undefined || currentATR <= 0) return;

    // --- Bollinger Bands on window ---
    // BollingerBands.calculate returns array of length (windowCloses.length - bbPeriod + 1)
    const bbResult = BollingerBands.calculate({
      values: windowCloses,
      period: bbPeriod,
      stdDev: bbStdDev,
    });
    if (bbResult.length === 0) return;

    const latestBB = bbResult[bbResult.length - 1];
    const { upper: upperBand, middle: middleBand, lower: lowerBand } = latestBB;
    if (middleBand <= 0) return;

    // BB Width = (upper - lower) / middle
    const currentBBW = (upperBand - lowerBand) / middleBand;

    // Build BBW array from all BB results in the window
    const bbwValues: number[] = bbResult.map(b => (b.upper - b.lower) / b.middle);

    // Rolling window: last bbwLookback values of BBW (not including current bar)
    // bbwValues has one entry per valid BB bar; current bar is the last entry
    const lookbackWindow = bbwValues.slice(
      Math.max(0, bbwValues.length - 1 - bbwLookback),
      bbwValues.length - 1
    );
    if (lookbackWindow.length < 10) return; // Need minimum history for percentile

    // Percentile rank of current BBW within the lookback window
    const currentBBWPercentile = percentileRank(lookbackWindow, currentBBW);

    // --- Volume SMA (20 bars) on window ---
    const volumeSMAResult = SMA.calculate({ values: windowVolumes, period: 20 });
    if (volumeSMAResult.length === 0) return;
    const currentVolumeSMA = volumeSMAResult[volumeSMAResult.length - 1];

    // =========================================================================
    // 4. Update squeeze state
    // =========================================================================

    const isSqueezeBar = currentBBWPercentile <= squeezePercentile;
    const wasSqueeze = self._wasSqueeze;

    if (isSqueezeBar) {
      self._squeezeCount += 1;
    } else {
      // Not in squeeze: if we were in squeeze last bar, breakout candidate
      // Reset after processing entries below
    }
    self._wasSqueeze = isSqueezeBar;

    // =========================================================================
    // 5. EXITS — check before considering entries
    // =========================================================================

    if (longPosition) {
      const entryPrice = self._entryPrice > 0 ? self._entryPrice : longPosition.entryPrice;
      const entryATR = self._entryATR > 0 ? self._entryATR : currentATR;
      const barsHeld = currentIndex - self._entryBarIndex;

      // a. Stop loss: candle LOW touches or crosses below SL level
      const slPrice = entryPrice - slAtrMultiplier * entryATR;
      if (currentCandle.low <= slPrice) {
        context.closeLong();
        resetPosition(self);
        return;
      }

      // b. Take profit: candle HIGH touches or crosses above TP level
      const tpPrice = entryPrice + tpAtrMultiplier * entryATR;
      if (currentCandle.high >= tpPrice) {
        context.closeLong();
        resetPosition(self);
        return;
      }

      // c. Trailing stop (activates once profit >= 1 × entryATR)
      const unrealizedProfit = currentCandle.close - entryPrice;
      if (unrealizedProfit >= entryATR) {
        self._trailActive = true;
      }
      if (self._trailActive) {
        // Trail stop is placed below the current candle high by trailAtrMultiplier * currentATR
        const candidateTrailStop = currentCandle.high - trailAtrMultiplier * currentATR;
        if (candidateTrailStop > self._trailStop) {
          self._trailStop = candidateTrailStop; // Ratchet up only
        }
        if (currentCandle.low <= self._trailStop) {
          context.closeLong();
          resetPosition(self);
          return;
        }
      }

      // d. Time-based exit
      if (barsHeld >= timeExitBars) {
        context.closeLong();
        resetPosition(self);
        return;
      }

      return; // Holding long; skip entry logic
    }

    if (shortPosition) {
      const entryPrice = self._entryPrice > 0 ? self._entryPrice : shortPosition.entryPrice;
      const entryATR = self._entryATR > 0 ? self._entryATR : currentATR;
      const barsHeld = currentIndex - self._entryBarIndex;

      // a. Stop loss: candle HIGH touches or crosses above SL level
      const slPrice = entryPrice + slAtrMultiplier * entryATR;
      if (currentCandle.high >= slPrice) {
        context.closeShort();
        resetPosition(self);
        return;
      }

      // b. Take profit: candle LOW touches or crosses below TP level
      const tpPrice = entryPrice - tpAtrMultiplier * entryATR;
      if (currentCandle.low <= tpPrice) {
        context.closeShort();
        resetPosition(self);
        return;
      }

      // c. Trailing stop (activates once profit >= 1 × entryATR)
      const unrealizedProfit = entryPrice - currentCandle.close;
      if (unrealizedProfit >= entryATR) {
        self._trailActive = true;
        // Initialise sentinel on first activation for shorts (trail ratchets down)
        if (self._trailStop === 0) {
          self._trailStop = entryPrice * 10; // large sentinel value
        }
      }
      if (self._trailActive) {
        // Trail stop is placed above the current candle low by trailAtrMultiplier * currentATR
        const candidateTrailStop = currentCandle.low + trailAtrMultiplier * currentATR;
        if (candidateTrailStop < self._trailStop) {
          self._trailStop = candidateTrailStop; // Ratchet down only
        }
        if (currentCandle.high >= self._trailStop) {
          context.closeShort();
          resetPosition(self);
          return;
        }
      }

      // d. Time-based exit
      if (barsHeld >= timeExitBars) {
        context.closeShort();
        resetPosition(self);
        return;
      }

      return; // Holding short; skip entry logic
    }

    // =========================================================================
    // 6. ENTRIES — only valid when squeeze just ended on this bar (breakout bar)
    //    Condition: previous bar was in squeeze AND current bar is NOT in squeeze
    //    AND we had >= squeezeMinBars consecutive squeeze bars
    // =========================================================================

    // squeezeCount was already incremented above for squeeze bars; for the
    // breakout bar (not a squeeze bar) we use the count accumulated so far.
    // Since we do self._wasSqueeze = isSqueezeBar AFTER using wasSqueeze, we
    // need to check:
    //   wasSqueeze = previous bar was a squeeze
    //   isSqueezeBar = current bar is NOT a squeeze (breakout)
    //   squeezeCount (before this bar) >= squeezeMinBars
    //
    // At this point: isSqueezeBar is false (otherwise we returned from exits
    // path with no open positions and the logic falls through but the entry
    // condition below will catch it correctly).

    if (!wasSqueeze || isSqueezeBar) {
      // Either: no squeeze on previous bar, or still in squeeze — no breakout
      if (!isSqueezeBar) {
        // Exiting squeeze without prior squeeze bar — reset counter
        self._squeezeCount = 0;
      }
      return;
    }

    // Previous bar was a squeeze; current bar is not — check min duration
    const consecutiveSqueezeBars = self._squeezeCount; // count accumulated before this bar
    if (consecutiveSqueezeBars < squeezeMinBars) {
      // Squeeze too brief — reset and move on
      self._squeezeCount = 0;
      return;
    }

    // Volume confirmation
    const volumeConfirmed =
      currentVolumeSMA > 0 && currentCandle.volume > volumeMultiplier * currentVolumeSMA;
    if (!volumeConfirmed) {
      // No volume surge — not a high-conviction breakout; reset squeeze state
      self._squeezeCount = 0;
      return;
    }

    // Direction: price must close outside the band
    const price = currentCandle.close;
    const longSignal = price > upperBand;
    const shortSignal = price < lowerBand;

    if (!longSignal && !shortSignal) {
      // Price did not actually break outside the bands — reset squeeze state
      self._squeezeCount = 0;
      return;
    }

    // =========================================================================
    // 7. Position sizing and entry execution
    // =========================================================================

    const positionValue = (equity * positionSizePct) / 100;
    const positionSize = (positionValue * leverage) / price;
    if (positionSize <= 0) return;

    if (longSignal) {
      context.openLong(positionSize);
      self._entryPrice = price;
      self._entryATR = currentATR;
      self._entryBarIndex = currentIndex;
      resetTrail(self);
      self._side = 'long';
    } else if (shortSignal) {
      context.openShort(positionSize);
      self._entryPrice = price;
      self._entryATR = currentATR;
      self._entryBarIndex = currentIndex;
      resetTrail(self);
      self._side = 'short';
    }

    // Reset squeeze counter after entry
    self._squeezeCount = 0;
  },

  onEnd(context?: StrategyContext): void {
    if (!context) return;
    const self = this as unknown as StrategyState;
    // Close any remaining open positions at end of backtest
    if (context.longPosition) {
      context.closeLong();
    }
    if (context.shortPosition) {
      context.closeShort();
    }
    resetPosition(self);
  },
};

export default strategy;
