/**
 * Funding Rate Spike Trading Strategy v4
 *
 * Drop-in replacement for funding-rate-spike-v2 that delegates SL/TP execution
 * to the engine via ctx.setStopLoss() / ctx.setTakeProfit() rather than manually
 * checking candle high/low inside onBar().
 *
 * Benefits over v2:
 * - Engine checks SL/TP BEFORE onBar() on each bar, enabling intra-bar resolution
 *   (fetches sub-candle timeframe to determine whether SL or TP hit first).
 * - Pessimistic fill price is applied when sub-candles are unavailable.
 * - All exit fill prices reported accurately in BacktestResult metrics, including
 *   engineStopLossCount, engineTakeProfitCount, and pessimisticSlTpCount.
 *
 * Key changes from v2:
 * - Manual SL/TP candle-high/low checks removed from onBar()
 * - ctx.setStopLoss() / ctx.setTakeProfit() called on every bar while in position
 * - Trailing stop ratchet updated via ctx.setStopLoss(trailStop) instead of manual check
 * - All trade recording moved to onOrderFilled() — no recordTrade() calls in onBar()
 * - Entry price captured in onOrderFilled() for accurate fill prices including slippage
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data: run scripts/cache-funding-rates.ts first
 */

import ti from 'technicalindicators';
const { SMA, ATR } = ti;
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';
import type { Order } from '../src/core/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** Calculate SMA with padding to align with candles array */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = SMA.calculate({ values: closes, period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/** Calculate ATR with padding to align with candles array */
function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): (number | undefined)[] {
  if (closes.length <= period) return new Array(closes.length).fill(undefined);
  const result = ATR.calculate({ high: highs, low: lows, close: closes, period });
  // ATR needs period+1 candles to produce first value
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/** Calculate percentile of an array (p in 0-100) */
function calcPercentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length * p) / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/** Clamp value between min and max */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Mean of an array */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Record a closed trade for Kelly sizing */
function recordTrade(
  self: StrategyState,
  entryPrice: number,
  exitPrice: number,
  side: 'long' | 'short'
): void {
  if (!self._tradeHistory) self._tradeHistory = [];
  const pnlPct =
    side === 'long'
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;
  self._tradeHistory.push({ pnlPct });
}

/** Reset trail state */
function resetTrail(self: StrategyState): void {
  self._trailActive = false;
  self._trailStop = 0;
}

/** Strategy internal state stored on `this` */
interface StrategyState {
  /** Trailing stop activated flag */
  _trailActive: boolean;
  /** Current trailing stop price */
  _trailStop: number;
  /** Trade history for Kelly sizing */
  _tradeHistory: { pnlPct: number }[];
  /** Entry price of current trade (set in onOrderFilled, cleared on exit) */
  _lastEntryPrice: number;
  /** ATR value at entry -- used for fixed ATR stop/TP levels (does not expand with live ATR) */
  _entryATR: number;
  /** Side of the open position ('long' | 'short' | null) -- used in onOrderFilled to reconstruct PnL */
  _positionSide: 'long' | 'short' | null;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'funding-rate-spike-v4',
  description:
    'Engine-managed SL/TP variant of funding-rate-spike-v2. Uses ctx.setStopLoss() and ctx.setTakeProfit() for intra-bar SL/TP resolution with accurate fill prices. Same parameters as v2.',
  version: '4.0.0',

