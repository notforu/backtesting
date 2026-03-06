/**
 * Market Leader Divergence Strategy
 *
 * A trend-following divergence strategy that combines trend detection,
 * volume analysis, and mean reversion to identify high-probability trades.
 *
 * Strategy Logic:
 * 1. Trend Detection: Uses EMA crossovers to identify the prevailing trend
 *    - Bullish: Fast EMA > Slow EMA
 *    - Bearish: Fast EMA < Slow EMA
 *
 * 2. Volume Analysis: Detects volume spikes indicating strong momentum
 *    - Volume spike: Current volume > volumeMultiplier * average volume
 *
 * 3. Divergence Detection: Identifies when price lags behind the trend
 *    - Bullish divergence: Uptrend but price below fast EMA (lagging)
 *    - Bearish divergence: Downtrend but price above fast EMA (lagging)
 *
 * Entry Rules:
 * - LONG: Bullish trend + price below fast EMA + volume spike + no breakout recently
 * - SHORT: Bearish trend + price above fast EMA + volume spike + no breakout recently
 *
 * Exit Rules:
 * - Stop loss: stopLossPercent from entry price
 * - Take profit: takeProfitPercent from entry price
 * - Divergence resolved: Price crosses back above/below fast EMA (catches up to trend)
 *
 * Parameters:
 * - fastEMA: Fast EMA period for trend detection (default: 20)
 * - slowEMA: Slow EMA period for trend detection (default: 50)
 * - volumeMultiplier: Volume spike threshold (default: 1.5)
 * - lookbackPeriod: Period to check for recent breakouts (default: 20)
 * - stopLossPercent: Stop loss percentage (default: 2%)
 * - takeProfitPercent: Take profit percentage (default: 4%)
 * - positionSizePercent: Position size as % of balance (default: 95%)
 * - enableShorts: Whether to open short positions (default: true)
 *
 * Usage:
 * This strategy works best in trending markets with clear momentum shifts.
 * Avoid using in low-volatility or choppy markets where false signals are common.
 */

import ti from 'technicalindicators';
const { EMA } = ti;
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

/**
 * Calculate EMA values from candle close prices
 */
