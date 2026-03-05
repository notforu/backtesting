/**
 * FR Epoch Scalper
 *
 * Exploits predictable price behaviour around the 8-hour funding-rate (FR)
 * settlements on Bybit perpetual futures (00:00, 08:00, 16:00 UTC).
 *
 * Two distinct edge modes per settlement epoch:
 *
 * 1. PRE-SETTLEMENT MEAN-REVERSION
 *    In the 20–60 minutes before a settlement, traders on the dominant side
 *    reduce positions to avoid paying fees. This creates forced directional
 *    flow → temporary dislocation → reversion once the window passes.
 *    Entry: fade the forced flow when |FR| > frMinThreshold AND fast EMA
 *    confirms a pullback toward the EMA (momentum confirmation).
 *      FR > 0  → longs paying → LONG (price dips as longs trim)
 *      FR < 0  → shorts paying → SHORT (price spikes as shorts trim)
 *
 * 2. POST-SETTLEMENT TREND CONTINUATION
 *    5–15 minutes after settlement the "relief" side re-enters aggressively,
 *    extending the move that the pre-settlement fade was fighting against.
 *    Entry: follow the continuation direction with price-momentum filter
 *    (1m close > 3-bar EMA for longs; close < EMA for shorts).
 *      FR was > threshold → SHORT (longs no longer paying → shorts enter)
 *      FR was < -threshold → LONG  (shorts no longer paying → longs enter)
 *
 * Exit rules (any first):
 *   • ATR stop-loss  : entryPrice ± atrStopMult × ATR14
 *   • ATR take-profit: entryPrice ± atrTpMult   × ATR14
 *   • Time-based     : maxHoldBars bars elapsed
 *   • Pre-settlement flush: close all positions 5 min before next settlement
 *
 * Risk management:
 *   • Position size = equity × capitalFraction × leverage / price
 *   • Cooldown of cooldownBars between trades
 *   • Maximum maxTradesPerEpoch trades per 8-hour epoch
 *   • Minimum volatility gate: ATR / price > minAtrThreshold
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data: run scripts/cache-funding-rates.ts first
 */