  params: [
    // --- Core Parameters (from v1) ---
    {
      name: 'holdingPeriods',
      type: 'number',
      default: 3,
      min: 1,
      max: 20,
      step: 1,
      description: 'Max hold time in 8h funding periods (time-based exit)',
    },
    {
      name: 'positionSizePct',
      type: 'number',
      default: 50,
      min: 10,
      max: 100,
      step: 10,
      description: 'Base position size % of equity (used for fixed and volAdjusted sizing)',
    },

    // --- Threshold Parameters (Enhancement 1: Adaptive Percentile) ---
    {
      name: 'usePercentile',
      type: 'boolean',
      default: true,
      description: 'Use rolling percentile thresholds instead of absolute values',
    },
    {
      name: 'shortPercentile',
      type: 'number',
      default: 95,
      min: 80,
      max: 99,
      step: 1,
      description: 'FR percentile to trigger short entry (e.g., 95 = top 5% of recent FR)',
    },
    {
      name: 'longPercentile',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      step: 1,
      description: 'FR percentile to trigger long entry (e.g., 5 = bottom 5% of recent FR)',
    },
    {
      name: 'percentileLookback',
      type: 'number',
      default: 90,
      min: 30,
      max: 365,
      step: 10,
      description: 'Number of FR observations for percentile calculation',
    },
    {
      name: 'fundingThresholdShort',
      type: 'number',
      default: 0.0005,
      min: 0.0001,
      max: 0.01,
      step: 0.0001,
      description: 'Absolute short threshold if usePercentile=false (e.g., 0.0005 = 0.05%)',
    },
    {
      name: 'fundingThresholdLong',
      type: 'number',
      default: -0.0003,
      min: -0.01,
      max: 0,
      step: 0.0001,
      description: 'Absolute long threshold if usePercentile=false (e.g., -0.0003 = -0.03%)',
    },

    // --- ATR & Stops (Enhancement 2: ATR Volatility Filter + Adaptive Stops) ---
    {
      name: 'useATRStops',
      type: 'boolean',
      default: true,
      description: 'Use ATR-based stops/TP instead of fixed percentages',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      default: 14,
      min: 7,
      max: 30,
      step: 1,
      description: 'ATR calculation period',
    },
    {
      name: 'atrStopMultiplier',
      type: 'number',
      default: 2.5,
      min: 1.0,
      max: 5.0,
      step: 0.5,
      description: 'Stop-loss distance in ATR units (measured from entry ATR)',
    },
    {
      name: 'atrTPMultiplier',
      type: 'number',
      default: 3.5,
      min: 1.5,
      max: 6.0,
      step: 0.5,
      description: 'Take-profit distance in ATR units (measured from entry ATR)',
    },
    {
      name: 'stopLossPct',
      type: 'number',
      default: 3.0,
      min: 0.5,
      max: 20,
      step: 0.5,
      description: 'Fixed stop-loss % (used if useATRStops=false)',
    },
    {
      name: 'takeProfitPct',
      type: 'number',
      default: 4.0,
      min: 0.5,
      max: 20,
      step: 0.5,
      description: 'Fixed take-profit % (used if useATRStops=false)',
    },
    {
      name: 'atrFilterEnabled',
      type: 'boolean',
      default: true,
      description: 'Skip entries when ATR is too high relative to its average (high-vol filter)',
    },
    {
      name: 'atrFilterThreshold',
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      step: 0.1,
      description: 'Skip entry when current ATR > X * rolling avg ATR',
    },

    // --- Trend Filter (Enhancement 3: Trend Alignment) ---
    {
      name: 'useTrendFilter',
      type: 'boolean',
      default: true,
      description: 'Block shorts in uptrends and longs in downtrends',
    },
    {
      name: 'trendSMAPeriod',
      type: 'number',
      default: 50,
      min: 20,
      max: 200,
      step: 10,
      description: 'SMA period for trend determination',
    },

    // --- Trailing Stop (Enhancement 4: ATR Trailing Stop Exit) ---
    {
      name: 'useTrailingStop',
      type: 'boolean',
      default: false,
      description: 'Activate trailing stop once trade is sufficiently profitable',
    },
    {
      name: 'trailActivationATR',
      type: 'number',
      default: 1.0,
      min: 0.5,
      max: 3.0,
      step: 0.5,
      description: 'Profit in ATR units required to activate trailing stop',
    },
    {
      name: 'trailDistanceATR',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 4.0,
      step: 0.5,
      description: 'Trailing stop distance in ATR units (uses current ATR)',
    },

    // --- Position Sizing (Enhancement 5: Fractional Kelly / Vol-Adjusted) ---
    {
      name: 'positionSizeMethod',
      type: 'select',
      default: 'volAdjusted',
      options: ['fixed', 'volAdjusted', 'fractionalKelly'],
      description: 'Position sizing method: fixed, volAdjusted, or fractionalKelly',
    },
    {
      name: 'kellyFraction',
      type: 'number',
      default: 0.5,
      min: 0.1,
      max: 1.0,
      step: 0.1,
      description: 'Fraction of full Kelly criterion to use (0.5 = half Kelly)',
    },
    {
      name: 'minPositionPct',
      type: 'number',
      default: 15,
      min: 5,
      max: 30,
      step: 5,
      description: 'Minimum position size as % of equity',
    },
    {
      name: 'maxPositionPct',
      type: 'number',
      default: 50,
      min: 20,
      max: 90,
      step: 10,
      description: 'Maximum position size as % of equity',
    },
    {
      name: 'kellySampleSize',
      type: 'number',
      default: 20,
      min: 10,
      max: 50,
      step: 5,
      description: 'Minimum trades before Kelly calculation activates (uses minPositionPct until then)',
    },

    // --- FR Velocity (Enhancement 7: FR Velocity Confirmation) ---
    {
      name: 'useFRVelocity',
      type: 'boolean',
      default: false,
      description: 'Require FR to be reversing (turning) before entry',
    },
    {
      name: 'frVelocityBars',
      type: 'number',
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      description: 'Number of FR periods to look back for FR direction change',
    },
  ] as StrategyParam[],

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    self._trailActive = false;
    self._trailStop = 0;
    self._tradeHistory = [];
    self._lastEntryPrice = 0;
    self._entryATR = 0;
    self._positionSide = null;
    context.log('Initialized funding-rate-spike-v4');
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

