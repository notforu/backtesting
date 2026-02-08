/**
 * Pairs Z-Score Mean Reversion Scalper
 *
 * Statistical arbitrage strategy trading mean reversion in spread between correlated pairs.
 * Computes spread = log(priceA) - hedgeRatio * log(priceB), enters on z-score extremes.
 *
 * Entry: |z-score| > entryZScore
 * Exit: z-score reverts to exitZScore, OR exceeds stopZScore, OR maxHoldBars
 *
 * Recommended pairs: BTC/ETH, SOL/AVAX
 */

import type { PairsStrategy, PairsStrategyContext } from '../src/strategy/pairs-base.js';

// ============================================================================
// Inline Helper Functions (no external dependencies)
// ============================================================================

function rollingMean(arr: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = start; i <= end; i++) sum += arr[i];
  return sum / (end - start + 1);
}

function rollingStd(arr: number[], start: number, end: number, mean: number): number {
  let sumSq = 0;
  for (let i = start; i <= end; i++) sumSq += (arr[i] - mean) ** 2;
  return Math.sqrt(sumSq / (end - start + 1));
}

function rollingCorrelation(arrA: number[], arrB: number[], start: number, end: number): number {
  const n = end - start + 1;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = start; i <= end; i++) {
    sumA += arrA[i]; sumB += arrB[i];
    sumAB += arrA[i] * arrB[i];
    sumA2 += arrA[i] ** 2; sumB2 += arrB[i] ** 2;
  }
  const denom = Math.sqrt((n * sumA2 - sumA ** 2) * (n * sumB2 - sumB ** 2));
  return denom === 0 ? 0 : (n * sumAB - sumA * sumB) / denom;
}

// ============================================================================
// Strategy Implementation
// ============================================================================