function calculateEMA(closes: number[], period: number): (number | undefined)[] {
  const result = EMA.calculate({
    values: closes,
    period: period,
  });

  // Pad the beginning with undefined values to align with candles
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Calculate average volume over a period
 */
function calculateAverageVolume(volumes: number[], period: number): number {
  if (volumes.length < period) {
    return 0;
  }
  const recentVolumes = volumes.slice(-period);
  return recentVolumes.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Check if there's a recent high/low breakout in the lookback period
 */
function hasRecentBreakout(
  candles: { high: number; low: number; close: number }[],
  lookbackPeriod: number
): boolean {
  if (candles.length < lookbackPeriod + 1) {
    return false;
  }

  const recentCandles = candles.slice(-lookbackPeriod - 1, -1);
  const currentCandle = candles[candles.length - 1];

  const recentHigh = Math.max(...recentCandles.map((c) => c.high));
  const recentLow = Math.min(...recentCandles.map((c) => c.low));

  // Check if current price broke above recent high or below recent low
  return currentCandle.close > recentHigh || currentCandle.close < recentLow;
}

/**
 * Market Leader Divergence Strategy implementation
 */
const marketLeaderDivergence: Strategy = {
  name: 'market-leader-divergence',
  description:
    'Trend-following divergence strategy that combines EMA crossovers, volume spikes, and mean reversion. Enters when price diverges from the trend (lags behind), anticipating catch-up momentum.',
  version: '1.0.0',

  params: [
    {
      name: 'fastEMA',
      label: 'Fast EMA Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 50,
      step: 5,
      description: 'Period for the fast EMA (trend detection)',
    },
    {
      name: 'slowEMA',
      label: 'Slow EMA Period',
      type: 'number',
      default: 50,
      min: 20,
      max: 200,
      step: 10,
      description: 'Period for the slow EMA (trend detection)',
    },
    {
      name: 'volumeMultiplier',
      label: 'Volume Multiplier',
      type: 'number',
      default: 1.5,
      min: 1.0,
      max: 3.0,
      step: 0.1,
      description: 'Volume spike threshold (multiplier of average volume)',
    },
    {
      name: 'lookbackPeriod',
      label: 'Lookback Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 50,
      step: 5,
      description: 'Period to check for recent breakouts',
    },
    {
      name: 'stopLossPercent',
      label: 'Stop Loss %',
      type: 'number',
      default: 2,
      min: 0.5,
      max: 5,
      step: 0.5,
      description: 'Stop loss percentage from entry price',
    },
    {
      name: 'takeProfitPercent',
      label: 'Take Profit %',
      type: 'number',
      default: 4,
      min: 1,
      max: 10,
      step: 0.5,
      description: 'Take profit percentage from entry price',
    },
    {
      name: 'positionSizePercent',
      label: 'Position Size %',
      type: 'number',
      default: 95,
      min: 10,
      max: 100,
      step: 5,
      description: 'Position size as percentage of available balance',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Open short positions on bearish divergence',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const fastEMA = params.fastEMA as number;
    const slowEMA = params.slowEMA as number;

    // Validate that fast period is less than slow period
    if (fastEMA >= slowEMA) {
      throw new Error(
        `Fast EMA (${fastEMA}) must be less than slow EMA (${slowEMA})`
      );
    }

    context.log(
      `Initialized Market Leader Divergence with fastEMA=${fastEMA}, slowEMA=${slowEMA}, ` +
        `volumeMult=${params.volumeMultiplier}, lookback=${params.lookbackPeriod}, ` +
        `stopLoss=${params.stopLossPercent}%, takeProfit=${params.takeProfitPercent}%, ` +
        `posSize=${params.positionSizePercent}%, shorts=${params.enableShorts}`
    );
  },

  onBar(context: StrategyContext): void {
    const {
      candles,
      currentIndex,
      params,
      longPosition,
      shortPosition,
      balance,
      currentCandle,
    } = context;

    const fastEMA = params.fastEMA as number;
    const slowEMA = params.slowEMA as number;
    const volumeMultiplier = params.volumeMultiplier as number;
    const lookbackPeriod = params.lookbackPeriod as number;
    const stopLossPercent = params.stopLossPercent as number;
    const takeProfitPercent = params.takeProfitPercent as number;
    const positionSizePercent = params.positionSizePercent as number;
    const enableShorts = params.enableShorts as boolean;

    // Need enough candles for calculations
    if (currentIndex < Math.max(slowEMA, lookbackPeriod)) {
      return;
    }

    // Get data up to current candle (use candleView for efficiency)
    const closes = context.candleView.closes();
    const volumes = context.candleView.volumes();
    const candlesUpToCurrent = context.candleView.slice();

    // Calculate EMAs
    const fastEMAValues = calculateEMA(closes, fastEMA);
    const slowEMAValues = calculateEMA(closes, slowEMA);

    const currentFast = fastEMAValues[fastEMAValues.length - 1];
    const currentSlow = slowEMAValues[slowEMAValues.length - 1];

    if (currentFast === undefined || currentSlow === undefined) {
      return;
    }

    const currentPrice = currentCandle.close;
    const currentVolume = currentCandle.volume;

    // Calculate average volume
    const avgVolume = calculateAverageVolume(volumes, lookbackPeriod);

    // Detect volume spike
    const isVolumeSpike = currentVolume > volumeMultiplier * avgVolume;

    // Determine trend
    const isBullishTrend = currentFast > currentSlow;
    const isBearishTrend = currentFast < currentSlow;

    // Detect divergence (price lagging behind trend)
    const bullishDivergence = isBullishTrend && currentPrice < currentFast;
    const bearishDivergence = isBearishTrend && currentPrice > currentFast;

    // Check for recent breakout (avoid entering right after breakout)
    const hasBreakout = hasRecentBreakout(candlesUpToCurrent, lookbackPeriod);

    // ===== MANAGE EXISTING POSITIONS =====

    // Manage long position
    if (longPosition) {
      const entryPrice = longPosition.entryPrice;
      const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
      const takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100);

      // Exit conditions
      const hitStopLoss = currentPrice <= stopLossPrice;
      const hitTakeProfit = currentPrice >= takeProfitPrice;
      const divergenceResolved = currentPrice >= currentFast; // Price caught up

      if (hitStopLoss) {
        context.log(
          `CLOSE LONG (Stop Loss): Price ${currentPrice.toFixed(2)} hit stop at ${stopLossPrice.toFixed(2)}`
        );
        context.closeLong();
      } else if (hitTakeProfit) {
        context.log(
          `CLOSE LONG (Take Profit): Price ${currentPrice.toFixed(2)} hit target at ${takeProfitPrice.toFixed(2)}`
        );
        context.closeLong();
      } else if (divergenceResolved) {
        context.log(
          `CLOSE LONG (Divergence Resolved): Price ${currentPrice.toFixed(2)} caught up to fast EMA ${currentFast.toFixed(2)}`
        );
        context.closeLong();
      }
    }

    // Manage short position
    if (shortPosition) {
      const entryPrice = shortPosition.entryPrice;
      const stopLossPrice = entryPrice * (1 + stopLossPercent / 100);
      const takeProfitPrice = entryPrice * (1 - takeProfitPercent / 100);

      // Exit conditions
      const hitStopLoss = currentPrice >= stopLossPrice;
      const hitTakeProfit = currentPrice <= takeProfitPrice;
      const divergenceResolved = currentPrice <= currentFast; // Price caught up

      if (hitStopLoss) {
        context.log(
          `CLOSE SHORT (Stop Loss): Price ${currentPrice.toFixed(2)} hit stop at ${stopLossPrice.toFixed(2)}`
        );
        context.closeShort();
      } else if (hitTakeProfit) {
        context.log(
          `CLOSE SHORT (Take Profit): Price ${currentPrice.toFixed(2)} hit target at ${takeProfitPrice.toFixed(2)}`
        );
        context.closeShort();
      } else if (divergenceResolved) {
        context.log(
          `CLOSE SHORT (Divergence Resolved): Price ${currentPrice.toFixed(2)} caught up to fast EMA ${currentFast.toFixed(2)}`
        );
        context.closeShort();
      }
    }

    // ===== ENTRY SIGNALS =====

    // Bullish divergence entry
    if (
      !longPosition &&
      !shortPosition &&
      bullishDivergence &&
      isVolumeSpike &&
      !hasBreakout
    ) {
      const positionValue = balance * (positionSizePercent / 100);
      const amount = positionValue / currentPrice;

      if (amount > 0) {
        context.log(
          `OPEN LONG: Bullish divergence detected - ` +
            `Price ${currentPrice.toFixed(2)} < Fast EMA ${currentFast.toFixed(2)}, ` +
            `Volume spike ${currentVolume.toFixed(0)} > ${(avgVolume * volumeMultiplier).toFixed(0)}`
        );
        context.openLong(amount);
      }
    }

    // Bearish divergence entry
    if (
      !longPosition &&
      !shortPosition &&
      enableShorts &&
      bearishDivergence &&
      isVolumeSpike &&
      !hasBreakout
    ) {
      const positionValue = balance * (positionSizePercent / 100);
      const amount = positionValue / currentPrice;

      if (amount > 0) {
        context.log(
          `OPEN SHORT: Bearish divergence detected - ` +
            `Price ${currentPrice.toFixed(2)} > Fast EMA ${currentFast.toFixed(2)}, ` +
            `Volume spike ${currentVolume.toFixed(0)} > ${(avgVolume * volumeMultiplier).toFixed(0)}`
        );
        context.openShort(amount);
      }
    }

    // Close opposite position before entering new trade
    if (bullishDivergence && isVolumeSpike && shortPosition) {
      context.log('Closing short position before potential long entry');
      context.closeShort();
    }

    if (bearishDivergence && isVolumeSpike && longPosition) {
      context.log('Closing long position before potential short entry');
      context.closeLong();
    }
  },

  onEnd(context: StrategyContext): void {
    // Close any remaining positions at the end of the backtest
    const { longPosition, shortPosition } = context;

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

export default marketLeaderDivergence;