    // 1. Extract ALL parameters
    const usePercentile = params.usePercentile as boolean;
    const shortPercentile_ = params.shortPercentile as number;
    const longPercentile_ = params.longPercentile as number;
    const percentileLookback = params.percentileLookback as number;
    const fundingThresholdShort = params.fundingThresholdShort as number;
    const fundingThresholdLong = params.fundingThresholdLong as number;
    const holdingPeriods = params.holdingPeriods as number;
    const useATRStops = params.useATRStops as boolean;
    const atrPeriod = params.atrPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrTPMultiplier = params.atrTPMultiplier as number;
    const stopLossPct = params.stopLossPct as number;
    const takeProfitPct = params.takeProfitPct as number;
    const atrFilterEnabled = params.atrFilterEnabled as boolean;
    const atrFilterThreshold = params.atrFilterThreshold as number;
    const useTrendFilter = params.useTrendFilter as boolean;
    const trendSMAPeriod = params.trendSMAPeriod as number;
    const useTrailingStop = params.useTrailingStop as boolean;
    const trailActivationATR_ = params.trailActivationATR as number;
    const trailDistanceATR_ = params.trailDistanceATR as number;
    const positionSizeMethod = params.positionSizeMethod as string;
    const kellyFraction = params.kellyFraction as number;
    const minPositionPct = params.minPositionPct as number;
    const maxPositionPct = params.maxPositionPct as number;
    const kellySampleSize = params.kellySampleSize as number;
    const positionSizePct = params.positionSizePct as number;
    const useFRVelocity = params.useFRVelocity as boolean;
    const frVelocityBars = params.frVelocityBars as number;

    // 2. Early return if insufficient data
    if (!fundingRates || fundingRates.length === 0) return;
    const minBars = Math.max(trendSMAPeriod, atrPeriod + 1, 50);
    if (currentIndex < minBars) return;

    // 3. Get current FR and calculate thresholds
    const recentRates = fundingRates.filter(fr => fr.timestamp <= currentCandle.timestamp);
    if (recentRates.length === 0) return;
    const latestFR = recentRates[recentRates.length - 1];
    const currentRate = latestFR.fundingRate;

    let shortThreshold: number;
    let longThreshold: number;
    // FR normalization exit thresholds
    // For shorts (entered at > 95th pct): hold until FR drops below 75th pct
    // For longs (entered at < 5th pct): hold until FR rises above 25th pct
    let frNormalShortThreshold: number;
    let frNormalLongThreshold: number;