import { EMA, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

// ============================================================================
// Internal State
// ============================================================================

interface StrategyState {
  /** Bar index at which current position was opened */
  _entryBar: number;
  /** ATR value at entry (frozen to prevent adaptive stop widening) */
  _entryATR: number;
  /** Direction of the current position, or null when flat */
  _direction: 'long' | 'short' | null;
  /**
   * Running index into fundingRates — last entry whose timestamp <=
   * current candle timestamp.  Maintained incrementally for O(1) amortised
   * lookup without scanning the full array every bar.
   */
  _lastFRIndex: number;
  /** Bar index of the most recent trade exit (for cooldown enforcement) */
  _lastExitBar: number;
  /**
   * The epoch ID (floor of currentTs / 28800000) for the epoch in which
   * the last trade was counted.
   */
  _currentEpochId: number;
  /** Number of trades opened in the current 8-hour epoch */
  _epochTradeCount: number;
}

// Settlement period in ms (8 hours)
const EPOCH_MS = 8 * 60 * 60 * 1000; // 28_800_000

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate the timestamp (ms) of the NEXT funding settlement at or after
 * `timestampMs`.  Settlements occur at 00:00, 08:00, 16:00 UTC every day.
 */
function nextSettlementMs(timestampMs: number): number {
  return Math.ceil(timestampMs / EPOCH_MS) * EPOCH_MS;
}

/**
 * Minutes remaining until the next settlement (can be fractional).
 */
function minsToNextSettlement(timestampMs: number): number {
  return (nextSettlementMs(timestampMs) - timestampMs) / 60_000;
}

/**
 * Minutes elapsed since the most recent past settlement.
 */
function minsSinceLastSettlement(timestampMs: number): number {
  const lastSettlement = Math.floor(timestampMs / EPOCH_MS) * EPOCH_MS;
  return (timestampMs - lastSettlement) / 60_000;
}

/**
 * Get the epoch ID (integer) for a timestamp — used to group bars into the
 * same 8-hour funding epoch.
 */
function epochId(timestampMs: number): number {
  return Math.floor(timestampMs / EPOCH_MS);
}

/**
 * Calculate EMA values aligned to the close array.  Returns undefined for
 * bars where insufficient history exists (first `period - 1` entries).
 */
function calcEMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = EMA.calculate({ values: closes, period });
  // EMA outputs (closes.length - period + 1) values
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate ATR values aligned to the candle array.  Returns undefined for
 * the first `period` entries (ATR needs period + 1 candles).
 */
function calcATR(
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
  name: 'fr-epoch-scalper',
  description:
    'Exploits predictable price dislocations around 8-hour funding-rate settlements. ' +
    'Pre-settlement: fades forced position-closing flow (mean-reversion). ' +
    'Post-settlement: follows trend continuation after relief. ' +
    'Uses ATR stops, epoch trade limits, and EMA momentum confirmation.',
  version: '1.0.0',

  params: [
    {
      name: 'frMinThreshold',
      label: 'Min |FR| Threshold',
      type: 'number',
      default: 0.0003,
      min: 0.0001,
      max: 0.001,
      step: 0.0001,
      description: 'Minimum absolute funding rate to activate the strategy (e.g. 0.0003 = 0.03%)',
    },
    {
      name: 'preSettlementMinutes',
      label: 'Pre-Settlement Window (min)',
      type: 'number',
      default: 45,
      min: 20,
      max: 60,
      step: 5,
      description: 'How many minutes before settlement to start looking for pre-settlement entries',
    },
    {
      name: 'postSettlementDelay',
      label: 'Post-Settlement Delay (min)',
      type: 'number',
      default: 5,
      min: 3,
      max: 15,
      step: 2,
      description: 'Minutes after settlement to wait before entering post-settlement trades',
    },
    {
      name: 'postSettlementWindow',
      label: 'Post-Settlement Window (min)',
      type: 'number',
      default: 15,
      min: 10,
      max: 30,
      step: 5,
      description: 'Duration in minutes (after the delay) in which post-settlement trades may be entered',
    },
    {
      name: 'fastEmaPeriod',
      label: 'Fast EMA Period',
      type: 'number',
      default: 5,
      min: 3,
      max: 10,
      step: 1,
      description: 'Fast EMA period used for momentum confirmation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 2,
      description: 'ATR calculation period for stops and volatility filter',
    },
    {
      name: 'atrStopMult',
      label: 'ATR Stop Multiplier',
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      step: 0.25,
      description: 'Stop-loss distance as a multiple of ATR',
    },
    {
      name: 'atrTpMult',
      label: 'ATR Take-Profit Multiplier',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 4.0,
      step: 0.25,
      description: 'Take-profit distance as a multiple of ATR',
    },
    {
      name: 'capitalFraction',
      label: 'Capital Fraction',
      type: 'number',
      default: 0.3,
      min: 0.1,
      max: 0.5,
      step: 0.05,
      description: 'Fraction of equity allocated per trade (before leverage)',
    },
    {
      name: 'leverage',
      label: 'Leverage',
      type: 'number',
      default: 3,
      min: 2,
      max: 10,
      step: 1,
      description: 'Leverage multiplier applied to the capital fraction',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 30,
      min: 15,
      max: 60,
      step: 5,
      description: 'Maximum number of 1-minute bars to hold a position',
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 5,
      min: 3,
      max: 15,
      step: 2,
      description: 'Minimum bars between trade exits and the next entry',
    },
    {
      name: 'maxTradesPerEpoch',
      label: 'Max Trades per Epoch',
      type: 'number',
      default: 2,
      min: 1,
      max: 4,
      step: 1,
      description: 'Maximum number of trades allowed per 8-hour funding epoch',
    },
    {
      name: 'minAtrThreshold',
      label: 'Min ATR/Price Threshold',
      type: 'number',
      default: 0.001,
      min: 0.0005,
      max: 0.005,
      step: 0.0005,
      description: 'Minimum ATR-to-price ratio required to trade (volatility gate)',
    },
  ] as StrategyParam[],

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    self._entryBar = -1;
    self._entryATR = 0;
    self._direction = null;
    self._lastFRIndex = 0;
    self._lastExitBar = -999;
    self._currentEpochId = -1;
    self._epochTradeCount = 0;
    context.log('fr-epoch-scalper initialized');
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
    const frMinThreshold       = params.frMinThreshold       as number;
    const preSettlementMinutes = params.preSettlementMinutes as number;
    const postSettlementDelay  = params.postSettlementDelay  as number;
    const postSettlementWindow = params.postSettlementWindow as number;
    const fastEmaPeriod        = params.fastEmaPeriod        as number;
    const atrPeriod            = params.atrPeriod            as number;
    const atrStopMult          = params.atrStopMult          as number;
    const atrTpMult            = params.atrTpMult            as number;
    const capitalFraction      = params.capitalFraction      as number;
    const leverage             = params.leverage             as number;
    const maxHoldBars          = params.maxHoldBars          as number;
    const cooldownBars         = params.cooldownBars         as number;
    const maxTradesPerEpoch    = params.maxTradesPerEpoch    as number;
    const minAtrThreshold      = params.minAtrThreshold      as number;

    // =========================================================================
    // 2. Guard: need funding rates and sufficient bar history
    // =========================================================================
    if (!fundingRates || fundingRates.length === 0) return;

    const minBars = Math.max(atrPeriod + 1, fastEmaPeriod + 1);
    if (currentIndex < minBars) return;

    const ts    = currentCandle.timestamp;
    const price = currentCandle.close;

    // =========================================================================
    // 3. Advance running FR pointer (O(1) amortised)
    // =========================================================================
    while (
      self._lastFRIndex < fundingRates.length - 1 &&
      fundingRates[self._lastFRIndex + 1].timestamp <= ts
    ) {
      self._lastFRIndex++;
    }

    // Require at least one FR reading at or before this bar
    if (fundingRates[self._lastFRIndex].timestamp > ts) return;

    const currentRate = fundingRates[self._lastFRIndex].fundingRate;

    // =========================================================================
    // 4. Update epoch trade counter
    // =========================================================================
    const thisEpoch = epochId(ts);
    if (thisEpoch !== self._currentEpochId) {
      self._currentEpochId   = thisEpoch;
      self._epochTradeCount  = 0;
    }

    // =========================================================================
    // 5. Compute indicators on a bounded window to avoid O(n²)
    // =========================================================================
    const lookbackNeeded = Math.max(atrPeriod, fastEmaPeriod) + 10;
    const windowStart    = Math.max(0, currentIndex - lookbackNeeded);
    const windowCandles  = candleView.slice(windowStart, currentIndex + 1);

    const wCloses = windowCandles.map(c => c.close);
    const wHighs  = windowCandles.map(c => c.high);
    const wLows   = windowCandles.map(c => c.low);

    const emaValues = calcEMA(wCloses, fastEmaPeriod);
    const atrValues = calcATR(wHighs, wLows, wCloses, atrPeriod);

    const currentEMA = emaValues[emaValues.length - 1];
    const currentATR = atrValues[atrValues.length - 1];

    if (currentEMA === undefined || currentATR === undefined || currentATR <= 0) return;

    // =========================================================================
    // 6. POSITION MANAGEMENT (exits evaluated before entries)
    // =========================================================================

    // 6a. Pre-settlement flush: close any position 5 minutes before a settlement
    const minsToSettlement = minsToNextSettlement(ts);
    if ((longPosition || shortPosition) && minsToSettlement <= 5) {
      if (longPosition)  context.closeLong();
      if (shortPosition) context.closeShort();
      self._direction   = null;
      self._lastExitBar = currentIndex;
      context.log(`Pre-settlement flush at ${new Date(ts).toISOString()}, minsToSettlement=${minsToSettlement.toFixed(1)}`);
      return;
    }

    if (longPosition) {
      const stopPrice = longPosition.entryPrice - self._entryATR * atrStopMult;
      const tpPrice   = longPosition.entryPrice + self._entryATR * atrTpMult;
      const barsHeld  = currentIndex - self._entryBar;

      // Stop-loss: use candle low (worst intra-bar fill for longs)
      if (currentCandle.low <= stopPrice) {
        context.closeLong();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Long SL hit at ${price}, entryATR=${self._entryATR.toFixed(4)}`);
        return;
      }

      // Take-profit: use candle high (best intra-bar fill for longs)
      if (currentCandle.high >= tpPrice) {
        context.closeLong();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Long TP hit at ${price}`);
        return;
      }

      // Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeLong();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Long time exit at bar ${currentIndex}, held=${barsHeld}`);
        return;
      }

      return; // Hold long, no new entry this bar
    }

    if (shortPosition) {
      const stopPrice = shortPosition.entryPrice + self._entryATR * atrStopMult;
      const tpPrice   = shortPosition.entryPrice - self._entryATR * atrTpMult;
      const barsHeld  = currentIndex - self._entryBar;

      // Stop-loss: use candle high (worst intra-bar fill for shorts)
      if (currentCandle.high >= stopPrice) {
        context.closeShort();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Short SL hit at ${price}`);
        return;
      }

      // Take-profit: use candle low (best intra-bar fill for shorts)
      if (currentCandle.low <= tpPrice) {
        context.closeShort();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Short TP hit at ${price}`);
        return;
      }

      // Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeShort();
        self._direction   = null;
        self._lastExitBar = currentIndex;
        context.log(`Short time exit at bar ${currentIndex}, held=${barsHeld}`);
        return;
      }

      return; // Hold short, no new entry this bar
    }

    // =========================================================================
    // 7. ENTRY PIPELINE (no open position)
    // =========================================================================

    // Gate 1: cooldown between trades
    if (currentIndex - self._lastExitBar < cooldownBars) return;

    // Gate 2: epoch trade limit
    if (self._epochTradeCount >= maxTradesPerEpoch) return;

    // Gate 3: funding rate magnitude must meet minimum threshold
    if (Math.abs(currentRate) < frMinThreshold) return;

    // Gate 4: volatility gate — ATR must be large enough relative to price
    if (currentATR / price < minAtrThreshold) return;

    // =========================================================================
    // 7a. PRE-SETTLEMENT MEAN-REVERSION WINDOW
    //     Entry window: (preSettlementMinutes … 5] minutes before settlement
    //     Skip the last 5 min — those are reserved for the flush rule above.
    // =========================================================================
    const inPreWindow = minsToSettlement > 5 && minsToSettlement <= preSettlementMinutes;

    if (inPreWindow) {
      // Determine direction: fade the dominant payer
      //   FR > 0 → longs paying → we LONG (buy the dip caused by longs closing)
      //   FR < 0 → shorts paying → we SHORT (fade the spike caused by shorts closing)
      const preLong  = currentRate > frMinThreshold;
      const preShort = currentRate < -frMinThreshold;

      if (!preLong && !preShort) return;

      // EMA momentum confirmation: enter only on a pullback toward the EMA
      //   Long entry: price at or below the fast EMA (pullback into EMA)
      //   Short entry: price at or above the fast EMA (pullback into EMA)
      const longEmaOk  = price <= currentEMA;
      const shortEmaOk = price >= currentEMA;

      if (preLong && longEmaOk) {
        const posSize = (equity * capitalFraction * leverage) / price;
        if (posSize > 0) {
          context.openLong(posSize);
          self._direction      = 'long';
          self._entryBar       = currentIndex;
          self._entryATR       = currentATR;
          self._epochTradeCount++;
          context.log(
            `PRE-SETTLEMENT LONG | FR=${currentRate.toFixed(5)}, ` +
            `EMA=${currentEMA.toFixed(4)}, price=${price}, ` +
            `minsToSettlement=${minsToSettlement.toFixed(1)}, epoch#${self._epochTradeCount}`
          );
        }
        return;
      }

      if (preShort && shortEmaOk) {
        const posSize = (equity * capitalFraction * leverage) / price;
        if (posSize > 0) {
          context.openShort(posSize);
          self._direction      = 'short';
          self._entryBar       = currentIndex;
          self._entryATR       = currentATR;
          self._epochTradeCount++;
          context.log(
            `PRE-SETTLEMENT SHORT | FR=${currentRate.toFixed(5)}, ` +
            `EMA=${currentEMA.toFixed(4)}, price=${price}, ` +
            `minsToSettlement=${minsToSettlement.toFixed(1)}, epoch#${self._epochTradeCount}`
          );
        }
        return;
      }

      // No confirmation — nothing to trade this bar
      return;
    }

    // =========================================================================
    // 7b. POST-SETTLEMENT TREND CONTINUATION WINDOW
    //     Entry window: (postSettlementDelay … postSettlementDelay + postSettlementWindow]
    //     minutes after the most recent settlement.
    // =========================================================================
    const minsSinceSettlement = minsSinceLastSettlement(ts);
    const inPostWindow =
      minsSinceSettlement > postSettlementDelay &&
      minsSinceSettlement <= postSettlementDelay + postSettlementWindow;

    if (inPostWindow) {
      // Continuation direction is the OPPOSITE of the pre-settlement fade:
      //   FR > threshold → longs were paying → post-settlement relief → longs re-enter
      //   → but now NEW shorts pile in → direction is SHORT
      //   FR < -threshold → shorts were paying → relief → new longs enter → direction is LONG
      const postLong  = currentRate < -frMinThreshold;
      const postShort = currentRate > frMinThreshold;

      if (!postLong && !postShort) return;

      // Price momentum confirmation: price must be moving with the intended direction
      //   Long entry: close > fast EMA (bullish momentum)
      //   Short entry: close < fast EMA (bearish momentum)
      const longMomentumOk  = price > currentEMA;
      const shortMomentumOk = price < currentEMA;

      if (postLong && longMomentumOk) {
        const posSize = (equity * capitalFraction * leverage) / price;
        if (posSize > 0) {
          context.openLong(posSize);
          self._direction      = 'long';
          self._entryBar       = currentIndex;
          self._entryATR       = currentATR;
          self._epochTradeCount++;
          context.log(
            `POST-SETTLEMENT LONG | FR=${currentRate.toFixed(5)}, ` +
            `EMA=${currentEMA.toFixed(4)}, price=${price}, ` +
            `minsSince=${minsSinceSettlement.toFixed(1)}, epoch#${self._epochTradeCount}`
          );
        }
        return;
      }

      if (postShort && shortMomentumOk) {
        const posSize = (equity * capitalFraction * leverage) / price;
        if (posSize > 0) {
          context.openShort(posSize);
          self._direction      = 'short';
          self._entryBar       = currentIndex;
          self._entryATR       = currentATR;
          self._epochTradeCount++;
          context.log(
            `POST-SETTLEMENT SHORT | FR=${currentRate.toFixed(5)}, ` +
            `EMA=${currentEMA.toFixed(4)}, price=${price}, ` +
            `minsSince=${minsSinceSettlement.toFixed(1)}, epoch#${self._epochTradeCount}`
          );
        }
        return;
      }
    }
  },

  onEnd(context?: StrategyContext): void {
    if (!context) return;

    // Close any remaining open positions at end of backtest
    if (context.longPosition)  context.closeLong();
    if (context.shortPosition) context.closeShort();

    const self = this as unknown as StrategyState;
    self._direction = null;
    context.log('fr-epoch-scalper ended, all positions closed');
  },
};

export default strategy;
