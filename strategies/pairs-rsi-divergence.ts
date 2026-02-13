/**
 * Pairs RSI Divergence Strategy v1
 *
 * Multi-indicator pairs mean-reversion combining RSI divergence on spread
 * with MACD histogram timing and z-score confirmation.
 *
 * Key Innovations:
 * - RSI as primary signal (better at identifying overbought/oversold)
 * - MACD histogram direction change for timing
 * - Z-score as confirmation filter (secondary, not primary)
 * - MACD-based exit (momentum shift detection)
 * - Triple confirmation = fewer trades but higher win rate
 *
 * Entry: RSI extreme + z-score extreme + MACD histogram turning
 * Exit: MACD reversal OR RSI neutral OR stop OR time
 *
 * Recommended pairs: BTC/LTC, BTC/ETH on 1h
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

function isHistogramTurningUp(history: number[]): boolean {
  if (history.length < 3) return false;
  const curr = history[history.length - 1];
  const prev = history[history.length - 2];
  const prevPrev = history[history.length - 3];
  return curr > prev && prev <= prevPrev;
}

function isHistogramTurningDown(history: number[]): boolean {
  if (history.length < 3) return false;
  const curr = history[history.length - 1];
  const prev = history[history.length - 2];
  const prevPrev = history[history.length - 3];
  return curr < prev && prev >= prevPrev;
}

// ============================================================================
// Strategy Implementation
// ============================================================================

const strategy: PairsStrategy = {
  name: 'pairs-rsi-divergence',
  description: 'Multi-indicator pairs mean-reversion with RSI, MACD histogram, and z-score confirmation',
  version: '1.0.0',
  isPairs: true,

  params: [
    {
      name: 'lookbackPeriod',
      label: 'OLS Lookback',
      type: 'number',
      default: 400,
      min: 100,
      max: 400,
      step: 100,
      description: 'OLS regression window'
    },
    {
      name: 'zScorePeriod',
      label: 'Z-Score Period',
      type: 'number',
      default: 40,
      min: 30,
      max: 80,
      step: 10,
      description: 'Z-score normalization period'
    },
    {
      name: 'rsiPeriod',
      label: 'RSI Period',
      type: 'number',
      default: 20,
      min: 10,
      max: 20,
      step: 2,
      description: 'RSI period on spread'
    },
    {
      name: 'rsiOverbought',
      label: 'RSI Overbought',
      type: 'number',
      default: 65,
      min: 65,
      max: 80,
      step: 5,
      description: 'Short spread entry threshold'
    },
    {
      name: 'rsiOversold',
      label: 'RSI Oversold',
      type: 'number',
      default: 35,
      min: 20,
      max: 35,
      step: 5,
      description: 'Long spread entry threshold'
    },
    {
      name: 'macdFast',
      label: 'MACD Fast',
      type: 'number',
      default: 16,
      min: 8,
      max: 16,
      step: 2,
      description: 'MACD fast EMA period'
    },
    {
      name: 'macdSlow',
      label: 'MACD Slow',
      type: 'number',
      default: 26,
      min: 20,
      max: 30,
      step: 2,
      description: 'MACD slow EMA period'
    },
    {
      name: 'macdSignal',
      label: 'MACD Signal',
      type: 'number',
      default: 9,
      min: 7,
      max: 12,
      step: 1,
      description: 'MACD signal line period'
    },
    {
      name: 'minZScore',
      label: 'Min Z-Score',
      type: 'number',
      default: 2.5,
      min: 1.0,
      max: 2.5,
      step: 0.25,
      description: 'Min z-score for confirmation'
    },
    {
      name: 'stopZScore',
      label: 'Stop Z-Score',
      type: 'number',
      default: 3.0,
      min: 3.0,
      max: 5.0,
      step: 0.5,
      description: 'Z-score stop loss'
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 125,
      min: 50,
      max: 200,
      step: 25,
      description: 'Maximum hold duration'
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 90,
      min: 50,
      max: 90,
      step: 10,
      description: 'Capital per trade'
    },
    {
      name: 'minCorrelation',
      label: 'Min Correlation',
      type: 'number',
      default: 0.6,
      min: 0.5,
      max: 0.8,
      step: 0.1,
      description: 'Min rolling correlation'
    },
    {
      name: 'minProfitBps',
      label: 'Min Profit (bps)',
      type: 'number',
      default: 60,
      min: 20,
      max: 120,
      step: 20,
      description: 'Min expected profit'
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 16,
      min: 0,
      max: 20,
      step: 4,
      description: 'Post-trade cooldown'
    },
  ],

  init(ctx: PairsStrategyContext): void {
    ctx.log(`Pairs RSI Divergence v1 initialized`);
    ctx.log(`Trading pair: ${ctx.symbolA} / ${ctx.symbolB}`);
  },

  onBar: (() => {
    // Closure variables to track state across bars
    const logPricesA: number[] = [];
    const logPricesB: number[] = [];
    const residuals: number[] = [];
    const spreadHistory: number[] = [];
    const macdHistogramHistory: number[] = [];
    
    let rsiAvgGain = 0;
    let rsiAvgLoss = 0;
    let rsiInitialized = false;
    
    let macdFastEMA = 0;
    let macdSlowEMA = 0;
    let macdSignalEMA = 0;
    let macdInitialized = false;
    
    let barsInPosition = 0;
    let barsSinceLastClose = Infinity;
    let positionType: 'long-spread' | 'short-spread' | null = null;

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
      const rsiPeriod = params.rsiPeriod as number;
      const rsiOverbought = params.rsiOverbought as number;
      const rsiOversold = params.rsiOversold as number;
      const macdFast = params.macdFast as number;
      const macdSlow = params.macdSlow as number;
      const macdSignal = params.macdSignal as number;
      const minZScore = params.minZScore as number;
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

      // Compute z-score of residual
      const startZ = residuals.length - zScorePeriod;
      const endZ = residuals.length - 1;
      const spreadMean = rollingMean(residuals, startZ, endZ);
      const spreadStd = rollingStd(residuals, startZ, endZ, spreadMean);

      if (spreadStd < 1e-10) {
        return; // Avoid division by zero
      }

      const zScore = (residual - spreadMean) / spreadStd;
      const spread = residual; // Use residual as spread for RSI/MACD

      // ================================================================
      // RSI Calculation (Wilder smoothing on spread)
      // ================================================================
      const prevSpread = spreadHistory.length > 0 ? spreadHistory[spreadHistory.length - 1] : spread;
      spreadHistory.push(spread);

      let rsi = 50; // Default neutral

      if (spreadHistory.length >= rsiPeriod + 1) {
        const delta = spread - prevSpread;
        const gain = Math.max(delta, 0);
        const loss = Math.max(-delta, 0);

        if (!rsiInitialized) {
          // First RSI: simple average of first rsiPeriod gains/losses
          let sumGain = 0, sumLoss = 0;
          const startIdx = spreadHistory.length - rsiPeriod - 1;
          for (let i = 1; i <= rsiPeriod; i++) {
            const d = spreadHistory[startIdx + i] - spreadHistory[startIdx + i - 1];
            sumGain += Math.max(d, 0);
            sumLoss += Math.max(-d, 0);
          }
          rsiAvgGain = sumGain / rsiPeriod;
          rsiAvgLoss = sumLoss / rsiPeriod;
          rsiInitialized = true;
        } else {
          // Wilder smoothing
          rsiAvgGain = (rsiAvgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
          rsiAvgLoss = (rsiAvgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
        }

        if (rsiAvgLoss === 0) {
          rsi = 100;
        } else {
          const rs = rsiAvgGain / rsiAvgLoss;
          rsi = 100 - 100 / (1 + rs);
        }
      }

      // ================================================================
      // MACD Calculation (EMA on spread)
      // ================================================================
      let macdHistogram = 0;

      if (spreadHistory.length >= Math.max(macdFast, macdSlow)) {
        const alphaFast = 2 / (macdFast + 1);
        const alphaSlow = 2 / (macdSlow + 1);
        const alphaSignal = 2 / (macdSignal + 1);

        if (!macdInitialized) {
          macdFastEMA = spread;
          macdSlowEMA = spread;
          macdSignalEMA = 0;
          macdInitialized = true;
        } else {
          macdFastEMA = alphaFast * spread + (1 - alphaFast) * macdFastEMA;
          macdSlowEMA = alphaSlow * spread + (1 - alphaSlow) * macdSlowEMA;
        }

        const macdLine = macdFastEMA - macdSlowEMA;

        if (macdHistogramHistory.length === 0) {
          macdSignalEMA = macdLine;
        } else {
          macdSignalEMA = alphaSignal * macdLine + (1 - alphaSignal) * macdSignalEMA;
        }

        macdHistogram = macdLine - macdSignalEMA;
        macdHistogramHistory.push(macdHistogram);
      }

      // Compute rolling correlation for regime filter
      const correlation = rollingCorrelation(logPricesA, logPricesB, startLookback, endLookback);

      // Check if in position
      const inPosition = longPositionA !== null || shortPositionA !== null ||
                         longPositionB !== null || shortPositionB !== null;

      if (inPosition) {
        barsInPosition++;
      }

      // ================================================================
      // EXIT LOGIC (First signal wins)
      // ================================================================
      if (inPosition && positionType !== null) {
        let shouldExit = false;
        let exitReason = '';

        // 1. Time stop
        if (barsInPosition >= maxHoldBars) {
          shouldExit = true;
          exitReason = 'time-stop';
        }

        // 2. Stop loss
        if (!shouldExit && positionType === 'long-spread' && zScore < -stopZScore) {
          shouldExit = true;
          exitReason = 'stop-loss';
        }
        if (!shouldExit && positionType === 'short-spread' && zScore > stopZScore) {
          shouldExit = true;
          exitReason = 'stop-loss';
        }

        // 3. RSI neutral exit
        if (!shouldExit && positionType === 'long-spread' && rsi > 50) {
          shouldExit = true;
          exitReason = 'rsi-neutral';
        }
        if (!shouldExit && positionType === 'short-spread' && rsi < 50) {
          shouldExit = true;
          exitReason = 'rsi-neutral';
        }

        // 4. MACD momentum reversal
        if (!shouldExit && positionType === 'long-spread' && 
            macdHistogram > 0 && 
            isHistogramTurningDown(macdHistogramHistory)) {
          shouldExit = true;
          exitReason = 'macd-reversal';
        }
        if (!shouldExit && positionType === 'short-spread' && 
            macdHistogram < 0 && 
            isHistogramTurningUp(macdHistogramHistory)) {
          shouldExit = true;
          exitReason = 'macd-reversal';
        }

        if (shouldExit) {
          if (longPositionA) ctx.closeLongA();
          if (shortPositionA) ctx.closeShortA();
          if (longPositionB) ctx.closeLongB();
          if (shortPositionB) ctx.closeShortB();

          ctx.log(`EXIT ${positionType} ${exitReason} rsi=${rsi.toFixed(1)} z=${zScore.toFixed(2)} bars=${barsInPosition}`);
          barsInPosition = 0;
          barsSinceLastClose = 0;
          positionType = null;
        }
      }

      // ================================================================
      // ENTRY LOGIC (Triple Confirmation)
      // ================================================================
      if (inPosition || positionType !== null) return;

      // Cooldown check
      if (barsSinceLastClose < cooldownBars) return;

      // Correlation regime filter
      if (correlation < minCorrelation) return;

      // Need initialized indicators
      if (!rsiInitialized || !macdInitialized || macdHistogramHistory.length < 3) return;

      // Profit filter
      const expectedZMove = Math.abs(zScore) - 0.5;
      const expectedSpreadMoveBps = expectedZMove * spreadStd * 10000;
      if (expectedSpreadMoveBps < minProfitBps) return;

      // Calculate position sizes
      const totalNotional = equity * (positionSizePct / 100);
      const absHedge = Math.abs(hedgeRatio);
      const notionalA = totalNotional / (1 + absHedge);
      const notionalB = totalNotional * absHedge / (1 + absHedge);
      const amountA = notionalA / priceA;
      const amountB = notionalB / priceB;

      if (amountA <= 0 || amountB <= 0) return;

      // Triple confirmation for LONG SPREAD
      if (rsi < rsiOversold && 
          zScore < -minZScore && 
          isHistogramTurningUp(macdHistogramHistory)) {
        ctx.openLongA(amountA);
        ctx.openShortB(amountB);
        positionType = 'long-spread';
        barsInPosition = 0;
        ctx.log(`ENTER long-spread rsi=${rsi.toFixed(1)} z=${zScore.toFixed(2)} macd_hist=${macdHistogram.toFixed(4)} corr=${correlation.toFixed(2)}`);
      }

      // Triple confirmation for SHORT SPREAD
      if (rsi > rsiOverbought && 
          zScore > minZScore && 
          isHistogramTurningDown(macdHistogramHistory)) {
        ctx.openShortA(amountA);
        ctx.openLongB(amountB);
        positionType = 'short-spread';
        barsInPosition = 0;
        ctx.log(`ENTER short-spread rsi=${rsi.toFixed(1)} z=${zScore.toFixed(2)} macd_hist=${macdHistogram.toFixed(4)} corr=${correlation.toFixed(2)}`);
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