    if (usePercentile) {
      const lookbackRates = recentRates.slice(-percentileLookback).map(r => r.fundingRate);
      if (lookbackRates.length < 10) return; // Need minimum history
      shortThreshold = calcPercentile(lookbackRates, shortPercentile_);
      longThreshold = calcPercentile(lookbackRates, longPercentile_);
      frNormalShortThreshold = calcPercentile(lookbackRates, 75);
      frNormalLongThreshold = calcPercentile(lookbackRates, 25);
    } else {
      shortThreshold = fundingThresholdShort;
      longThreshold = fundingThresholdLong;
      frNormalShortThreshold = fundingThresholdShort / 2;
      frNormalLongThreshold = fundingThresholdLong / 2;
    }

    // Emit thresholds as chart indicators so the frontend can overlay them
    context.setIndicator('frShortThreshold', shortThreshold);
    context.setIndicator('frLongThreshold', longThreshold);

    // 4. Calculate ATR
    const closes = candleView.closes();
    const highs = candleView.highs();
    const lows = candleView.lows();
    const atrValues = calculateATR(highs, lows, closes, atrPeriod);
    const currentATR = atrValues[atrValues.length - 1];
    if (currentATR === undefined || currentATR <= 0) return;

    // Rolling average ATR over last 50 bars (for volatility filter and vol-adjusted sizing)
    const recentATRs = atrValues.slice(-50).filter((v): v is number => v !== undefined);
    const avgATR = mean(recentATRs);

    // 5. Calculate SMA for trend filter
    const smaValues = calculateSMA(closes, trendSMAPeriod);
    const currentSMA = smaValues[smaValues.length - 1];
    const price = currentCandle.close;

    // Use entry ATR for stop/TP calculations (fixed at the time of entry to prevent adaptive widening)
    // Falls back to currentATR if no position is open (which shouldn't matter in exit code)
    const stopATR = (longPosition || shortPosition) && self._entryATR > 0
      ? self._entryATR
      : currentATR;

    // =========================================================================
    // 6. MANAGE EXISTING POSITIONS (engine handles SL/TP; set levels here)
    //
    // The engine checks SL/TP BEFORE calling onBar(). If SL or TP was triggered
    // on the previous bar's levels, the position is already closed by the time
    // we enter onBar(), so longPosition/shortPosition will be null and we skip
    // these blocks entirely. We still need to call setStopLoss/setTakeProfit on
    // every bar so the engine has fresh levels for the NEXT bar.
    // =========================================================================

    if (longPosition) {
      // a. Calculate and SET SL/TP levels for engine to manage
      if (useATRStops) {
        const stopPrice = longPosition.entryPrice - stopATR * atrStopMultiplier;
        const tpPrice = longPosition.entryPrice + stopATR * atrTPMultiplier;
        context.setStopLoss(stopPrice);
        context.setTakeProfit(tpPrice);
      } else {
        const stopPrice = longPosition.entryPrice * (1 - stopLossPct / 100);
        const tpPrice = longPosition.entryPrice * (1 + takeProfitPct / 100);
        context.setStopLoss(stopPrice);
        context.setTakeProfit(tpPrice);
      }

      // b. Trailing stop for long position (uses CURRENT ATR to adapt trail distance)
      if (useTrailingStop) {
        const unrealizedATRs = (price - longPosition.entryPrice) / currentATR;
        if (unrealizedATRs >= trailActivationATR_) {
          self._trailActive = true;
        }
        if (self._trailActive) {
          // Trail from the highest high seen; stop is below high by trailDistanceATR
          const candidateStop = currentCandle.high - currentATR * trailDistanceATR_;
          if (candidateStop > self._trailStop) {
            self._trailStop = candidateStop; // Ratchet UP only
          }
          // Override the fixed SL with the trailing stop (engine will use this level)
          context.setStopLoss(self._trailStop);
        }
      }

      // c. FR normalization exit: exit long when FR is no longer extremely negative
      // (FR has risen above the 25th percentile -- mean-reversion has occurred)
      // This is a signal-based exit at close price; engine does NOT handle this.
      if (currentRate > frNormalLongThreshold) {
        context.closeLong();
        // Clear SL/TP so engine does not fire on next bar
        context.setStopLoss(null);
        context.setTakeProfit(null);
        resetTrail(self);
        return;
      }

      // d. Time-based exit at close price
      const holdTimeMs = holdingPeriods * 8 * 60 * 60 * 1000;
      if (currentCandle.timestamp - longPosition.entryTime >= holdTimeMs) {
        context.closeLong();
        // Clear SL/TP so engine does not fire on next bar
        context.setStopLoss(null);
        context.setTakeProfit(null);
        resetTrail(self);
        return;
      }

      return; // In long position, do not enter new trades
    }

