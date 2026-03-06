/**
 * OI-Delta Regime Scalper
 *
 * Exploits divergences between Open Interest (OI) rate-of-change and price movement,
 * filtered by Funding Rate regime. When OI spikes (new leveraged positions entering)
 * but price doesn't follow proportionally, the market is overcrowded and vulnerable
 * to reversal. Combined with FR regime context (indicating WHICH side is overcrowded),
 * we trade the mean-reversion when OI starts declining (positions unwinding).
 *
 * Entry:
 *   - Short: FR bullish (longs overcrowded) + OI spiked then declining + price above EMA
 *   - Long:  FR bearish (shorts overcrowded) + OI spiked then declining + price below EMA
 *
 * Exit:
 *   - ATR-based stop loss and take profit
 *   - OI reversal exit (thesis invalidation)
 *   - Time-based exit (maxHoldBars)
 *   - Cooldown between trades
 *
 * Requires:
 *   - futures mode: --mode=futures --leverage=3
 *   - OI data: run scripts/cache-open-interest.ts first
 *   - L/S data: run scripts/cache-long-short-ratio.ts first
 *   - 15m candles: run scripts/cache-candles.ts --timeframe=15m first
 *   - Funding rates: run scripts/cache-funding-rates.ts first
 */

import ti from 'technicalindicators';
const { EMA, ATR } = ti;
import { getOpenInterest, getLongShortRatio } from '../src/data/db.js';
import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';
import type { OpenInterestRecord, LongShortRatioRecord } from '../src/core/types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** Calculate EMA with padding to align with candles array */
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  if (closes.length < period) return new Array(closes.length).fill(undefined);
  const result = EMA.calculate({ values: closes, period });
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

/**
 * Binary search: find the value of OI at or just before targetTs.
 * Records must be sorted by timestamp ascending.
 */
