/**
 * FR Regime Momentum Rider
 *
 * Architecture: 4h FR REGIME → 5m ENTRY → 5m EXIT
 *
 * Uses funding rate data (arriving every 8h) as a regime filter.
 * When FR exceeds an absolute threshold (e.g., |FR| > 0.0003 = 0.03%),
 * the subsequent mean-reversion creates a multi-hour directional move.
 * We use 5m EMA crossovers to time entries within that regime window,
 * giving better entries than the 4h FR V2 strategy (tighter stops, higher R:R).
 *
 * FR Regime Detection (absolute threshold, not percentile-based):
 *   - Regime ACTIVE when |currentFR| > frAbsThreshold
 *   - On Bybit, 0.0001 is the default cap (not extreme); 0.0003+ is genuinely extreme
 *   - Direction: FR > 0 → SHORT regime (longs paying, ripe for reversal)
 *                FR < 0 → LONG regime (shorts paying, ripe for squeeze)
 *
 * Entry:
 *   1. FR regime active (|FR| > frAbsThreshold)
 *   2. EMA(fast) crosses EMA(slow) in regime direction
 *   3. Price above SMA(trendSMAPeriod) for longs / below for shorts
 *   4. No existing position
 *
 * Exit (any of):
 *   1. ATR stop-loss (slAtrMultiplier × ATR at entry)
 *   2. ATR take-profit (tpAtrMultiplier × ATR at entry)
 *   3. Time exit (timeExitBars bars)
 *   4. Regime exit (|FR| drops below frAbsThreshold × frExitRatio)
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data: run scripts/cache-funding-rates.ts first
 */

import ti from 'technicalindicators';
const { EMA, SMA, ATR } = ti;
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Internal State
// ============================================================================

interface StrategyState {
  /** Bar index at which the current position was opened */
  _entryBar: number;
  /** Entry price of the current position */
  _entryPrice: number;
  /** Direction of the current position, or null if flat */
  _direction: 'long' | 'short' | null;
  /** ATR value at the time of entry (used for fixed stop/TP levels) */
  _atrAtEntry: number;
  /**
   * Running index into the fundingRates array pointing to the last entry
   * whose timestamp is <= the current candle.  Maintained incrementally for
   * O(1) amortised lookup instead of scanning the full array every bar.
   */
  _lastFRIndex: number;
  /**
   * Bar index after which re-entry is allowed. Set to currentIndex + cooldownBars
   * after a position closes.
   */
  _cooldownUntil: number;
  /** Whether this is the very first entry attempt (for debug logging) */
  _firstEntryLogged: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate EMA values padded to align index with candles array.
 * Returns undefined for bars where insufficient history exists.
 */
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = EMA.calculate({ values: closes, period, reversedInput: false });
  // EMA with period P produces (closes.length - period + 1) values
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

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

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'fr-regime-momentum',
  description:
    'Uses 4h funding rate absolute threshold as a regime filter and 5m EMA crossovers for entry timing. ' +
    'When |FR| exceeds frAbsThreshold (e.g., 0.0003 = 0.03%), momentum entries on 5m achieve ' +
    'tighter stops and better R:R than the 4h FR V2 strategy. Exits via ATR stop/TP, time limit, ' +
    'or FR normalization below frAbsThreshold * frExitRatio. Requires futures mode with cached funding rates.',
  version: '2.0.0',

