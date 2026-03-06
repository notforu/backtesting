/**
 * Funding Rate Settlement Window Scalper
 *
 * Core idea: Before each 8-hour funding settlement (00:00, 08:00, 16:00 UTC),
 * traders with extreme funding positions are forced to close or hedge. This
 * creates predictable short-term price pressure. We fade this forced flow.
 *
 * Signal logic:
 *   - Detect when we are within N minutes of a settlement window.
 *   - Check if the current funding rate is in an extreme percentile.
 *   - Confirm with SMA(20) for mean-reversion direction and RSI(14) for
 *     oversold/overbought conditions.
 *   - Long: high positive FR + price below SMA + RSI oversold → buy the forced selling.
 *   - Short: high negative FR + price above SMA + RSI overbought → sell the forced buying.
 *
 * Exits: take profit %, stop loss %, or time-based (timeExitBars).
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data cached for the symbol/timeframe.
 */

import ti from 'technicalindicators';
const { SMA, RSI } = ti;
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Internal State
// ============================================================================

interface StrategyState {
  /** Entry price of the current open position */
  _entryPrice: number;
  /** Bar index at which current position was opened */
  _entryBarIndex: number;
  /** Whether a position is currently open ('long' | 'short' | 'none') */
  _side: 'long' | 'short' | 'none';
  /**
   * Running index into the fundingRates array pointing to the last entry whose
   * timestamp is <= the current candle.  Maintained incrementally so we never
   * scan the full array on every bar (O(n) → O(1) amortised).
   */
  _lastFRIndex: number;
}

// ============================================================================
// Helpers
// ============================================================================

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

/**
 * Calculate SMA values padded to align index with candles array.
 * Returns undefined for bars where insufficient history exists.
 */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = SMA.calculate({ values: closes, period });
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate RSI values padded to align index with candles array.
 * RSI needs (period + 1) candles to produce the first value.
 */
function calculateRSI(closes: number[], period: number): (number | undefined)[] {
  if (closes.length <= period) return new Array(closes.length).fill(undefined);
  const result = RSI.calculate({ values: closes, period });
  // RSI produces (closes.length - period) values; needs `period` bars of padding
  const padding = new Array(period).fill(undefined);
  return [...padding, ...result];
}

/**
 * Determine how many minutes remain until the next funding settlement.
 * Settlement times: 00:00, 08:00, 16:00 UTC.
 *
 * Returns Infinity if next settlement is far away (> any reasonable window).
 */
