import type { Strategy, StrategyContext } from '../src/strategy/base.js';

/**
 * Prediction Market Mean Reversion Strategy
 *
 * Bollinger Band mean reversion strategy for prediction market probabilities.
 * Assumes that extreme probability deviations from the mean will revert.
 *
 * Logic:
 * - Calculate Bollinger Bands (SMA ± stddev * multiplier)
 * - Enter LONG when price crosses below lower band (oversold)
 * - Enter SHORT when price crosses above upper band (overbought)
 * - Exit positions when price approaches the mean (SMA ± exitStdDev)
 * - Filter out trades in extreme zones (near 0 or 1) and tight ranges
 *
 * Price values represent probabilities in range [0, 1]
 */

interface StrategyState {
  lastExitBar: number;
  priceHistory: number[];
}

const pmMeanReversion: Strategy = {
  name: 'pm-mean-reversion',
  description: 'Bollinger Band mean reversion for prediction market probabilities',
  version: '1.0.0',

  params: [
    {
      name: 'bbPeriod',
      label: 'BB Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 100,
      step: 5,
      description: 'Bollinger Band lookback period',
    },
    {
      name: 'bbStdDev',
      label: 'BB Std Dev',
      type: 'number',
      default: 2.0,
      min: 0.5,
      max: 4.0,
      step: 0.1,
      description: 'Standard deviations for bands',
    },
    {
      name: 'exitStdDev',
      label: 'Exit Std Dev',
      type: 'number',
      default: 0.5,
      min: 0.0,
      max: 2.0,
      step: 0.1,
      description: 'Std devs from mean for exit signal',
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 25,
      min: 5,
      max: 100,
      step: 5,
      description: '% of equity per trade',
    },
    {
      name: 'maxPositionUSD',
      label: 'Max Position USD',
      type: 'number',
      default: 5000,
      min: 100,
      max: 50000,
      step: 100,
      description: 'Hard cap on position size',
    },
    {
      name: 'avoidExtremesPct',
      label: 'Avoid Extremes %',
      type: 'number',
      default: 5,
      min: 0,
      max: 20,
      step: 1,
      description: 'Skip when price within X% of 0 or 1',
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 3,
      min: 0,
      max: 20,
      step: 1,
      description: 'Bars to wait after closing a position',
    },
    {
      name: 'minProfitPct',
      label: 'Min Profit %',
      type: 'number',
      default: 4,
      min: 0,
      max: 20,
      step: 0.5,
      description: 'Minimum expected profit to enter',
    },
    {
      name: 'minBBWidth',
      label: 'Min BB Width',
      type: 'number',
      default: 0.08,
      min: 0.01,
      max: 0.5,
      step: 0.01,
      description: 'Minimum BB width to trade (avoid tight ranges)',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;

    // Initialize state
    const state: StrategyState = {
      lastExitBar: -1000,
      priceHistory: [],
    };

    (this as any)._state = state;

    context.log(
      `Initialized PM Mean Reversion: bbPeriod=${params.bbPeriod}, bbStdDev=${params.bbStdDev}, exitStdDev=${params.exitStdDev}, positionSize=${params.positionSizePct}%, maxPosition=${params.maxPositionUSD}, avoidExtremes=${params.avoidExtremesPct}%, cooldown=${params.cooldownBars}, minProfit=${params.minProfitPct}%, minBBWidth=${params.minBBWidth}`
    );
  },

  onBar(this: Strategy, context: StrategyContext): void {
    const {
      candles,
      currentIndex,
      currentCandle,
      params,
      longPosition,
      shortPosition,
      equity,
    } = context;

    const state = (this as any)._state as StrategyState;
    if (!state) return;

    // Extract parameters
    const bbPeriod = params.bbPeriod as number;
    const bbStdDev = params.bbStdDev as number;
    const exitStdDev = params.exitStdDev as number;
    const positionSizePct = params.positionSizePct as number;
    const maxPositionUSD = params.maxPositionUSD as number;
    const avoidExtremesPct = params.avoidExtremesPct as number;
    const cooldownBars = params.cooldownBars as number;
    const minProfitPct = params.minProfitPct as number;
    const minBBWidth = params.minBBWidth as number;

    const currentPrice = currentCandle.close;

    // Skip forward-filled candles (no real trading)
    if (currentCandle.volume === 0) {
      return;
    }

    // Build price history
    state.priceHistory.push(currentPrice);
    if (state.priceHistory.length > bbPeriod) {
      state.priceHistory.shift(); // Keep only bbPeriod bars
    }

    // Need at least bbPeriod bars to calculate Bollinger Bands
    if (currentIndex < bbPeriod) {
      return;
    }

    // Calculate Bollinger Bands
    const prices = state.priceHistory;
    const sma = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    // Calculate standard deviation
    const squaredDiffs = prices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / prices.length;
    const stddev = Math.sqrt(variance);

    const upperBand = sma + bbStdDev * stddev;
    const lowerBand = sma - bbStdDev * stddev;
    const bbWidth = upperBand - lowerBand;

    // Filter: Skip if BB width is too narrow (tight range, no mean reversion opportunity)
    if (bbWidth < minBBWidth) {
      return;
    }

    // Filter: Avoid extremes (prices near 0 or 1)
    const extremeLowerBound = avoidExtremesPct / 100;
    const extremeUpperBound = 1 - (avoidExtremesPct / 100);
    const isInExtremeZone = currentPrice < extremeLowerBound || currentPrice > extremeUpperBound;

    // === EXIT LOGIC ===

    if (longPosition) {
      // Exit long when price approaches mean from below
      const exitThreshold = sma - exitStdDev * stddev;

      if (currentPrice >= exitThreshold) {
        const barsHeld = currentIndex - (longPosition as any).entryBar || 0;
        context.log(
          `EXIT LONG: Price ${(currentPrice * 100).toFixed(1)}% >= exit threshold ${(exitThreshold * 100).toFixed(1)}% (mean reversion), held ${barsHeld} bars`
        );
        context.closeLong();
        state.lastExitBar = currentIndex;
        return;
      }

      // Safety exit: Price moved into extreme zone
      if (currentPrice < extremeLowerBound) {
        const barsHeld = currentIndex - (longPosition as any).entryBar || 0;
        context.log(
          `EXIT LONG: Price in extreme zone (${(currentPrice * 100).toFixed(1)}% < ${(extremeLowerBound * 100).toFixed(1)}%), held ${barsHeld} bars`
        );
        context.closeLong();
        state.lastExitBar = currentIndex;
        return;
      }
    }

    if (shortPosition) {
      // Exit short when price approaches mean from above
      const exitThreshold = sma + exitStdDev * stddev;

      if (currentPrice <= exitThreshold) {
        const barsHeld = currentIndex - (shortPosition as any).entryBar || 0;
        context.log(
          `EXIT SHORT: Price ${(currentPrice * 100).toFixed(1)}% <= exit threshold ${(exitThreshold * 100).toFixed(1)}% (mean reversion), held ${barsHeld} bars`
        );
        context.closeShort();
        state.lastExitBar = currentIndex;
        return;
      }

      // Safety exit: Price moved into extreme zone
      if (currentPrice > extremeUpperBound) {
        const barsHeld = currentIndex - (shortPosition as any).entryBar || 0;
        context.log(
          `EXIT SHORT: Price in extreme zone (${(currentPrice * 100).toFixed(1)}% > ${(extremeUpperBound * 100).toFixed(1)}%), held ${barsHeld} bars`
        );
        context.closeShort();
        state.lastExitBar = currentIndex;
        return;
      }
    }

    // === ENTRY LOGIC ===

    // Only enter if not already in a position and not in extreme zone
    if (!longPosition && !shortPosition && !isInExtremeZone) {
      // Cooldown check: ensure enough bars have passed since last exit
      if (currentIndex - state.lastExitBar < cooldownBars) {
        return;
      }

      // Entry LONG: Price crossed below lower band (oversold, expect reversion up)
      if (currentPrice < lowerBand) {
        // Profit filter: estimate potential profit from mean reversion
        const expectedProfit = ((sma - currentPrice) / currentPrice) * 100;

        if (expectedProfit >= minProfitPct) {
          const positionValue = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN LONG: Price ${(currentPrice * 100).toFixed(1)}% < lower band ${(lowerBand * 100).toFixed(1)}%, expected profit ${expectedProfit.toFixed(2)}%`
            );
            context.openLong(amount);
            // Store entry bar for exit tracking
            if (context.longPosition) {
              (context.longPosition as any).entryBar = currentIndex;
            }
          }
        }
      }

      // Entry SHORT: Price crossed above upper band (overbought, expect reversion down)
      if (currentPrice > upperBand) {
        // Profit filter: estimate potential profit from mean reversion
        const expectedProfit = ((currentPrice - sma) / currentPrice) * 100;

        if (expectedProfit >= minProfitPct) {
          const positionValue = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN SHORT: Price ${(currentPrice * 100).toFixed(1)}% > upper band ${(upperBand * 100).toFixed(1)}%, expected profit ${expectedProfit.toFixed(2)}%`
            );
            context.openShort(amount);
            // Store entry bar for exit tracking
            if (context.shortPosition) {
              (context.shortPosition as any).entryBar = currentIndex;
            }
          }
        }
      }
    }
  },

  onEnd(context: StrategyContext): void {
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

export default pmMeanReversion;