    if (shortPosition) {
      // a. Calculate and SET SL/TP levels for engine to manage
      if (useATRStops) {
        const stopPrice = shortPosition.entryPrice + stopATR * atrStopMultiplier;
        const tpPrice = shortPosition.entryPrice - stopATR * atrTPMultiplier;
        context.setStopLoss(stopPrice);
        context.setTakeProfit(tpPrice);
      } else {
        const stopPrice = shortPosition.entryPrice * (1 + stopLossPct / 100);
        const tpPrice = shortPosition.entryPrice * (1 - takeProfitPct / 100);
        context.setStopLoss(stopPrice);
        context.setTakeProfit(tpPrice);
      }

      // b. Trailing stop for short position (uses CURRENT ATR to adapt trail distance)
      // Trail from the LOWEST low seen; stop ratchets DOWN
      if (useTrailingStop) {
        const unrealizedATRs = (shortPosition.entryPrice - price) / currentATR;
        if (unrealizedATRs >= trailActivationATR_) {
          self._trailActive = true;
          // Initialize trail stop to a sentinel high value on first activation
          if (self._trailStop === 0) {
            self._trailStop = shortPosition.entryPrice * 10; // large sentinel
          }
        }
        if (self._trailActive) {
          // Candidate stop: above current low by trailDistanceATR
          const candidateStop = currentCandle.low + currentATR * trailDistanceATR_;
          if (candidateStop < self._trailStop) {
            self._trailStop = candidateStop; // Ratchet DOWN only
          }
          // Override the fixed SL with the trailing stop (engine will use this level)
          context.setStopLoss(self._trailStop);
        }
      }

      // c. FR normalization exit: exit short when FR is no longer extremely positive
      // (FR has dropped below the 75th percentile -- mean-reversion has occurred)
      // This is a signal-based exit at close price; engine does NOT handle this.
      if (currentRate < frNormalShortThreshold) {
        context.closeShort();
        // Clear SL/TP so engine does not fire on next bar
        context.setStopLoss(null);
        context.setTakeProfit(null);
        resetTrail(self);
        return;
      }

      // d. Time-based exit at close price
      const holdTimeMs = holdingPeriods * 8 * 60 * 60 * 1000;
      if (currentCandle.timestamp - shortPosition.entryTime >= holdTimeMs) {
        context.closeShort();
        // Clear SL/TP so engine does not fire on next bar
        context.setStopLoss(null);
        context.setTakeProfit(null);
        resetTrail(self);
        return;
      }

      return; // In short position, do not enter new trades
    }

    // =========================================================================
    // 8. ENTRY PIPELINE (no existing position)
    // =========================================================================

    // a. FR signal determination
    let shortSignal = currentRate > shortThreshold;
    let longSignal = currentRate < longThreshold;

    if (!shortSignal && !longSignal) return; // No signal, skip

    // b. FR velocity confirmation (require FR to be reversing)
    if (useFRVelocity && recentRates.length > frVelocityBars) {
      const prevFR = recentRates[recentRates.length - 1 - frVelocityBars].fundingRate;
      if (shortSignal && currentRate >= prevFR) {
        shortSignal = false; // FR still rising or flat, wait for turn
      }
      if (longSignal && currentRate <= prevFR) {
        longSignal = false; // FR still falling or flat, wait for turn
      }
    }

    if (!shortSignal && !longSignal) return;