  params: [
    {
      name: 'frAbsThreshold',
      type: 'number',
      default: 0.0003,
      min: 0.0001,
      max: 0.001,
      step: 0.0001,
      description: 'Absolute FR value threshold for regime activation (e.g., 0.0003 = 0.03%)',
    },
    {
      name: 'frExitRatio',
      type: 'number',
      default: 0.5,
      min: 0.3,
      max: 0.8,
      step: 0.1,
      description: 'Exit when FR drops below frAbsThreshold * this ratio (e.g., 0.5 = half the entry threshold)',
    },
    {
      name: 'fastEmaPeriod',
      type: 'number',
      default: 8,
      min: 5,
      max: 13,
      step: 3,
      description: 'Fast EMA period for entry crossover signal',
    },
    {
      name: 'slowEmaPeriod',
      type: 'number',
      default: 21,
      min: 15,
      max: 30,
      step: 5,
      description: 'Slow EMA period for entry crossover signal',
    },
    {
      name: 'trendSmaPeriod',
      type: 'number',
      default: 50,
      min: 30,
      max: 80,
      step: 10,
      description: 'SMA period for trend filter (price above = uptrend, below = downtrend)',
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
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'Take profit distance in ATR units (measured from entry price)',
    },
    {
      name: 'slAtrMultiplier',
      type: 'number',
      default: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.5,
      description: 'Stop loss distance in ATR units (measured from entry price)',
    },
    {
      name: 'timeExitBars',
      type: 'number',
      default: 36,
      min: 12,
      max: 72,
      step: 12,
      description: 'Maximum bars to hold a position before forced time exit (e.g. 36 = 3h on 5m)',
    },
    {
      name: 'cooldownBars',
      type: 'number',
      default: 6,
      min: 0,
      max: 48,
      step: 6,
      description: 'Bars to wait after closing a position before re-entry is allowed (e.g. 6 = 30min on 5m)',
    },
    {
      name: 'positionSizePct',
      type: 'number',
      default: 95,
      min: 50,
      max: 100,
      step: 25,
      description: 'Position size as percentage of available capital',
    },
    {
      name: 'leverage',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      step: 5,
      description: 'Leverage multiplier applied to position size',
    },
  ] as StrategyParam[],

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    self._entryBar = -1;
    self._entryPrice = 0;
    self._direction = null;
    self._atrAtEntry = 0;
    self._lastFRIndex = 0;
    self._cooldownUntil = -1;
    self._firstEntryLogged = false;
    context.log('Initialized fr-regime-momentum v2 (absolute FR threshold)');
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
    const frAbsThreshold = params.frAbsThreshold as number;
    const frExitRatio = params.frExitRatio as number;
    const fastEmaPeriod = params.fastEmaPeriod as number;
    const slowEmaPeriod = params.slowEmaPeriod as number;
    const trendSmaPeriod = params.trendSmaPeriod as number;
    const atrPeriod = params.atrPeriod as number;
    const tpAtrMultiplier = params.tpAtrMultiplier as number;
    const slAtrMultiplier = params.slAtrMultiplier as number;
    const timeExitBars = params.timeExitBars as number;
    const cooldownBars = params.cooldownBars as number;
    const positionSizePct = params.positionSizePct as number;
    const leverage = params.leverage as number;

    // =========================================================================
    // 2. Require funding rate data
    // =========================================================================
    if (!fundingRates || fundingRates.length === 0) return;

    // =========================================================================
    // 3. Minimum bar warmup: need enough bars for all indicators
    // =========================================================================
    const maxLookback = Math.max(slowEmaPeriod, trendSmaPeriod) + 20;
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
    // 5. FR Regime Detection (absolute threshold)
    // =========================================================================
    const frEndIdx = self._lastFRIndex;
    const currentFR = fundingRates[frEndIdx].fundingRate;
    const absCurrentFR = Math.abs(currentFR);

    // Regime is active when |FR| exceeds the absolute threshold
    const regimeActive = absCurrentFR > frAbsThreshold;
    const regimeDirection: 'long' | 'short' | null = regimeActive
      ? currentFR > 0
        ? 'short'  // Longs paying → contrarian short (FR will revert down)
        : 'long'   // Shorts paying → contrarian long (FR will revert up)
      : null;

    // Exit threshold: FR dropped below frAbsThreshold * frExitRatio
    const frExitThreshold = frAbsThreshold * frExitRatio;
    const frRegimeGone = absCurrentFR < frExitThreshold;

    // =========================================================================
    // 6. Windowed indicator calculations (O(n×window) not O(n²))
    // =========================================================================
    const windowSize = maxLookback;
    const startIdx = Math.max(0, currentIndex - windowSize + 1);
    const windowCandles = candleView.slice(startIdx);

    const closes = windowCandles.map(c => c.close);
    const highs = windowCandles.map(c => c.high);
    const lows = windowCandles.map(c => c.low);

    const fastEMAArr = calculateEMA(closes, fastEmaPeriod);
    const slowEMAArr = calculateEMA(closes, slowEmaPeriod);
    const trendSMAArr = calculateSMA(closes, trendSmaPeriod);
    const atrArr = calculateATR(highs, lows, closes, atrPeriod);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;