function findNearestOiBefore(
  records: OpenInterestRecord[],
  targetTs: number
): number | undefined {
  if (records.length === 0) return undefined;
  let lo = 0;
  let hi = records.length - 1;
  let best: number | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (records[mid].timestamp <= targetTs) {
      best = records[mid].openInterestAmount;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Binary search: find the L/S ratio record at or just before targetTs.
 * Records must be sorted by timestamp ascending.
 */
function findNearestLsrBefore(
  records: LongShortRatioRecord[],
  targetTs: number
): LongShortRatioRecord | undefined {
  if (records.length === 0) return undefined;
  let lo = 0;
  let hi = records.length - 1;
  let best: LongShortRatioRecord | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (records[mid].timestamp <= targetTs) {
      best = records[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Mean of an array (ignoring undefined) */
function mean(arr: (number | undefined)[]): number {
  const nums = arr.filter((v): v is number => v !== undefined);
  if (nums.length === 0) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

// ============================================================================
// Strategy Internal State
// ============================================================================

interface StrategyState {
  /** Pre-loaded OI records for the backtest period */
  _oiRecords: OpenInterestRecord[];
  /** Pre-loaded L/S ratio records for the backtest period */
  _lsrRecords: LongShortRatioRecord[];
  /** Bar index of the last trade entry (-999 = no prior trade) */
  _lastTradeBar: number;
  /** ATR value captured at entry time (used for fixed stop/TP levels) */
  _entryATR: number;
  /** Bar index when the current position was entered */
  _entryBar: number;
  /** Whether async init has completed */
  _initialized: boolean;
  /** Exchange extracted from symbol context (set during first onBar if init async) */
  _exchange: string;
  /** Symbol normalized for DB queries */
  _symbol: string;
}

// ============================================================================
// Strategy Definition
// ============================================================================

const strategy: Strategy = {
  name: 'oi-delta-regime-scalper',
  description:
    'Scalps OI-price divergences on 15m, filtered by FR regime. Enters when OI spikes then declines (positions unwinding) in overcrowded market. ATR-based stops, time exit, cooldown.',
  version: '1.0.0',

  params: [
    {
      name: 'exchange',
      type: 'string',
      default: 'bybit',
      description: 'Exchange identifier for OI/LSR data lookup (e.g. bybit)',
    },
    {
      name: 'oiLookback',
      type: 'number',
      default: 8,
      min: 4,
      max: 16,
      step: 2,
      description: 'OI spike detection lookback in 15m bars (e.g. 8 = 2 hours)',
    },
    {
      name: 'oiSpikeThreshold',
      type: 'number',
      default: 3.0,
      min: 1.0,
      max: 8.0,
      step: 0.5,
      description: 'Minimum OI % change over lookback to flag a spike',
    },
    {
      name: 'oiDeclineWindow',
      type: 'number',
      default: 2,
      min: 1,
      max: 4,
      step: 1,
      description: 'Number of recent bars to check for OI declining',
    },
    {
      name: 'frAbsThreshold',
      type: 'number',
      default: 0.0005,
      min: 0.0003,
      max: 0.001,
      step: 0.0001,
      description: 'Absolute funding rate threshold to declare regime (e.g. 0.0005 = 0.05%)',
    },
    {
      name: 'lsThreshold',
      type: 'number',
      default: 1.5,
      min: 1.2,
      max: 2.0,
      step: 0.1,
      description: 'L/S ratio extreme threshold (>X = crowded longs, <1/X = crowded shorts)',
    },
    {
      name: 'useLsFilter',
      type: 'boolean',
      default: true,
      description: 'Enable Long/Short ratio confirmation filter',
    },
    {
      name: 'emaPeriod',
      type: 'number',
      default: 50,
      min: 20,
      max: 100,
      step: 10,
      description: 'EMA period for trend context (counter-trend entry filter)',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      default: 14,
      min: 10,
      max: 20,
      step: 2,
      description: 'ATR period for stop loss and take profit calculation',
    },
    {
      name: 'atrStopMultiplier',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for stop loss distance from entry',
    },
    {
      name: 'atrTpMultiplier',
      type: 'number',
      default: 2.5,
      min: 1.5,
      max: 4.0,
      step: 0.5,
      description: 'ATR multiplier for take profit distance from entry',
    },
    {
      name: 'capitalFraction',
      type: 'number',
      default: 0.3,
      min: 0.2,
      max: 0.5,
      step: 0.1,
      description: 'Fraction of equity to allocate per trade (before leverage)',
    },
    {
      name: 'leverage',
      type: 'number',
      default: 3,
      min: 2,
      max: 5,
      step: 1,
      description: 'Position leverage multiplier',
    },
    {
      name: 'maxHoldBars',
      type: 'number',
      default: 12,
      min: 4,
      max: 24,
      step: 4,
      description: 'Maximum holding period in 15m bars before time-based exit',
    },
    {
      name: 'cooldownBars',
      type: 'number',
      default: 4,
      min: 2,
      max: 8,
      step: 2,
      description: 'Minimum bars between consecutive trade entries',
    },
  ] as StrategyParam[],

  init(context: StrategyContext): void {
    const self = this as unknown as StrategyState;
    const { params } = context;

    // Validate parameter relationship
    if ((params.atrTpMultiplier as number) < (params.atrStopMultiplier as number)) {
      context.log(
        'WARNING: atrTpMultiplier < atrStopMultiplier -- negative R:R ratio, consider adjusting'
      );
    }
    if ((params.oiLookback as number) <= (params.oiDeclineWindow as number)) {
      context.log(
        'WARNING: oiLookback should be greater than oiDeclineWindow for meaningful spike detection'
      );
    }

    self._oiRecords = [];
    self._lsrRecords = [];
    self._lastTradeBar = -999;
    self._entryATR = 0;
    self._entryBar = -999;
    self._initialized = false;
    self._exchange = (params.exchange as string) || 'bybit';
    self._symbol = '';

    context.log(
      `OI-Delta Regime Scalper initialized. Exchange: ${self._exchange}, ` +
        `leverage=${params.leverage}, capitalFraction=${params.capitalFraction}`
    );
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
    // 1. Lazy async data load on first bar (sync wrapper via pre-loaded arrays)
    // =========================================================================
    // Data is loaded synchronously before the backtest via init() convention.
    // Since init() cannot be async in the current interface, we use a lazy load
    // pattern: on the first bar, we detect the symbol from context and trigger
    // the load. Because we cannot await in onBar, the actual DB data must be
    // pre-populated by an external mechanism or the strategy gracefully skips
    // bars without data.
    //
    // For production use, cache scripts must be run before backtesting.
    // The strategy will skip signal generation if OI data is unavailable.

    // =========================================================================
    // 2. Extract parameters
    // =========================================================================
    const oiLookback = params.oiLookback as number;
    const oiSpikeThreshold = params.oiSpikeThreshold as number;
    const oiDeclineWindow = params.oiDeclineWindow as number;
    const frAbsThreshold = params.frAbsThreshold as number;
    const lsThreshold = params.lsThreshold as number;
    const useLsFilter = params.useLsFilter as boolean;
    const emaPeriod = params.emaPeriod as number;
    const atrPeriod = params.atrPeriod as number;
    const atrStopMultiplier = params.atrStopMultiplier as number;
    const atrTpMultiplier = params.atrTpMultiplier as number;
    const capitalFraction = params.capitalFraction as number;
    const leverage = params.leverage as number;
    const maxHoldBars = params.maxHoldBars as number;
    const cooldownBars = params.cooldownBars as number;

    // =========================================================================
    // 3. Early return if insufficient candle data
    // =========================================================================
    const minBars = Math.max(emaPeriod, atrPeriod + 1);
    if (currentIndex < minBars) return;

    // =========================================================================
    // 4. Calculate indicators
    // =========================================================================
    const closes = candleView.closes();
    const highs = candleView.highs();
    const lows = candleView.lows();

    const emaValues = calculateEMA(closes, emaPeriod);
    const atrValues = calculateATR(highs, lows, closes, atrPeriod);

    const currentEMA = emaValues[emaValues.length - 1];
    const currentATR = atrValues[atrValues.length - 1];

    if (currentEMA === undefined || currentATR === undefined || currentATR <= 0) return;

    // Volatility-adjusted position sizing: use rolling avg ATR over last 50 bars
    const recentATRs = atrValues.slice(-50);
    const avgATR = mean(recentATRs);

    // =========================================================================
    // 5. Get current funding rate regime
    // =========================================================================
    if (!fundingRates || fundingRates.length === 0) return;

    // Find the most recent FR at or before current candle
    const currentTs = currentCandle.timestamp;
    const recentFRs = fundingRates.filter((fr) => fr.timestamp <= currentTs);
    if (recentFRs.length === 0) return;

    const latestFR = recentFRs[recentFRs.length - 1];
    const currentFR = latestFR.fundingRate;

    // FR regime: positive FR = longs overcrowded (short bias), negative FR = shorts overcrowded (long bias)
    const frBullish = currentFR > frAbsThreshold;   // longs overcrowded
    const frBearish = currentFR < -frAbsThreshold;  // shorts overcrowded
    const frNeutral = !frBullish && !frBearish;

    // =========================================================================
    // 6. Get OI data for signal generation
    // =========================================================================
    const oiData = self._oiRecords;

    // OI lookback window: oiLookback * 15 minutes in milliseconds
    const lookbackMs = oiLookback * 15 * 60 * 1000;
    const declineMs = oiDeclineWindow * 15 * 60 * 1000;

    // Current OI (at or before current bar)
    const oiCurrent = findNearestOiBefore(oiData, currentTs);

    // OI at start of lookback window (to detect spike)
    const oiAtLookbackStart = findNearestOiBefore(oiData, currentTs - lookbackMs);

    // OI at start of decline window (to detect declining trend)
    const oiAtDeclineStart = findNearestOiBefore(oiData, currentTs - declineMs);

    // Skip if we don't have OI data — never trade without OI signal
    if (
      oiCurrent === undefined ||
      oiAtLookbackStart === undefined ||
      oiAtDeclineStart === undefined
    ) {
      // Only exit checks run without OI data
      // Fall through to manage existing positions, but do not enter new ones
    }

    // OI spike: max OI in lookback vs start of lookback
    let oiSpikeDetected = false;
    if (
      oiCurrent !== undefined &&
      oiAtLookbackStart !== undefined &&
      oiAtLookbackStart > 0
    ) {
      const oiRocLookback = ((oiCurrent - oiAtLookbackStart) / oiAtLookbackStart) * 100;
      oiSpikeDetected = oiRocLookback > oiSpikeThreshold;
    }

    // OI declining: OI at start of decline window vs current (current < start = declining)
    let oiDeclining = false;
    if (oiCurrent !== undefined && oiAtDeclineStart !== undefined && oiAtDeclineStart > 0) {
      oiDeclining = oiCurrent < oiAtDeclineStart;
    }

    // OI reversal signal: OI is rising again (adverse to the position)
    // Used for early exit when thesis invalidated
    let oiRising = false;
    if (oiCurrent !== undefined && oiAtDeclineStart !== undefined && oiAtDeclineStart > 0) {
      const declineRoc = ((oiCurrent - oiAtDeclineStart) / oiAtDeclineStart) * 100;
      oiRising = declineRoc > 0;
    }

    // =========================================================================
    // 7. Get L/S ratio
    // =========================================================================
    const lsrData = self._lsrRecords;
    const currentLsr = findNearestLsrBefore(lsrData, currentTs);

    // =========================================================================
    // 8. MANAGE EXISTING POSITIONS (exits take priority over entries)
    // =========================================================================

    // Use entry ATR for fixed stop/TP levels (does not expand with live ATR)
    const stopATR = self._entryATR > 0 ? self._entryATR : currentATR;

    if (longPosition) {
      const barsHeld = currentIndex - self._entryBar;

      // a. Stop loss: check candle LOW (worst price for longs)
      const stopPrice = longPosition.entryPrice - stopATR * atrStopMultiplier;
      if (currentCandle.low <= stopPrice) {
        context.closeLong();
        self._lastTradeBar = currentIndex;
        return;
      }

      // b. OI reversal exit (thesis invalidation): if OI rising again, exit
      // When we're long, the thesis was that shorts were unwinding (OI declining).
      // If OI starts rising again, new shorts may be piling in -- invalidates trade.
      if (oiRising && frBullish) {
        // OI rising in bullish FR environment while we're long is adversarial
        context.closeLong();
        self._lastTradeBar = currentIndex;
        return;
      }

      // c. Take profit: check candle HIGH (best price for longs)
      const tpPrice = longPosition.entryPrice + stopATR * atrTpMultiplier;
      if (currentCandle.high >= tpPrice) {
        context.closeLong();
        self._lastTradeBar = currentIndex;
        return;
      }

      // d. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeLong();
        self._lastTradeBar = currentIndex;
        return;
      }

      return; // In long position, skip entry logic
    }

    if (shortPosition) {
      const barsHeld = currentIndex - self._entryBar;

      // a. Stop loss: check candle HIGH (worst price for shorts)
      const stopPrice = shortPosition.entryPrice + stopATR * atrStopMultiplier;
      if (currentCandle.high >= stopPrice) {
        context.closeShort();
        self._lastTradeBar = currentIndex;
        return;
      }

      // b. OI reversal exit (thesis invalidation): if OI rising again, exit
      // When we're short, the thesis was that longs were unwinding (OI declining).
      // If OI starts rising again, new longs may be piling in -- invalidates trade.
      if (oiRising && frBearish) {
        // OI rising in bearish FR environment while we're short is adversarial
        context.closeShort();
        self._lastTradeBar = currentIndex;
        return;
      }

      // c. Take profit: check candle LOW (best price for shorts)
      const tpPrice = shortPosition.entryPrice - stopATR * atrTpMultiplier;
      if (currentCandle.low <= tpPrice) {
        context.closeShort();
        self._lastTradeBar = currentIndex;
        return;
      }

      // d. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.closeShort();
        self._lastTradeBar = currentIndex;
        return;
      }

      return; // In short position, skip entry logic
    }

    // =========================================================================
    // 9. ENTRY LOGIC (no existing position)
    // =========================================================================

    // Require OI data for all entries
    if (
      oiCurrent === undefined ||
      oiAtLookbackStart === undefined ||
      oiAtDeclineStart === undefined
    ) {
      return;
    }

    // Check cooldown
    if (currentIndex - self._lastTradeBar < cooldownBars) return;

    // Require FR regime signal
    if (frNeutral) return;

    // Require OI spike followed by decline (the core signal)
    if (!oiSpikeDetected || !oiDeclining) return;

    const price = currentCandle.close;

    // =========================================================================
    // SHORT ENTRY: FR bullish (longs overcrowded) + OI spike + OI declining
    // =========================================================================
    if (frBullish) {
      // Counter-trend: price should be above EMA (selling into strength)
      if (price <= currentEMA) return;

      // L/S ratio confirmation: longs crowded (ratio > lsThreshold)
      if (useLsFilter) {
        if (currentLsr === undefined) {
          // Missing L/S data: skip filter per spec (use only OI + FR)
          context.log(`Bar ${currentIndex}: L/S data unavailable, proceeding without LS filter`);
        } else if (currentLsr.longShortRatio <= lsThreshold) {
          return; // Not crowded enough on the long side
        }
      }

      // Position sizing with volatility adjustment
      const volAdjust = avgATR > 0 ? Math.min(1.5, avgATR / currentATR) : 1.0;
      const adjustedFraction = capitalFraction * volAdjust;
      const positionValue = equity * adjustedFraction * leverage;
      const amount = positionValue / price;
      if (amount <= 0) return;

      context.openShort(amount);
      self._entryATR = currentATR;
      self._entryBar = currentIndex;
      self._lastTradeBar = currentIndex;
      context.log(
        `SHORT entry at ${price.toFixed(6)}, FR=${currentFR.toFixed(6)}, ` +
          `OI spike confirmed + declining, ATR=${currentATR.toFixed(6)}, ` +
          `size=${amount.toFixed(4)} (${(adjustedFraction * leverage * 100).toFixed(1)}% equity * leverage)`
      );
      return;
    }

    // =========================================================================
    // LONG ENTRY: FR bearish (shorts overcrowded) + OI spike + OI declining
    // =========================================================================
    if (frBearish) {
      // Counter-trend: price should be below EMA (buying into weakness)
      if (price >= currentEMA) return;

      // L/S ratio confirmation: shorts crowded (ratio < 1/lsThreshold)
      if (useLsFilter) {
        if (currentLsr === undefined) {
          // Missing L/S data: skip filter per spec
          context.log(`Bar ${currentIndex}: L/S data unavailable, proceeding without LS filter`);
        } else if (currentLsr.longShortRatio >= 1 / lsThreshold) {
          return; // Not crowded enough on the short side
        }
      }

      // Position sizing with volatility adjustment
      const volAdjust = avgATR > 0 ? Math.min(1.5, avgATR / currentATR) : 1.0;
      const adjustedFraction = capitalFraction * volAdjust;
      const positionValue = equity * adjustedFraction * leverage;
      const amount = positionValue / price;
      if (amount <= 0) return;

      context.openLong(amount);
      self._entryATR = currentATR;
      self._entryBar = currentIndex;
      self._lastTradeBar = currentIndex;
      context.log(
        `LONG entry at ${price.toFixed(6)}, FR=${currentFR.toFixed(6)}, ` +
          `OI spike confirmed + declining, ATR=${currentATR.toFixed(6)}, ` +
          `size=${amount.toFixed(4)} (${(adjustedFraction * leverage * 100).toFixed(1)}% equity * leverage)`
      );
      return;
    }
  },

  onEnd(context?: StrategyContext): void {
    if (!context) return;
    // Close any remaining open positions at end of backtest
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

// ============================================================================
// OI + L/S Data Loader
// ============================================================================

/**
 * Pre-load OI and L/S ratio data into the strategy state before the backtest runs.
 * This must be called before running a backtest with this strategy.
 *
 * The strategy's onBar() uses binary search on the pre-loaded arrays, so this
 * function should be called once with the full backtest date range.
 *
 * @param strategyInstance - The strategy instance (result of loadStrategy())
 * @param exchange - Exchange name (e.g. 'bybit')
 * @param symbol - Symbol in DB format (e.g. 'DOGE/USDT' or 'DOGEUSDT')
 * @param startTs - Backtest start timestamp (Unix ms)
 * @param endTs - Backtest end timestamp (Unix ms)
 */
export async function preloadOiData(
  strategyInstance: Strategy,
  exchange: string,
  symbol: string,
  startTs: number,
  endTs: number
): Promise<void> {
  const self = strategyInstance as unknown as StrategyState;

  // Load with a buffer before startTs so lookback windows work at the beginning
  const bufferMs = 16 * 15 * 60 * 1000; // 16 bars * 15min buffer
  const loadStart = startTs - bufferMs;

  const [oiRecords, lsrRecords] = await Promise.all([
    getOpenInterest(exchange, symbol, loadStart, endTs),
    getLongShortRatio(exchange, symbol, loadStart, endTs),
  ]);

  self._oiRecords = oiRecords;
  self._lsrRecords = lsrRecords;
  self._initialized = true;

  console.log(
    `[oi-delta-regime-scalper] Loaded ${oiRecords.length} OI records and ` +
      `${lsrRecords.length} L/S ratio records for ${exchange}:${symbol}`
  );
}

export default strategy;
