/**
 * BB-RSI Mean-Reversion Scalper
 *
 * Trades mean-reversion when price touches or exceeds Bollinger Band extremes,
 * confirmed by RSI divergence and a volume spike. Designed for 1-minute candles
 * on futures markets with leverage.
 *
 * Core edge:
 * Crypto markets frequently overshoot on short timeframes. When price hits a BB
 * extreme with RSI confirmation and a volume surge, a quick reversion trade back
 * toward the BB middle band (SMA) is high-probability.
 *
 * Entry conditions:
 *   LONG  — close <= lowerBB * (1 + bbEntryPct/100), RSI < rsiOversold, volume spike
 *   SHORT — close >= upperBB * (1 - bbEntryPct/100), RSI > rsiOverbought, volume spike
 *
 * Exit rules (first hit wins):
 *   1. BB Middle (SMA) crossover  → primary profit target
 *   2. ATR stop-loss              → hard risk limit
 *   3. Time-based exit            → maxHoldBars forced close
 *   4. Trailing stop              → activated after trailActivationPct move in favour
 *
 * Regime filter:
 *   Only trade when BBWidth/price > minBBWidth (ensures sufficient volatility)
 */

import ti from 'technicalindicators';
const { BollingerBands, RSI, ATR } = ti;
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Internal State
// ============================================================================

interface StrategyState {
  /** Entry price of the current open position */
  _entryPrice: number;
  /** Bar index at entry */
  _entryBarIndex: number;
  /** Direction of current open trade */
  _side: 'long' | 'short' | null;
  /** Trailing stop price (0 = not yet active) */
  _trailPrice: number;
  /** Whether the trailing stop has been activated */
  _trailActive: boolean;
  /** Cooldown counter (bars remaining before next entry is allowed) */
  _cooldownBarsLeft: number;
}

// ============================================================================
// Helpers
// ============================================================================