    const fastEMANow = fastEMAArr[lastIdx];
    const slowEMANow = slowEMAArr[lastIdx];
    const fastEMAPrev = fastEMAArr[prevIdx];
    const slowEMAPrev = slowEMAArr[prevIdx];
    const currentSMA = trendSMAArr[lastIdx];
    const currentATR = atrArr[lastIdx];

    // Require all indicators to be available
    if (
      fastEMANow === undefined ||
      slowEMANow === undefined ||
      fastEMAPrev === undefined ||
      slowEMAPrev === undefined ||
      currentSMA === undefined ||
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
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // b. Take-profit: triggered when candle HIGH reaches TP level
      const tpPrice = longPosition.entryPrice + entryATR * tpAtrMultiplier;
      if (currentCandle.high >= tpPrice) {
        context.closeLong();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // c. Time exit: close after timeExitBars bars
      if (self._entryBar >= 0 && currentIndex - self._entryBar >= timeExitBars) {
        context.closeLong();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // d. Regime exit: FR dropped below exit threshold — the edge has dissolved
      if (frRegimeGone) {
        context.closeLong();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
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
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // b. Take-profit: triggered when candle LOW reaches TP level
      const tpPrice = shortPosition.entryPrice - entryATR * tpAtrMultiplier;
      if (currentCandle.low <= tpPrice) {
        context.closeShort();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // c. Time exit
      if (self._entryBar >= 0 && currentIndex - self._entryBar >= timeExitBars) {
        context.closeShort();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      // d. Regime exit
      if (frRegimeGone) {
        context.closeShort();
        self._direction = null;
        self._cooldownUntil = currentIndex + cooldownBars;
        return;
      }

      return; // In short position, skip entry logic
    }

    // =========================================================================
    // 8. ENTRY PIPELINE (no existing position)
    // =========================================================================

    // Gate 1: Regime must be active (|FR| > frAbsThreshold)
    if (!regimeActive || regimeDirection === null) return;

    // Gate 1b: Cooldown — must wait N bars after last close before re-entry
    if (currentIndex <= self._cooldownUntil) return;

    // Gate 2: EMA crossover in the regime direction
    //   Long regime → fast crosses ABOVE slow (bullish crossover)
    //   Short regime → fast crosses BELOW slow (bearish crossover)
    const crossedAbove = fastEMAPrev <= slowEMAPrev && fastEMANow > slowEMANow;
    const crossedBelow = fastEMAPrev >= slowEMAPrev && fastEMANow < slowEMANow;

    const emaCrossConfirmed =
      (regimeDirection === 'long' && crossedAbove) ||
      (regimeDirection === 'short' && crossedBelow);

    if (!emaCrossConfirmed) return;

    // Gate 3: Trend filter — price above SMA for longs, below for shorts
    const trendAligned =
      (regimeDirection === 'long' && price > currentSMA) ||
      (regimeDirection === 'short' && price < currentSMA);

    if (!trendAligned) return;

    // =========================================================================
    // 9. Position sizing and entry execution
    // =========================================================================
    // Note: leverage param is passed through to engine config externally.
    // Strategy sizes based on available equity only (no internal multiplication).
    const positionValue = (equity * positionSizePct) / 100;
    const positionSize = positionValue / price;
    void leverage; // leverage is passed to engine via CLI --leverage flag
    if (positionSize <= 0) return;

    // Debug: log first entry attempt to confirm signals are reaching execution
    if (!self._firstEntryLogged) {
      context.log(
        `[DEBUG] First entry: bar=${currentIndex} dir=${regimeDirection} ` +
        `price=${price.toFixed(4)} atr=${currentATR.toFixed(6)} ` +
        `frAbs=${absCurrentFR.toFixed(6)} threshold=${frAbsThreshold.toFixed(6)}`
      );
      self._firstEntryLogged = true;
    }

    if (regimeDirection === 'long') {
      context.openLong(positionSize);
      self._direction = 'long';
      self._entryBar = currentIndex;
      self._entryPrice = price;
      self._atrAtEntry = currentATR;
    } else {
      context.openShort(positionSize);
      self._direction = 'short';
      self._entryBar = currentIndex;
      self._entryPrice = price;
      self._atrAtEntry = currentATR;
    }
  },

  onEnd(context?: StrategyContext): void {
    const self = this as unknown as StrategyState;
    if (context) {
      if (context.longPosition) context.closeLong();
      if (context.shortPosition) context.closeShort();
    }
    self._direction = null;
  },
};

export default strategy;