function minutesToNextSettlement(timestampMs: number): number {
  const date = new Date(timestampMs);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Settlement times in minutes since midnight UTC: 0, 480, 960.
  // Also include 1440 (midnight next day) as the next wrap-around settlement.
  const settlementMinutes = [0, 480, 960, 1440];

  let minToSettlement = Infinity;
  for (const sm of settlementMinutes) {
    const diff = sm - totalMinutes;
    if (diff > 0 && diff < minToSettlement) {
      minToSettlement = diff;
    }
  }
  return minToSettlement;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'fr-settlement-scalper',
  description:
    'Fades forced flow before 8-hour funding settlements. Enters when FR is at extreme percentile ' +
    'and price shows mean-reversion setup (SMA + RSI). Exits via take profit, stop loss, or time limit.',
  version: '1.0.0',

  params: [
    {
      name: 'settlementWindowMinutes',
      type: 'number',
      default: 45,
      min: 15,
      max: 120,
      step: 5,
      description: 'Minutes before settlement to start looking for entries',
    },
    {
      name: 'frPercentileThreshold',
      type: 'number',
      default: 85,
      min: 70,
      max: 95,
      step: 5,
      description: 'FR percentile threshold for entry (how extreme FR must be)',
    },
    {
      name: 'frLookbackPeriods',
      type: 'number',
      default: 90,
      min: 30,
      max: 365,
      step: 10,
      description: 'Number of FR observations for percentile calculation',
    },
    {
      name: 'rsiPeriod',
      type: 'number',
      default: 14,
      min: 7,
      max: 21,
      step: 1,
      description: 'RSI calculation period',
    },
    {
      name: 'rsiEntry',
      type: 'number',
      default: 30,
      min: 20,
      max: 40,
      step: 5,
      description: 'RSI threshold for long entry (100-rsiEntry for short)',
    },
    {
      name: 'smaPeriod',
      type: 'number',
      default: 20,
      min: 10,
      max: 50,
      step: 5,
      description: 'SMA period for mean reversion direction',
    },
    {
      name: 'takeProfitPct',
      type: 'number',
      default: 0.15,
      min: 0.05,
      max: 0.50,
      step: 0.05,
      description: 'Take profit as % of price',
    },
    {
      name: 'stopLossPct',
      type: 'number',
      default: 0.20,
      min: 0.10,
      max: 0.50,
      step: 0.05,
      description: 'Stop loss as % of price',
    },
    {
      name: 'timeExitBars',
      type: 'number',
      default: 15,
      min: 5,
      max: 60,
      step: 5,
      description: 'Max hold time in bars (intended for 1m bars = minutes)',
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
    self._entryPrice = 0;
    self._entryBarIndex = 0;
    self._side = 'none';
    self._lastFRIndex = 0;
    context.log('Initialized fr-settlement-scalper');
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
    const settlementWindowMinutes = params.settlementWindowMinutes as number;
    const frPercentileThreshold = params.frPercentileThreshold as number;
    const frLookbackPeriods = params.frLookbackPeriods as number;
    const rsiPeriod = params.rsiPeriod as number;
    const rsiEntry = params.rsiEntry as number;
    const smaPeriod = params.smaPeriod as number;
    const takeProfitPct = params.takeProfitPct as number;
    const stopLossPct = params.stopLossPct as number;
    const timeExitBars = params.timeExitBars as number;
    const positionSizePct = params.positionSizePct as number;
    const leverage = params.leverage as number;

    // =========================================================================
    // 2. Early return if insufficient data or no funding rates
    // =========================================================================
    if (!fundingRates || fundingRates.length === 0) return;

    const minBars = Math.max(smaPeriod, rsiPeriod + 1);
    if (currentIndex < minBars) return;

    const price = currentCandle.close;

    // =========================================================================
    // 3. MANAGE EXISTING POSITIONS (exits checked before entries)
    // =========================================================================

    if (longPosition) {
      const worstPnlPct =
        ((currentCandle.low - longPosition.entryPrice) / longPosition.entryPrice) * 100;
      const bestPnlPct =
        ((currentCandle.high - longPosition.entryPrice) / longPosition.entryPrice) * 100;

      // Stop loss — use candle low (worst intrabar price for longs)
      if (worstPnlPct <= -stopLossPct) {
        context.closeLong();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      // Take profit — use candle high (best intrabar price for longs)
      if (bestPnlPct >= takeProfitPct) {
        context.closeLong();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      // Time-based exit
      const barsHeld = currentIndex - self._entryBarIndex;
      if (barsHeld >= timeExitBars) {
        context.closeLong();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      return; // In long position, no new entries
    }

    if (shortPosition) {
      const worstPnlPct =
        ((shortPosition.entryPrice - currentCandle.high) / shortPosition.entryPrice) * 100;
      const bestPnlPct =
        ((shortPosition.entryPrice - currentCandle.low) / shortPosition.entryPrice) * 100;

      // Stop loss — use candle high (worst intrabar price for shorts)
      if (worstPnlPct <= -stopLossPct) {
        context.closeShort();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      // Take profit — use candle low (best intrabar price for shorts)
      if (bestPnlPct >= takeProfitPct) {
        context.closeShort();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      // Time-based exit
      const barsHeld = currentIndex - self._entryBarIndex;
      if (barsHeld >= timeExitBars) {
        context.closeShort();
        self._side = 'none';
        self._entryPrice = 0;
        return;
      }

      return; // In short position, no new entries
    }

    // =========================================================================
    // 4. ENTRY PIPELINE (no existing position)
    // =========================================================================

    // a. Settlement window gate — only trade near a settlement
    const minsToSettlement = minutesToNextSettlement(currentCandle.timestamp);
    if (minsToSettlement > settlementWindowMinutes) return;

    // b. Get most recent funding rate at or before current bar.
    //    Use a running index (self._lastFRIndex) to avoid scanning the full array
    //    on every bar — O(1) amortised instead of O(n).
    while (
      self._lastFRIndex < fundingRates.length - 1 &&
      fundingRates[self._lastFRIndex + 1].timestamp <= currentCandle.timestamp
    ) {
      self._lastFRIndex++;
    }
    const latestFRIdx = self._lastFRIndex;
    if (fundingRates[latestFRIdx].timestamp > currentCandle.timestamp) return; // no FR yet

    const currentRate = fundingRates[latestFRIdx].fundingRate;

    // c. Compute percentile rank of current FR within the lookback window.
    //    Slice only the lookback window — no need to materialise the full array.
    const lookbackStart = Math.max(0, latestFRIdx - frLookbackPeriods + 1);
    const lookbackRates = fundingRates
      .slice(lookbackStart, latestFRIdx + 1)
      .map(r => r.fundingRate);

    if (lookbackRates.length < 10) return; // Need minimum history for percentile to be meaningful

    const frRank = percentileRank(lookbackRates, currentRate);

    // d. Determine raw FR signals
    //    Long: FR extremely positive (longs paying shorts) → fades forced long liquidations
    //    Short: FR extremely negative (shorts paying longs) → fades forced short liquidations
    const longFRSignal = frRank >= frPercentileThreshold;
    const shortFRSignal = frRank <= (100 - frPercentileThreshold);

    if (!longFRSignal && !shortFRSignal) return;

    // e. Compute technical indicators for confirmation.
    //    Only pull the minimum lookback window needed — avoids O(n²) growth
    //    when processing 260K bars (each bar previously re-read the full history).
    const lookbackNeeded = Math.max(smaPeriod, rsiPeriod + 1) + 10; // small buffer
    const windowStart = Math.max(0, currentIndex - lookbackNeeded);
    const windowCandles = candleView.slice(windowStart, currentIndex + 1);
    const windowCloses = windowCandles.map((c: { close: number }) => c.close);

    const smaValues = calculateSMA(windowCloses, smaPeriod);
    const rsiValues = calculateRSI(windowCloses, rsiPeriod);

    const currentSMA = smaValues[smaValues.length - 1];
    const currentRSI = rsiValues[rsiValues.length - 1];

    // Both indicators must be available
    if (currentSMA === undefined || currentRSI === undefined) return;

    // f. Confirmation filters
    //    Long: price below SMA (mean-reversion up) + RSI oversold
    //    Short: price above SMA (mean-reversion down) + RSI overbought
    const longConfirmed = longFRSignal && price < currentSMA && currentRSI < rsiEntry;
    const shortConfirmed = shortFRSignal && price > currentSMA && currentRSI > (100 - rsiEntry);

    if (!longConfirmed && !shortConfirmed) return;

    // g. Calculate position size with leverage
    //    positionValue = (equity * positionSizePct / 100) * leverage
    //    positionSize  = positionValue / price
    const positionValue = (equity * positionSizePct / 100) * leverage;
    const positionSize = positionValue / price;

    if (positionSize <= 0) return;

    // h. Execute entry
    if (longConfirmed) {
      context.openLong(positionSize);
      self._side = 'long';
      self._entryPrice = price;
      self._entryBarIndex = currentIndex;
      context.log(
        `Long entry: FR rank=${frRank.toFixed(1)}%, RSI=${currentRSI.toFixed(1)}, ` +
        `SMA=${currentSMA.toFixed(4)}, minsToSettlement=${minsToSettlement}`
      );
    } else if (shortConfirmed) {
      context.openShort(positionSize);
      self._side = 'short';
      self._entryPrice = price;
      self._entryBarIndex = currentIndex;
      context.log(
        `Short entry: FR rank=${frRank.toFixed(1)}%, RSI=${currentRSI.toFixed(1)}, ` +
        `SMA=${currentSMA.toFixed(4)}, minsToSettlement=${minsToSettlement}`
      );
    }
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

    self._side = 'none';
    self._entryPrice = 0;
  },
};

export default strategy;