function resetPosition(self: StrategyState): void {
  self._entryPrice = 0;
  self._entryBarIndex = -1;
  self._side = null;
  self._trailPrice = 0;
  self._trailActive = false;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'bb-rsi-scalper',
  description:
    'Mean-reversion scalper that enters when price touches BB extremes with RSI confirmation and a volume spike, targeting a reversion to the BB middle band. Optimised for 1m futures.',
  version: '1.0.0',

  params: [
    // --- Bollinger Bands ---
    {
      name: 'bbPeriod',
      label: 'BB Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 30,
      step: 5,
      description: 'Bollinger Band SMA period',
    },
    {
      name: 'bbStdDev',
      label: 'BB Std Dev',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.25,
      description: 'Bollinger Band standard deviation multiplier',
    },
    {
      name: 'bbEntryPct',
      label: 'BB Entry %',
      type: 'number',
      default: 0.0,
      min: 0.0,
      max: 0.5,
      step: 0.1,
      description:
        'How close to BB edge price must be to trigger entry (0 = must touch/exceed band)',
    },
    // --- RSI ---
    {
      name: 'rsiPeriod',
      label: 'RSI Period',
      type: 'number',
      default: 14,
      min: 7,
      max: 21,
      step: 7,
      description: 'RSI calculation period',
    },
    {
      name: 'rsiOversold',
      label: 'RSI Oversold',
      type: 'number',
      default: 25,
      min: 15,
      max: 35,
      step: 5,
      description: 'RSI oversold threshold — required for long entries',
    },
    {
      name: 'rsiOverbought',
      label: 'RSI Overbought',
      type: 'number',
      default: 75,
      min: 65,
      max: 85,
      step: 5,
      description: 'RSI overbought threshold — required for short entries',
    },
    // --- ATR Stop ---
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 2,
      description: 'ATR period for stop-loss calculation',
    },
    {
      name: 'atrStopMult',
      label: 'ATR Stop Multiplier',
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      step: 0.25,
      description: 'Stop-loss distance as ATR multiplier from entry price',
    },
    // --- Position Sizing ---
    {
      name: 'capitalFraction',
      label: 'Capital Fraction',
      type: 'number',
      default: 0.3,
      min: 0.1,
      max: 0.5,
      step: 0.05,
      description: 'Fraction of equity to allocate per trade (before leverage)',
    },
    {
      name: 'leverage',
      label: 'Leverage',
      type: 'number',
      default: 3,
      min: 2,
      max: 10,
      step: 1,
      description: 'Leverage multiplier',
    },
    // --- Time & Cooldown ---
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 20,
      min: 10,
      max: 60,
      step: 5,
      description: 'Maximum holding period in 1m bars before forced exit',
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      description: 'Minimum bars between trades (cooldown after close)',
    },
    // --- Volume Filter ---
    {
      name: 'volumeMultiplier',
      label: 'Volume Multiplier',
      type: 'number',
      default: 1.2,
      min: 0.8,
      max: 2.0,
      step: 0.2,
      description: 'Volume spike threshold: volume must exceed this × avgVolume',
    },
    {
      name: 'volumeAvgPeriod',
      label: 'Volume Avg Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 50,
      step: 10,
      description: 'Period for computing average volume',
    },
    // --- Trailing Stop ---
    {
      name: 'trailActivationPct',
      label: 'Trail Activation %',
      type: 'number',
      default: 0.3,
      min: 0.1,
      max: 1.0,
      step: 0.1,
      description: '% price move in favour required to activate trailing stop',
    },
    {
      name: 'trailDistancePct',
      label: 'Trail Distance %',
      type: 'number',
      default: 0.15,
      min: 0.05,
      max: 0.5,
      step: 0.05,
      description: 'Trailing stop distance as % of current price',
    },
    // --- Regime Filter ---
    {
      name: 'minBBWidth',
      label: 'Min BB Width',
      type: 'number',
      default: 0.001,
      min: 0.0005,
      max: 0.005,
      step: 0.0005,
      description:
        'Minimum BB width / price ratio. Filters out flat regimes with insufficient volatility.',
    },
  ] as StrategyParam[],

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    resetPosition(self);
    self._cooldownBarsLeft = 0;
    context.log('Initialized bb-rsi-scalper');
  },

  onBar(context: StrategyContext): void {
    const { longPosition, shortPosition, equity, currentCandle, currentIndex, params, candleView } =
      context;

    const self = this as unknown as StrategyState;

    // =========================================================================
    // 1. Extract parameters
    // =========================================================================

    const bbPeriod = params.bbPeriod as number;
    const bbStdDev = params.bbStdDev as number;
    const bbEntryPct = params.bbEntryPct as number;
    const rsiPeriod = params.rsiPeriod as number;
    const rsiOversold = params.rsiOversold as number;
    const rsiOverbought = params.rsiOverbought as number;
    const atrPeriod = params.atrPeriod as number;
    const atrStopMult = params.atrStopMult as number;
    const capitalFraction = params.capitalFraction as number;
    const leverage = params.leverage as number;
    const maxHoldBars = params.maxHoldBars as number;
    const cooldownBars = params.cooldownBars as number;
    const volumeMultiplier = params.volumeMultiplier as number;
    const volumeAvgPeriod = params.volumeAvgPeriod as number;
    const trailActivationPct = params.trailActivationPct as number;
    const trailDistancePct = params.trailDistancePct as number;
    const minBBWidth = params.minBBWidth as number;

    // =========================================================================
    // 2. Warm-up guard
    //    Need enough bars for all indicators to produce a result.
    // =========================================================================

    const minBars = Math.max(bbPeriod, rsiPeriod + 1, atrPeriod + 1, volumeAvgPeriod) + 5;
    if (currentIndex < minBars) return;

    // =========================================================================
    // 3. Build bounded window slice for indicator calculation (O(maxLookback)).
    //    50 bars is sufficient for all indicators at default settings.
    // =========================================================================

    const maxLookback = Math.max(bbPeriod, rsiPeriod + 1, atrPeriod + 1, volumeAvgPeriod) + 20;
    const startIdx = Math.max(0, currentIndex - maxLookback);
    const windowCandles = candleView.slice(startIdx, currentIndex + 1);

    const windowCloses = windowCandles.map(c => c.close);
    const windowHighs = windowCandles.map(c => c.high);
    const windowLows = windowCandles.map(c => c.low);
    const windowVolumes = windowCandles.map(c => c.volume);

    // =========================================================================
    // 4. Compute indicators
    // =========================================================================

    // --- Bollinger Bands ---
    const bbResult = BollingerBands.calculate({
      values: windowCloses,
      period: bbPeriod,
      stdDev: bbStdDev,
    });
    if (bbResult.length === 0) return;

    const latestBB = bbResult[bbResult.length - 1];
    const { upper: upperBand, middle: middleBand, lower: lowerBand } = latestBB;
    if (middleBand <= 0) return;

    // BB width ratio (regime filter)
    const bbWidth = (upperBand - lowerBand) / middleBand;

    // --- RSI ---
    const rsiResult = RSI.calculate({ values: windowCloses, period: rsiPeriod });
    if (rsiResult.length === 0) return;
    const currentRSI = rsiResult[rsiResult.length - 1];
    if (currentRSI === undefined) return;

    // --- ATR ---
    const atrResult = ATR.calculate({
      high: windowHighs,
      low: windowLows,
      close: windowCloses,
      period: atrPeriod,
    });
    if (atrResult.length === 0) return;
    const currentATR = atrResult[atrResult.length - 1];
    if (currentATR === undefined || currentATR <= 0) return;

    // --- Volume average (simple mean over volumeAvgPeriod) ---
    const volSlice = windowVolumes.slice(
      Math.max(0, windowVolumes.length - volumeAvgPeriod - 1),
      windowVolumes.length - 1 // exclude current bar from average
    );
    const avgVolume =
      volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0;

    // =========================================================================
    // 5. Decrement cooldown counter
    // =========================================================================

    if (self._cooldownBarsLeft > 0) {
      self._cooldownBarsLeft -= 1;
    }

    const price = currentCandle.close;

    // =========================================================================
    // 6. EXITS — evaluate before entries
    // =========================================================================

    if (longPosition) {
      const entryPrice = self._entryPrice > 0 ? self._entryPrice : longPosition.entryPrice;
      const barsHeld = currentIndex - self._entryBarIndex;

      // a. ATR stop-loss: close below entryPrice - atrStopMult * ATR
      const slPrice = entryPrice - atrStopMult * currentATR;
      if (price <= slPrice) {
        context.closeLong();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      // b. BB Middle (SMA) target: price crosses at or above middle band
      if (price >= middleBand) {
        context.closeLong();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      // c. Trailing stop
      const priceMoveUp = price - entryPrice;
      const activationThreshold = (trailActivationPct / 100) * entryPrice;
      if (priceMoveUp >= activationThreshold) {
        self._trailActive = true;
      }
      if (self._trailActive) {
        const trailDist = (trailDistancePct / 100) * price;
        const candidateTrail = price - trailDist;
        if (!self._trailPrice || candidateTrail > self._trailPrice) {
          self._trailPrice = candidateTrail;
        }
        if (price <= self._trailPrice) {
          context.closeLong();
          resetPosition(self);
          self._cooldownBarsLeft = cooldownBars;
          return;
        }
      }

      // d. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeLong();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      return; // Holding long — skip entry logic
    }

    if (shortPosition) {
      const entryPrice = self._entryPrice > 0 ? self._entryPrice : shortPosition.entryPrice;
      const barsHeld = currentIndex - self._entryBarIndex;

      // a. ATR stop-loss: close above entryPrice + atrStopMult * ATR
      const slPrice = entryPrice + atrStopMult * currentATR;
      if (price >= slPrice) {
        context.closeShort();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      // b. BB Middle (SMA) target: price crosses at or below middle band
      if (price <= middleBand) {
        context.closeShort();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      // c. Trailing stop
      const priceMoveDown = entryPrice - price;
      const activationThreshold = (trailActivationPct / 100) * entryPrice;
      if (priceMoveDown >= activationThreshold) {
        self._trailActive = true;
      }
      if (self._trailActive) {
        const trailDist = (trailDistancePct / 100) * price;
        const candidateTrail = price + trailDist;
        // For shorts the trail ratchets downward (lower = better)
        if (self._trailPrice === 0 || candidateTrail < self._trailPrice) {
          self._trailPrice = candidateTrail;
        }
        if (price >= self._trailPrice) {
          context.closeShort();
          resetPosition(self);
          self._cooldownBarsLeft = cooldownBars;
          return;
        }
      }

      // d. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeShort();
        resetPosition(self);
        self._cooldownBarsLeft = cooldownBars;
        return;
      }

      return; // Holding short — skip entry logic
    }

    // =========================================================================
    // 7. ENTRIES
    // =========================================================================

    // No open position: check entry conditions

    // Cooldown guard
    if (self._cooldownBarsLeft > 0) return;

    // Regime filter: require minimum BB width
    if (bbWidth < minBBWidth) return;

    // Volume spike check
    const volumeOk = avgVolume > 0 && currentCandle.volume > volumeMultiplier * avgVolume;
    if (!volumeOk) return;

    // BB entry thresholds (bbEntryPct allows entering slightly inside the band)
    // bbEntryPct is treated as a percentage, e.g. 0.1 means 0.1% inside the band
    const entryBuffer = bbEntryPct / 100;
    const longEntryLevel = lowerBand * (1 + entryBuffer);   // slightly above lower band
    const shortEntryLevel = upperBand * (1 - entryBuffer);  // slightly below upper band

    const longSignal = price <= longEntryLevel && currentRSI < rsiOversold;
    const shortSignal = price >= shortEntryLevel && currentRSI > rsiOverbought;

    if (!longSignal && !shortSignal) return;

    // Position sizing: equity * capitalFraction * leverage / price
    const positionSize = (equity * capitalFraction * leverage) / price;
    if (positionSize <= 0) return;

    if (longSignal) {
      context.openLong(positionSize);
      self._entryPrice = price;
      self._entryBarIndex = currentIndex;
      self._side = 'long';
      self._trailPrice = 0;
      self._trailActive = false;
    } else if (shortSignal) {
      context.openShort(positionSize);
      self._entryPrice = price;
      self._entryBarIndex = currentIndex;
      self._side = 'short';
      self._trailPrice = 0;
      self._trailActive = false;
    }
  },

  onEnd(context?: StrategyContext): void {
    if (!context) return;
    if (context.longPosition) {
      context.closeLong();
    }
    if (context.shortPosition) {
      context.closeShort();
    }
    const self = this as unknown as StrategyState;
    resetPosition(self);
  },
};

export default strategy;
