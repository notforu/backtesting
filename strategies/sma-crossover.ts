/**
 * SMA Crossover Strategy
 *
 * A classic trend-following strategy that generates signals based on
 * the crossover of two Simple Moving Averages (SMAs).
 *
 * Entry Rules:
 * - Open long when the fast SMA crosses above the slow SMA
 * - This indicates upward momentum
 *
 * Exit Rules:
 * - Close long when the fast SMA crosses below the slow SMA
 * - This indicates downward momentum
 *
 * Parameters:
 * - fastPeriod: Period for the fast-moving SMA (default: 10)
 * - slowPeriod: Period for the slow-moving SMA (default: 20)
 * - enableShorts: Whether to open short positions on bearish crossover (default: false)
 *
 * Usage:
 * This strategy works best in trending markets. Avoid using in
 * sideways/ranging markets where whipsaws can occur.
 */

import ti from 'technicalindicators';
const { SMA } = ti;
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

/**
 * Calculate SMA values from candle close prices
 */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  const result = SMA.calculate({
    values: closes,
    period: period,
  });

  // Pad the beginning with undefined values to align with candles
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * SMA Crossover Strategy implementation
 */
const smaCrossover: Strategy = {
  name: 'sma-crossover',
  description:
    'Trend-following strategy using Simple Moving Average crossovers. Opens long when fast SMA crosses above slow SMA, closes when it crosses below. Optionally supports short positions.',
  version: '2.0.0',

  params: [
    {
      name: 'fastPeriod',
      label: 'Fast Period',
      type: 'number',
      default: 10,
      min: 2,
      max: 100,
      step: 1,
      description: 'Period for the fast-moving SMA',
    },
    {
      name: 'slowPeriod',
      label: 'Slow Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 200,
      step: 1,
      description: 'Period for the slow-moving SMA',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: false,
      description: 'Open short positions on bearish crossover',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const fastPeriod = params.fastPeriod as number;
    const slowPeriod = params.slowPeriod as number;

    // Validate that fast period is less than slow period
    if (fastPeriod >= slowPeriod) {
      throw new Error(
        `Fast period (${fastPeriod}) must be less than slow period (${slowPeriod})`
      );
    }

    context.log(
      `Initialized SMA Crossover with fast=${fastPeriod}, slow=${slowPeriod}, shorts=${params.enableShorts}`
    );
  },

  onBar(context: StrategyContext): void {
    const { candles, currentIndex, params, longPosition, shortPosition, balance } = context;

    const fastPeriod = params.fastPeriod as number;
    const slowPeriod = params.slowPeriod as number;
    const enableShorts = params.enableShorts as boolean;

    // Need at least slowPeriod + 1 candles to calculate crossover
    if (currentIndex < slowPeriod) {
      return;
    }

    // Get close prices up to current candle (use candleView for efficiency)
    const closes = context.candleView.closes();

    // Calculate SMAs
    const fastSMA = calculateSMA(closes, fastPeriod);
    const slowSMA = calculateSMA(closes, slowPeriod);

    // Get current and previous SMA values
    const currentFast = fastSMA[fastSMA.length - 1];
    const currentSlow = slowSMA[slowSMA.length - 1];
    const prevFast = fastSMA[fastSMA.length - 2];
    const prevSlow = slowSMA[slowSMA.length - 2];

    // Check if we have valid SMA values
    if (
      currentFast === undefined ||
      currentSlow === undefined ||
      prevFast === undefined ||
      prevSlow === undefined
    ) {
      return;
    }

    const currentPrice = context.currentCandle.close;

    // Bullish crossover: fast crosses above slow
    if (prevFast <= prevSlow && currentFast > currentSlow) {
      // Close any short position first
      if (shortPosition) {
        context.log(
          `Closing short before going long - Fast SMA (${currentFast.toFixed(2)}) crossed above Slow SMA (${currentSlow.toFixed(2)})`
        );
        context.closeShort();
      }

      // Open long if not already in a long position
      if (!longPosition) {
        // Calculate position size (use 95% of available balance)
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG signal: Fast SMA (${currentFast.toFixed(2)}) crossed above Slow SMA (${currentSlow.toFixed(2)})`
          );
          context.openLong(amount);
        }
      }
    }

    // Bearish crossover: fast crosses below slow
    if (prevFast >= prevSlow && currentFast < currentSlow) {
      // Close any long position
      if (longPosition) {
        context.log(
          `CLOSE LONG signal: Fast SMA (${currentFast.toFixed(2)}) crossed below Slow SMA (${currentSlow.toFixed(2)})`
        );
        context.closeLong();
      }

      // Open short if enabled and not already in a short position
      if (enableShorts && !shortPosition) {
        // Calculate position size (use 95% of available balance)
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT signal: Fast SMA (${currentFast.toFixed(2)}) crossed below Slow SMA (${currentSlow.toFixed(2)})`
          );
          context.openShort(amount);
        }
      }
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

export default smaCrossover;