const strategy: PairsStrategy = {
  name: 'pairs-zscore-scalper',
  description: 'Z-Score mean reversion pairs scalper trading spread divergences between correlated assets',
  version: '1.0.0',
  isPairs: true,

  params: [
    {
      name: 'lookbackPeriod',
      label: 'Lookback Period',
      type: 'number',
      default: 60,
      min: 20,
      max: 120,
      step: 10,
      description: 'Hedge ratio lookback window'
    },
    {
      name: 'zScorePeriod',
      label: 'Z-Score Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 40,
      step: 5,
      description: 'Z-score rolling window'
    },
    {
      name: 'entryZScore',
      label: 'Entry Z-Score',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 3.0,
      step: 0.25,
      description: 'Entry threshold'
    },
    {
      name: 'exitZScore',
      label: 'Exit Z-Score',
      type: 'number',
      default: 0.0,
      min: -0.5,
      max: 0.5,
      step: 0.25,
      description: 'Mean reversion exit threshold'
    },
    {
      name: 'stopZScore',
      label: 'Stop Z-Score',
      type: 'number',
      default: 3.5,
      min: 2.5,
      max: 5.0,
      step: 0.5,
      description: 'Stop loss threshold'
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 100,
      min: 20,
      max: 200,
      step: 20,
      description: 'Time-based exit'
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 80,
      min: 50,
      max: 95,
      step: 5,
      description: '% of capital per trade'
    },
    {
      name: 'minCorrelation',
      label: 'Min Correlation',
      type: 'number',
      default: 0.7,
      min: 0.5,
      max: 0.9,
      step: 0.1,
      description: 'Minimum correlation to trade'
    },
  ],

  init(ctx: PairsStrategyContext): void {
    ctx.log(`Pairs Z-Score Mean Reversion Scalper initialized`);
    ctx.log(`Trading pair: ${ctx.symbolA} / ${ctx.symbolB}`);
    ctx.log(`Params: ${JSON.stringify(ctx.params)}`);
  },

  onBar: (() => {
    // Closure variables to track state across bars
    const logPricesA: number[] = [];
    const logPricesB: number[] = [];
    const spreads: number[] = [];
    let barsInPosition = 0;
    let positionType: 'long-spread' | 'short-spread' | null = null; // long-spread = long A, short B

    return (ctx: PairsStrategyContext): void => {
      const {
        candleA,
        candleB,
        params,
        equity,
        longPositionA,
        shortPositionA,
        longPositionB,
        shortPositionB,
      } = ctx;

      // Extract parameters
      const lookbackPeriod = params.lookbackPeriod as number;
      const zScorePeriod = params.zScorePeriod as number;
      const entryZScore = params.entryZScore as number;
      const exitZScore = params.exitZScore as number;
      const stopZScore = params.stopZScore as number;
      const maxHoldBars = params.maxHoldBars as number;
      const positionSizePct = params.positionSizePct as number;
      const minCorrelation = params.minCorrelation as number;

      const priceA = candleA.close;
      const priceB = candleB.close;

      // Store log prices
      logPricesA.push(Math.log(priceA));
      logPricesB.push(Math.log(priceB));

      const dataLength = logPricesA.length;

      // Need enough data for lookback
      if (dataLength < lookbackPeriod) {
        return;
      }

      // Compute rolling hedge ratio
      const startLookback = dataLength - lookbackPeriod;
      const endLookback = dataLength - 1;
      const meanA = rollingMean(logPricesA, startLookback, endLookback);
      const meanB = rollingMean(logPricesB, startLookback, endLookback);
      const hedgeRatio = Math.exp(meanA) / Math.exp(meanB);

      // Compute spread
      const spread = logPricesA[dataLength - 1] - hedgeRatio * logPricesB[dataLength - 1];
      spreads.push(spread);

      // Need enough spread data for z-score
      if (spreads.length < zScorePeriod) {
        return;
      }

      // Compute z-score of spread
      const startZ = spreads.length - zScorePeriod;
      const endZ = spreads.length - 1;
      const spreadMean = rollingMean(spreads, startZ, endZ);
      const spreadStd = rollingStd(spreads, startZ, endZ, spreadMean);

      if (spreadStd === 0) {
        return; // Avoid division by zero
      }

      const zScore = (spread - spreadMean) / spreadStd;

      // Compute rolling correlation
      const correlation = rollingCorrelation(logPricesA, logPricesB, startLookback, endLookback);

      // Check if in position
      const inPosition = longPositionA !== null || shortPositionA !== null ||
                         longPositionB !== null || shortPositionB !== null;

      if (inPosition) {
        barsInPosition++;
      }

      // Exit logic
      if (inPosition && positionType !== null) {
        let shouldExit = false;
        let exitReason = '';

        // Time stop
        if (barsInPosition >= maxHoldBars) {
          shouldExit = true;
          exitReason = 'time-stop';
        }

        // Mean reversion exit
        if (positionType === 'short-spread') {
          // Short spread: entered when z > entryZScore, exit when z <= exitZScore
          if (zScore <= exitZScore) {
            shouldExit = true;
            exitReason = 'mean-reversion';
          }
          // Stop loss: z exceeds stopZScore (spread widens further)
          if (zScore > stopZScore) {
            shouldExit = true;
            exitReason = 'stop-loss';
          }
        } else if (positionType === 'long-spread') {
          // Long spread: entered when z < -entryZScore, exit when z >= -exitZScore
          if (zScore >= -exitZScore) {
            shouldExit = true;
            exitReason = 'mean-reversion';
          }
          // Stop loss: z below -stopZScore (spread narrows further)
          if (zScore < -stopZScore) {
            shouldExit = true;
            exitReason = 'stop-loss';
          }
        }

        if (shouldExit) {
          // Close all positions
          if (longPositionA) ctx.closeLongA();
          if (shortPositionA) ctx.closeShortA();
          if (longPositionB) ctx.closeLongB();
          if (shortPositionB) ctx.closeShortB();

          ctx.log(`Exit ${positionType} at z=${zScore.toFixed(2)} (${exitReason}) after ${barsInPosition} bars`);
          barsInPosition = 0;
          positionType = null;
        }
      }

      // Entry logic (only if no position and correlation is sufficient)
      if (!inPosition && correlation >= minCorrelation) {
        const notionalPerLeg = equity * (positionSizePct / 100) / 2;

        // Short spread: spread too wide (z > entryZScore)
        // Expect spread to narrow: short A, long B
        if (zScore > entryZScore) {
          const amountA = notionalPerLeg / priceA;
          const amountB = notionalPerLeg / priceB;

          ctx.openShortA(amountA);
          ctx.openLongB(amountB);

          positionType = 'short-spread';
          barsInPosition = 0;
          ctx.log(`Enter short-spread at z=${zScore.toFixed(2)}, corr=${correlation.toFixed(2)}, hedge=${hedgeRatio.toFixed(4)}`);
        }
        // Long spread: spread too narrow (z < -entryZScore)
        // Expect spread to widen: long A, short B
        else if (zScore < -entryZScore) {
          const amountA = notionalPerLeg / priceA;
          const amountB = notionalPerLeg / priceB;

          ctx.openLongA(amountA);
          ctx.openShortB(amountB);

          positionType = 'long-spread';
          barsInPosition = 0;
          ctx.log(`Enter long-spread at z=${zScore.toFixed(2)}, corr=${correlation.toFixed(2)}, hedge=${hedgeRatio.toFixed(4)}`);
        }
      }
    };
  })(),

  onEnd(ctx: PairsStrategyContext): void {
    // Close any remaining positions
    if (ctx.longPositionA) ctx.closeLongA();
    if (ctx.shortPositionA) ctx.closeShortA();
    if (ctx.longPositionB) ctx.closeLongB();
    if (ctx.shortPositionB) ctx.closeShortB();

    ctx.log(`Strategy ended. Final equity: $${ctx.equity.toFixed(2)}`);
  },
};

export default strategy;
