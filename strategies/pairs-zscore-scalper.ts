/**
 * Pairs Z-Score Mean Reversion Scalper v2
 *
 * Statistical arbitrage strategy trading mean reversion in spread between correlated pairs.
 * Uses OLS regression hedge ratio for proper cointegration-based spread construction.
 *
 * v2 improvements over v1:
 * - Minimum expected profit filter (covers 4x transaction fees)
 * - Hedge-ratio-weighted position sizing for true market neutrality
 * - Cooldown period after trades to prevent whipsaw
 * - Spread volatility regime filter
 * - Properly centered spread residuals
 *
 * Entry: |z-score| > entryZScore AND expected profit > minProfitBps
 * Exit: z-score reverts to exitZScore, OR exceeds stopZScore, OR maxHoldBars
 *
 * Recommended pairs: BTC/ETH, BTC/LTC, SOL/AVAX on 1h or 5m
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

// OLS regression: Y = alpha + beta * X, returns { alpha, beta }
function olsRegression(arrY: number[], arrX: number[], start: number, end: number): { alpha: number; beta: number } {
  const n = end - start + 1;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = start; i <= end; i++) {
    sumX += arrX[i]; sumY += arrY[i];
    sumXY += arrX[i] * arrY[i];
    sumX2 += arrX[i] ** 2;
  }
  const denom = n * sumX2 - sumX ** 2;
  if (denom === 0) return { alpha: 0, beta: 1 };
  const beta = (n * sumXY - sumX * sumY) / denom;
  const alpha = (sumY - beta * sumX) / n;
  return { alpha, beta };
}

// ============================================================================
// Strategy Implementation
// ============================================================================

const strategy: PairsStrategy = {
  name: 'pairs-zscore-scalper',
  description: 'Z-Score mean reversion pairs scalper v2 with profit filter, hedge-ratio sizing, and cooldown',
  version: '2.0.0',
  isPairs: true,

  params: [
    {
      name: 'lookbackPeriod',
      label: 'Lookback Period',
      type: 'number',
      default: 200,
      min: 200,
      max: 800,
      step: 100,
      description: 'OLS regression lookback window (bars)'
    },
    {
      name: 'zScorePeriod',
      label: 'Z-Score Period',
      type: 'number',
      default: 60,
      min: 20,
      max: 80,
      step: 10,
      description: 'Z-score rolling window (bars)'
    },
    {
      name: 'entryZScore',
      label: 'Entry Z-Score',
      type: 'number',
      default: 2.0,
      min: 1.5,
      max: 3.0,
      step: 0.25,
      description: 'Entry threshold (z-score units)'
    },
    {
      name: 'exitZScore',
      label: 'Exit Z-Score',
      type: 'number',
      default: 0.5,
      min: -0.5,
      max: 0.5,
      step: 0.25,
      description: 'Mean reversion exit threshold'
    },
    {
      name: 'stopZScore',
      label: 'Stop Z-Score',
      type: 'number',
      default: 4.5,
      min: 3.0,
      max: 5.0,
      step: 0.5,
      description: 'Stop loss z-score threshold'
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 100,
      min: 50,
      max: 200,
      step: 50,
      description: 'Time-based exit (bars)'
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 80,
      min: 40,
      max: 90,
      step: 10,
      description: '% of capital per trade (both legs combined)'
    },
    {
      name: 'minCorrelation',
      label: 'Min Correlation',
      type: 'number',
      default: 0.8,
      min: 0.5,
      max: 0.8,
      step: 0.1,
      description: 'Minimum rolling correlation to trade'
    },
    {
      name: 'minProfitBps',
      label: 'Min Profit (bps)',
      type: 'number',
      default: 120,
      min: 20,
      max: 120,
      step: 20,
      description: 'Minimum expected profit in basis points to enter (filters unprofitable trades)'
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 10,
      min: 0,
      max: 20,
      step: 5,
      description: 'Bars to wait after closing before re-entering'
    },
  ],

  init(ctx: PairsStrategyContext): void {
    ctx.log(`Pairs Z-Score Scalper v2 initialized`);
    ctx.log(`Trading pair: ${ctx.symbolA} / ${ctx.symbolB}`);
  },

  onBar: (() => {
    // Closure variables to track state across bars
    const logPricesA: number[] = [];
    const logPricesB: number[] = [];
    const residuals: number[] = []; // OLS residuals (proper spread)
    let barsInPosition = 0;
    let barsSinceLastClose = Infinity; // start at Infinity so first trade isn't blocked
    let positionType: 'long-spread' | 'short-spread' | null = null;
    let entryZScoreValue = 0; // track entry z-score for profit estimation on exit

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
      const minProfitBps = params.minProfitBps as number;
      const cooldownBars = params.cooldownBars as number;

      const priceA = candleA.close;
      const priceB = candleB.close;

      // Store log prices
      logPricesA.push(Math.log(priceA));
      logPricesB.push(Math.log(priceB));

      const dataLength = logPricesA.length;

      // Increment cooldown counter
      if (positionType === null) {
        barsSinceLastClose++;
      }

      // Need enough data for lookback
      if (dataLength < lookbackPeriod) {
        return;
      }

      // Compute OLS regression: logA = alpha + beta * logB
      const startLookback = dataLength - lookbackPeriod;
      const endLookback = dataLength - 1;
      const { alpha, beta: hedgeRatio } = olsRegression(logPricesA, logPricesB, startLookback, endLookback);

      // Compute spread as OLS residual (centered around 0)
      const residual = logPricesA[dataLength - 1] - alpha - hedgeRatio * logPricesB[dataLength - 1];
      residuals.push(residual);

      // Need enough residual data for z-score
      if (residuals.length < zScorePeriod) {
        return;
      }

      // Compute z-score of residual using recent window only
      const startZ = residuals.length - zScorePeriod;
      const endZ = residuals.length - 1;
      const spreadMean = rollingMean(residuals, startZ, endZ);
      const spreadStd = rollingStd(residuals, startZ, endZ, spreadMean);

      if (spreadStd < 1e-10) {
        return; // Avoid division by zero / near-zero std
      }

      const zScore = (residual - spreadMean) / spreadStd;

      // Compute rolling correlation for regime filter
      const correlation = rollingCorrelation(logPricesA, logPricesB, startLookback, endLookback);

      // Check if in position
      const inPosition = longPositionA !== null || shortPositionA !== null ||
                         longPositionB !== null || shortPositionB !== null;

      if (inPosition) {
        barsInPosition++;
      }

      // ================================================================
      // EXIT LOGIC
      // ================================================================
      if (inPosition && positionType !== null) {
        let shouldExit = false;
        let exitReason = '';

        // Time stop
        if (barsInPosition >= maxHoldBars) {
          shouldExit = true;
          exitReason = 'time-stop';
        }

        if (positionType === 'short-spread') {
          // Short spread: entered when z > entryZScore, exit when z <= exitZScore
          if (zScore <= exitZScore) {
            shouldExit = true;
            exitReason = 'mean-reversion';
          }
          // Stop loss: z exceeds stopZScore (spread diverges further)
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
          // Stop loss: z below -stopZScore
          if (zScore < -stopZScore) {
            shouldExit = true;
            exitReason = 'stop-loss';
          }
        }

        if (shouldExit) {
          if (longPositionA) ctx.closeLongA();
          if (shortPositionA) ctx.closeShortA();
          if (longPositionB) ctx.closeLongB();
          if (shortPositionB) ctx.closeShortB();

          ctx.log(`EXIT ${positionType} z=${zScore.toFixed(2)} (${exitReason}) bars=${barsInPosition} entry_z=${entryZScoreValue.toFixed(2)}`);
          barsInPosition = 0;
          barsSinceLastClose = 0;
          positionType = null;
        }
      }

      // ================================================================
      // ENTRY LOGIC
      // ================================================================
      if (inPosition || positionType !== null) return;

      // Cooldown check
      if (barsSinceLastClose < cooldownBars) return;

      // Correlation regime filter
      if (correlation < minCorrelation) return;

      // Check z-score exceeds entry threshold
      const absZ = Math.abs(zScore);
      if (absZ <= entryZScore) return;

      // PROFIT FILTER: estimate expected profit in bps
      // Expected z-score move = abs(z) - exitZScore
      // Expected spread move = expectedZMove * spreadStd
      // Convert to price terms: spreadStd is in log-price units, so ~bps when * 10000
      const expectedZMove = absZ - Math.abs(exitZScore);
      const expectedSpreadMoveBps = expectedZMove * spreadStd * 10000;
      if (expectedSpreadMoveBps < minProfitBps) return;

      // Calculate position sizes
      // Total notional for both legs
      const totalNotional = equity * (positionSizePct / 100);
      // Hedge-ratio-weighted split: legA gets 1/(1+|beta|), legB gets |beta|/(1+|beta|)
      const absHedge = Math.abs(hedgeRatio);
      const notionalA = totalNotional / (1 + absHedge);
      const notionalB = totalNotional * absHedge / (1 + absHedge);

      const amountA = notionalA / priceA;
      const amountB = notionalB / priceB;

      if (amountA <= 0 || amountB <= 0) return;

      if (zScore > entryZScore) {
        // Short spread: spread too wide, expect it to narrow
        // Short A, Long B
        ctx.openShortA(amountA);
        ctx.openLongB(amountB);
        positionType = 'short-spread';
        barsInPosition = 0;
        entryZScoreValue = zScore;
        ctx.log(`ENTER short-spread z=${zScore.toFixed(2)} corr=${correlation.toFixed(2)} hedge=${hedgeRatio.toFixed(4)} expProfit=${expectedSpreadMoveBps.toFixed(0)}bps`);
      } else if (zScore < -entryZScore) {
        // Long spread: spread too narrow, expect it to widen
        // Long A, Short B
        ctx.openLongA(amountA);
        ctx.openShortB(amountB);
        positionType = 'long-spread';
        barsInPosition = 0;
        entryZScoreValue = zScore;
        ctx.log(`ENTER long-spread z=${zScore.toFixed(2)} corr=${correlation.toFixed(2)} hedge=${hedgeRatio.toFixed(4)} expProfit=${expectedSpreadMoveBps.toFixed(0)}bps`);
      }
    };
  })(),

  onEnd(ctx: PairsStrategyContext): void {
    if (ctx.longPositionA) ctx.closeLongA();
    if (ctx.shortPositionA) ctx.closeShortA();
    if (ctx.longPositionB) ctx.closeLongB();
    if (ctx.shortPositionB) ctx.closeShortB();
    ctx.log(`Strategy ended. Final equity: $${ctx.equity.toFixed(2)}`);
  },
};

export default strategy;
