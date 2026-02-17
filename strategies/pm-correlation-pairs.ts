/**
 * PM Correlation Pairs - Z-Score Mean Reversion
 *
 * Pairs trading strategy for correlated prediction markets using z-score mean reversion.
 * Trades the spread between two correlated markets (e.g., "Trump wins" vs "Republican wins").
 *
 * Logic:
 * - Calculate log-price spread between market A and market B
 * - Compute rolling z-score of the spread
 * - Entry: when |z-score| > entryZScore (spread deviates from mean)
 *   - If z > entryZScore: short spread (short A, long B)
 *   - If z < -entryZScore: long spread (long A, short B)
 * - Exit: z-score reverts to exitZScore, OR exceeds stopZScore, OR maxHoldBars
 * - Correlation filter: minimum rolling correlation required
 *
 * Recommended for: Correlated prediction markets on same event category
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

// Module-level mutable state (reset in init)
let pricesA: number[] = [];
let pricesB: number[] = [];
let spreads: number[] = [];
let barsInPosition = 0;
let positionType: 'long-spread' | 'short-spread' | null = null;
let lastExitBar = -1000;

const strategy: PairsStrategy = {
  name: 'pm-correlation-pairs',
  description: 'Z-Score mean reversion on correlated prediction markets',
  version: '1.0.0',
  isPairs: true,

  params: [
    {
      name: 'lookbackPeriod',
      label: 'Lookback Period',
      type: 'number',
      default: 70,
      min: 30,
      max: 500,
      step: 10,
      description: 'Spread statistics window (bars)'
    },
    {
      name: 'entryZScore',
      label: 'Entry Z-Score',
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 3.5,
      step: 0.25,
      description: 'Entry threshold (z-score units)'
    },
    {
      name: 'exitZScore',
      label: 'Exit Z-Score',
      type: 'number',
      default: 0.75,
      min: 0.0,
      max: 1.5,
      step: 0.25,
      description: 'Mean reversion exit threshold'
    },
    {
      name: 'stopZScore',
      label: 'Stop Z-Score',
      type: 'number',
      default: 4.0,
      min: 3.0,
      max: 6.0,
      step: 0.5,
      description: 'Stop loss z-score'
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 50,
      min: 10,
      max: 200,
      step: 10,
      description: 'Time-based exit (bars)'
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 60,
      min: 20,
      max: 95,
      step: 10,
      description: '% of capital for both legs combined'
    },
    {
      name: 'maxPositionUSD',
      label: 'Max Position ($)',
      type: 'number',
      default: 1000,
      min: 100,
      max: 10000,
      step: 100,
      description: 'Maximum position size in USD (prevents oversizing on thin markets)',
    },
    {
      name: 'minCorrelation',
      label: 'Min Correlation',
      type: 'number',
      default: 0.9,
      min: 0.3,
      max: 0.9,
      step: 0.1,
      description: 'Minimum rolling correlation to trade'
    },
    {
      name: 'avoidExtremesPct',
      label: 'Avoid Extremes %',
      type: 'number',
      default: 3,
      min: 1,
      max: 25,
      step: 1,
      description: 'Skip entry when either market prob < X% or > (100-X)%',
    },
    {
      name: 'minSpreadStd',
      label: 'Min Spread Std',
      type: 'number',
      default: 0.066,
      min: 0.001,
      max: 0.1,
      step: 0.005,
      description: 'Min spread standard deviation (skip if spread is too stable)',
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 16,
      min: 0,
      max: 20,
      step: 1,
      description: 'Bars to wait after exit before re-entering',
    },
    {
      name: 'minProfitBps',
      label: 'Min Profit (bps)',
      type: 'number',
      default: 460,
      min: 10,
      max: 500,
      step: 10,
      description: 'Min expected profit bps to enter',
    },
  ],

  init(ctx: PairsStrategyContext): void {
    pricesA = [];
    pricesB = [];
    spreads = [];
    barsInPosition = 0;
    positionType = null;
    lastExitBar = -1000;
    ctx.log(`PM Correlation Pairs initialized`);
    ctx.log(`Trading pair: ${ctx.symbolA} / ${ctx.symbolB}`);
  },

  onBar(ctx: PairsStrategyContext): void {
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
      const entryZScore = params.entryZScore as number;
      const exitZScore = params.exitZScore as number;
      const stopZScore = params.stopZScore as number;
      const maxHoldBars = params.maxHoldBars as number;
      const positionSizePct = params.positionSizePct as number;
      const minCorrelation = params.minCorrelation as number;
      const avoidExtremesPct = params.avoidExtremesPct as number;
      const maxPositionUSD = params.maxPositionUSD as number;
      const minSpreadStd = params.minSpreadStd as number;
      const cooldownBars = params.cooldownBars as number;
      const minProfitBps = params.minProfitBps as number;

      const priceA = candleA.close;
      const priceB = candleB.close;

      // Skip forward-filled candles (no real trading)
      if (candleA.volume === 0 || candleB.volume === 0) {
        return;
      }

      // Store prices
      pricesA.push(priceA);
      pricesB.push(priceB);

      const dataLength = pricesA.length;

      // Need enough data for lookback
      if (dataLength < lookbackPeriod) {
        return;
      }

      // Calculate log-price spread
      // Clamp probabilities to avoid log(0) = -Infinity when probability reaches 0
      // Min value 0.001 (0.1%) is safe lower bound for prediction markets
      const logPriceA = Math.log(Math.max(priceA, 0.001));
      const logPriceB = Math.log(Math.max(priceB, 0.001));
      const spread = logPriceA - logPriceB;
      spreads.push(spread);

      // Need enough spread data
      if (spreads.length < lookbackPeriod) {
        return;
      }

      // Compute spread statistics using rolling window
      const startWindow = spreads.length - lookbackPeriod;
      const endWindow = spreads.length - 1;
      const spreadMean = rollingMean(spreads, startWindow, endWindow);
      const spreadStd = rollingStd(spreads, startWindow, endWindow, spreadMean);

      if (spreadStd < 1e-10) {
        return; // Avoid division by zero
      }

      // Check minimum spread volatility
      if (spreadStd < minSpreadStd) {
        return; // Skip if spread is too stable
      }

      // Calculate z-score
      const zScore = (spread - spreadMean) / spreadStd;

      // Compute rolling correlation for regime filter
      const correlation = rollingCorrelation(
        pricesA,
        pricesB,
        dataLength - lookbackPeriod,
        dataLength - 1
      );

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

          ctx.log(`EXIT ${positionType} z=${zScore.toFixed(2)} (${exitReason}) bars=${barsInPosition}`);
          lastExitBar = ctx.currentIndex;
          barsInPosition = 0;
          positionType = null;
        }
      }

      // ================================================================
      // ENTRY LOGIC
      // ================================================================
      if (inPosition || positionType !== null) return;

      // Cooldown check
      if (ctx.currentIndex - lastExitBar < cooldownBars) return;

      // Filter: Avoid extremes (prices near 0 or 1)
      const lowerBound = avoidExtremesPct / 100;
      const upperBound = 1 - lowerBound;
      if (priceA < lowerBound || priceA > upperBound || priceB < lowerBound || priceB > upperBound) return;

      // Correlation regime filter
      if (correlation < minCorrelation) return;

      // Check z-score exceeds entry threshold
      const absZ = Math.abs(zScore);
      if (absZ <= entryZScore) return;

      // Profit filter: expected mean-reversion profit must exceed minimum
      const expectedProfitBps = absZ * spreadStd * 10000;
      if (expectedProfitBps <= minProfitBps) return;

      // Calculate position sizes (equal split for simplicity)
      const totalNotional = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
      const notionalPerLeg = totalNotional / 2;

      const amountA = notionalPerLeg / priceA;
      const amountB = notionalPerLeg / priceB;

      if (amountA <= 0 || amountB <= 0) return;

      if (zScore > entryZScore) {
        // Short spread: spread too wide, expect it to narrow
        // Short A, Long B
        ctx.openShortA(amountA);
        ctx.openLongB(amountB);
        positionType = 'short-spread';
        barsInPosition = 0;
        ctx.log(`ENTER short-spread z=${zScore.toFixed(2)} corr=${correlation.toFixed(2)} spread=${spread.toFixed(4)}`);
      } else if (zScore < -entryZScore) {
        // Long spread: spread too narrow, expect it to widen
        // Long A, Short B
        ctx.openLongA(amountA);
        ctx.openShortB(amountB);
        positionType = 'long-spread';
        barsInPosition = 0;
        ctx.log(`ENTER long-spread z=${zScore.toFixed(2)} corr=${correlation.toFixed(2)} spread=${spread.toFixed(4)}`);
      }
  },

  onEnd(ctx: PairsStrategyContext): void {
    if (ctx.longPositionA) ctx.closeLongA();
    if (ctx.shortPositionA) ctx.closeShortA();
    if (ctx.longPositionB) ctx.closeLongB();
    if (ctx.shortPositionB) ctx.closeShortB();
    ctx.log(`Strategy ended. Final equity: $${ctx.equity.toFixed(2)}`);
  },
};

export default strategy;
