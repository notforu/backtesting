/**
 * Funding Rate Spike Trading Strategy
 *
 * Trades against extreme funding rates in perpetual futures.
 * When crowd is overleveraged long (high positive FR), goes short.
 * When crowd is overleveraged short (negative FR), goes long.
 * The trader gets PAID funding while holding the contrarian position.
 *
 * Requires futures mode: --mode=futures
 * Requires funding rate data: run scripts/cache-funding-rates.ts first
 */

import type { Strategy, StrategyContext, StrategyParam } from '../src/strategy/base.js';

const strategy: Strategy = {
  name: 'funding-rate-spike',
  description:
    'Contrarian strategy: short when crowd is overleveraged long (high positive FR), long when overleveraged short (negative FR). Earns funding while holding position.',
  version: '1.0.0',

  params: [
    {
      name: 'fundingThresholdShort',
      type: 'number',
      default: 0.0005,
      min: 0.0001,
      max: 0.01,
      step: 0.0001,
      description: 'Enter short when funding rate > this (e.g., 0.0005 = 0.05%)',
    },
    {
      name: 'fundingThresholdLong',
      type: 'number',
      default: -0.0003,
      min: -0.01,
      max: 0,
      step: 0.0001,
      description: 'Enter long when funding rate < this (e.g., -0.0003 = -0.03%)',
    },
    {
      name: 'holdingPeriods',
      type: 'number',
      default: 3,
      min: 1,
      max: 20,
      step: 1,
      description: 'Hold for N funding periods (each is 8 hours)',
    },
    {
      name: 'stopLossPct',
      type: 'number',
      default: 3.0,
      min: 0.5,
      max: 20,
      step: 0.5,
      description: 'Stop loss percentage',
    },
    {
      name: 'takeProfitPct',
      type: 'number',
      default: 4.0,
      min: 0.5,
      max: 20,
      step: 0.5,
      description: 'Take profit percentage',
    },
    {
      name: 'positionSizePct',
      type: 'number',
      default: 90,
      min: 10,
      max: 100,
      step: 10,
      description: 'Percentage of equity to deploy per trade',
    },
    {
      name: 'lookbackBars',
      type: 'number',
      default: 24,
      min: 6,
      max: 100,
      step: 1,
      description: 'Bars of funding rate history for rolling statistics',
    },
    {
      name: 'useZScore',
      type: 'boolean',
      default: false,
      description: 'Use z-score based thresholds instead of absolute values',
    },
    {
      name: 'zScoreThreshold',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 4.0,
      step: 0.1,
      description: 'Z-score threshold for entry (if useZScore is true)',
    },
  ] as StrategyParam[],

  onBar(context: StrategyContext): void {
    const {
      fundingRates,
      longPosition,
      shortPosition,
      equity,
      currentCandle,
      params,
    } = context;

    // Only trade when we have funding rate data
    if (!fundingRates || fundingRates.length === 0) return;

    const fundingThresholdShort = params.fundingThresholdShort as number;
    const fundingThresholdLong = params.fundingThresholdLong as number;
    const holdingPeriods = params.holdingPeriods as number;
    const stopLossPct = params.stopLossPct as number;
    const takeProfitPct = params.takeProfitPct as number;
    const positionSizePct = params.positionSizePct as number;
    const lookbackBars = params.lookbackBars as number;
    const useZScore = params.useZScore as boolean;
    const zScoreThreshold = params.zScoreThreshold as number;

    const price = currentCandle.close;

    // Get recent funding rates up to and including current bar
    const recentRates = fundingRates.filter(fr => fr.timestamp <= currentCandle.timestamp);
    if (recentRates.length === 0) return;

    const latestFR = recentRates[recentRates.length - 1];
    const currentRate = latestFR.fundingRate;

    // Calculate rolling statistics from lookback window
    const lookbackRates = recentRates.slice(-lookbackBars);
    const mean = lookbackRates.reduce((s, r) => s + r.fundingRate, 0) / lookbackRates.length;
    const variance =
      lookbackRates.reduce((s, r) => s + Math.pow(r.fundingRate - mean, 2), 0) /
      lookbackRates.length;
    const std = Math.sqrt(variance);
    const zScore = std > 0 ? (currentRate - mean) / std : 0;

    // Manage existing long position
    if (longPosition) {
      // Check stop-loss against candle LOW (worst price for longs during the bar)
      const worstLongPnlPct =
        ((currentCandle.low - longPosition.entryPrice) / longPosition.entryPrice) * 100;
      if (worstLongPnlPct <= -stopLossPct) {
        context.closeLong();
        return;
      }

      // Check take-profit against candle HIGH (best price for longs during the bar)
      const bestLongPnlPct =
        ((currentCandle.high - longPosition.entryPrice) / longPosition.entryPrice) * 100;
      if (bestLongPnlPct >= takeProfitPct) {
        context.closeLong();
        return;
      }

      // Time-based exit: held for enough funding periods (8h each)
      const holdTimeMs = holdingPeriods * 8 * 60 * 60 * 1000;
      if (currentCandle.timestamp - longPosition.entryTime >= holdTimeMs) {
        context.closeLong();
        return;
      }

      // FR normalization exit: funding rate has returned toward neutral
      if (currentRate > fundingThresholdLong / 2) {
        context.closeLong();
        return;
      }

      return; // Don't open new positions while one is open
    }

    // Manage existing short position
    if (shortPosition) {
      // Check stop-loss against candle HIGH (worst price for shorts during the bar)
      const worstShortPnlPct =
        ((shortPosition.entryPrice - currentCandle.high) / shortPosition.entryPrice) * 100;
      if (worstShortPnlPct <= -stopLossPct) {
        context.closeShort();
        return;
      }

      // Check take-profit against candle LOW (best price for shorts during the bar)
      const bestShortPnlPct =
        ((shortPosition.entryPrice - currentCandle.low) / shortPosition.entryPrice) * 100;
      if (bestShortPnlPct >= takeProfitPct) {
        context.closeShort();
        return;
      }

      // Time-based exit
      const holdTimeMs = holdingPeriods * 8 * 60 * 60 * 1000;
      if (currentCandle.timestamp - shortPosition.entryTime >= holdTimeMs) {
        context.closeShort();
        return;
      }

      // FR normalization exit: funding rate has returned toward neutral
      if (currentRate < fundingThresholdShort / 2) {
        context.closeShort();
        return;
      }

      return; // Don't open new positions while one is open
    }

    // Entry logic - only when no position is open
    const positionSize = (equity * positionSizePct / 100) / price;

    if (positionSize <= 0) return;

    if (useZScore) {
      // Z-score based entry
      if (zScore > zScoreThreshold) {
        // Extremely high FR (crowd overleveraged long) -> go short
        context.openShort(positionSize);
      } else if (zScore < -zScoreThreshold) {
        // Extremely negative FR (crowd overleveraged short) -> go long
        context.openLong(positionSize);
      }
    } else {
      // Absolute threshold entry
      if (currentRate > fundingThresholdShort) {
        // High positive FR -> short (contrarian + earn funding)
        context.openShort(positionSize);
      } else if (currentRate < fundingThresholdLong) {
        // Negative FR -> long (contrarian + earn funding)
        context.openLong(positionSize);
      }
    }
  },

  onEnd(context: StrategyContext): void {
    // Close any open position at end of backtest
    if (context.longPosition) {
      context.closeLong();
    }
    if (context.shortPosition) {
      context.closeShort();
    }
  },
};

export default strategy;