    // c. ATR volatility filter (skip entries during high-vol regimes)
    if (atrFilterEnabled && avgATR > 0) {
      if (currentATR > atrFilterThreshold * avgATR) {
        return; // Too volatile, skip this entry
      }
    }

    // d. Trend alignment filter
    if (useTrendFilter && currentSMA !== undefined) {
      const isUptrend = price > currentSMA;
      const isDowntrend = price < currentSMA;

      if (shortSignal && isUptrend) {
        return; // Don't short in an uptrend
      }
      if (longSignal && isDowntrend) {
        return; // Don't go long in a downtrend
      }
    }

    // e. Calculate position size
    let positionPct: number;

    if (positionSizeMethod === 'volAdjusted' && avgATR > 0) {
      // Scale inversely with volatility: calmer = larger position, volatile = smaller
      const volRatio = avgATR / currentATR;
      positionPct = clamp(positionSizePct * volRatio, minPositionPct, maxPositionPct);
    } else if (positionSizeMethod === 'fractionalKelly') {
      const tradeHist = self._tradeHistory || [];
      if (tradeHist.length < kellySampleSize) {
        positionPct = minPositionPct; // Conservative until enough trade history
      } else {
        const recent = tradeHist.slice(-50);
        const wins = recent.filter(t => t.pnlPct > 0);
        const losses = recent.filter(t => t.pnlPct <= 0);
        if (losses.length === 0 || wins.length === 0) {
          positionPct = minPositionPct;
        } else {
          const W = wins.length / recent.length;
          const avgWin = mean(wins.map(t => t.pnlPct));
          const avgLoss = Math.abs(mean(losses.map(t => t.pnlPct)));
          const R = avgLoss > 0 ? avgWin / avgLoss : 1;
          let kellyPct = W - (1 - W) / R;
          kellyPct = Math.max(0, kellyPct);
          positionPct = clamp(kellyPct * kellyFraction * 100, minPositionPct, maxPositionPct);
        }
      }
    } else {
      // Fixed sizing (clamped to min/max)
      positionPct = clamp(positionSizePct, minPositionPct, maxPositionPct);
    }

    const positionValue = (equity * positionPct) / 100;
    const positionSize = positionValue / price;
    if (positionSize <= 0) return;

    // f. Execute entry, store ATR at entry for fixed stop/TP calculations.
    //    Entry price (_lastEntryPrice) is captured in onOrderFilled() using the
    //    actual fill price (which includes slippage), not the candle close.
    if (shortSignal) {
      context.openShort(positionSize);
      self._entryATR = currentATR;
      self._positionSide = 'short';
      resetTrail(self);
    } else if (longSignal) {
      context.openLong(positionSize);
      self._entryATR = currentATR;
      self._positionSide = 'long';
      resetTrail(self);
    }
  },

  onOrderFilled(context: StrategyContext, order: Order): void {
    const self = this as unknown as StrategyState;

    if (!order.filledPrice) return;

    const hasPosition = !!(context.longPosition || context.shortPosition);

    if (hasPosition && self._lastEntryPrice === 0) {
      // Entry order just filled — capture the actual fill price (includes slippage)
      self._lastEntryPrice = order.filledPrice;
    } else if (!hasPosition && self._lastEntryPrice > 0) {
      // Exit order just filled — record trade for Kelly sizing, then reset
      // Determine which side was closed: sell order closes long; buy order closes short
      const closedSide = order.side === 'sell' ? 'long' : 'short';
      recordTrade(self, self._lastEntryPrice, order.filledPrice, closedSide);
      resetTrail(self);
      self._lastEntryPrice = 0;
      self._positionSide = null;
    }
  },

  onEnd(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    // Close any remaining open positions at end of backtest
    if (context.longPosition) {
      context.closeLong();
    }
    if (context.shortPosition) {
      context.closeShort();
    }
    // Clear engine-managed SL/TP
    context.setStopLoss(null);
    context.setTakeProfit(null);
    // Reset state
    resetTrail(self);
    self._lastEntryPrice = 0;
    self._positionSide = null;
  },
};

export default strategy;
