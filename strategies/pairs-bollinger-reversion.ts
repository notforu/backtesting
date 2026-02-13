/**
 * Pairs Bollinger Band Reversion Strategy
 *
 * Pairs mean-reversion using Bollinger Bands on the OLS spread with RSI momentum 
 * confirmation and Keltner Channel squeeze detection. Focuses on higher-quality 
 * entries by requiring multiple confirmations.
 *
 * Key innovations:
 * - Bollinger Bands on spread instead of raw z-score (includes SMA and bandwidth info)
 * - RSI of spread for overbought/oversold confirmation at entries
 * - Keltner squeeze detection - BB inside KC signals low vol, expect expansion
 * - Reversal candle confirmation - spread must show reversal bar at extreme before entry
 * - ATR-based stop loss instead of fixed z-score stop
 *
 * Entry: %B extreme + RSI extreme + optional reversal + optional squeeze + profit filter
 * Exit: Spread reverts to SMA, OR ATR stop, OR time stop
 *
 * Recommended: BTC/LTC on 1h timeframe
 */

import type { PairsStrategy, PairsStrategyContext } from '../src/strategy/pairs-base.js';

// ============================================================================
// Inline Helper Functions (no external dependencies)
// ============================================================================

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

function computeBollingerBands(spread: number[], period: number, multiplier: number): {
  sma: number;
  upperBand: number;
  lowerBand: number;
  percentB: number;
  bbWidth: number;
} | null {
  if (spread.length < period) return null;
  
  // Compute SMA
  let sum = 0;
  for (let i = spread.length - period; i < spread.length; i++) {
    sum += spread[i];
  }
  const sma = sum / period;
  
  // Compute standard deviation
  let sumSq = 0;
  for (let i = spread.length - period; i < spread.length; i++) {
    sumSq += (spread[i] - sma) ** 2;
  }
  const std = Math.sqrt(sumSq / period);
  
  const upperBand = sma + multiplier * std;
  const lowerBand = sma - multiplier * std;
  
  const currentSpread = spread[spread.length - 1];
  const bandRange = upperBand - lowerBand;
  const percentB = bandRange > 0 ? (currentSpread - lowerBand) / bandRange : 0.5;
  const bbWidth = sma !== 0 ? bandRange / Math.abs(sma) : 0;
  
  return { sma, upperBand, lowerBand, percentB, bbWidth };
}

function detectReversal(spread: number[]): { bottomReversal: boolean; topReversal: boolean } {
  if (spread.length < 3) return { bottomReversal: false, topReversal: false };
  
  const len = spread.length;
  const s0 = spread[len - 3]; // t-2
  const s1 = spread[len - 2]; // t-1
  const s2 = spread[len - 1]; // t
  
  const bottomReversal = s1 < s0 && s2 > s1;
  const topReversal = s1 > s0 && s2 < s1;
  
  return { bottomReversal, topReversal };
}

// ============================================================================
// Strategy Implementation
// ============================================================================

const strategy: PairsStrategy = {
  name: 'pairs-bollinger-reversion',
  description: 'Bollinger Band pairs mean reversion with RSI confirmation and Keltner squeeze detection',
  version: '1.0.0',
  isPairs: true,

  params: [
    { name: 'lookbackPeriod', label: 'OLS Lookback', type: 'number', default: 200, min: 100, max: 400, step: 100, description: 'OLS regression window' },
    { name: 'bbPeriod', label: 'BB Period', type: 'number', default: 30, min: 20, max: 60, step: 10, description: 'Bollinger Band SMA period' },
    { name: 'bbMultiplier', label: 'BB Multiplier', type: 'number', default: 2.0, min: 1.5, max: 3.0, step: 0.25, description: 'BB standard deviation multiplier' },
    { name: 'rsiPeriod', label: 'RSI Period', type: 'number', default: 14, min: 10, max: 20, step: 2, description: 'RSI calculation period on spread' },
    { name: 'rsiOverbought', label: 'RSI Overbought', type: 'number', default: 70, min: 65, max: 80, step: 5, description: 'RSI overbought threshold (short spread)' },
    { name: 'rsiOversold', label: 'RSI Oversold', type: 'number', default: 30, min: 20, max: 35, step: 5, description: 'RSI oversold threshold (long spread)' },
    { name: 'kcPeriod', label: 'KC Period', type: 'number', default: 20, min: 15, max: 30, step: 5, description: 'Keltner Channel EMA period' },
    { name: 'kcMultiplier', label: 'KC Multiplier', type: 'number', default: 1.5, min: 1.0, max: 2.0, step: 0.25, description: 'Keltner Channel ATR multiplier' },
    { name: 'requireSqueeze', label: 'Require Squeeze', type: 'number', default: 0, min: 0, max: 1, step: 1, description: 'Only enter during KC squeeze (0=off, 1=on)' },
    { name: 'requireReversal', label: 'Require Reversal', type: 'number', default: 1, min: 0, max: 1, step: 1, description: 'Require spread reversal bar (0=off, 1=on)' },
    { name: 'stopAtrMultiplier', label: 'Stop ATR Mult', type: 'number', default: 3.0, min: 2.0, max: 5.0, step: 0.5, description: 'ATR-based stop distance' },
    { name: 'maxHoldBars', label: 'Max Hold Bars', type: 'number', default: 80, min: 40, max: 150, step: 20, description: 'Maximum hold duration' },
    { name: 'positionSizePct', label: 'Position Size %', type: 'number', default: 80, min: 50, max: 90, step: 10, description: '% of capital per trade' },
    { name: 'minCorrelation', label: 'Min Correlation', type: 'number', default: 0.7, min: 0.5, max: 0.8, step: 0.1, description: 'Min rolling correlation' },
    { name: 'minProfitBps', label: 'Min Profit (bps)', type: 'number', default: 60, min: 20, max: 120, step: 20, description: 'Min expected profit to enter' },
    { name: 'cooldownBars', label: 'Cooldown Bars', type: 'number', default: 5, min: 0, max: 15, step: 5, description: 'Post-trade cooldown' },
  ],

  init(ctx: PairsStrategyContext): void {
    ctx.log(`Pairs Bollinger Reversion initialized`);
    ctx.log(`Trading pair: ${ctx.symbolA} / ${ctx.symbolB}`);
  },

  onBar: (() => {
    // Closure variables to track state across bars
    const logPricesA: number[] = [];
    const logPricesB: number[] = [];
    const residuals: number[] = [];
    let barsInPosition = 0;
    let barsSinceLastClose = Infinity;
    let positionType: 'long-spread' | 'short-spread' | null = null;
    let entrySma = 0;

    // RSI state
    let rsiAvgGain = 0;
    let rsiAvgLoss = 0;
    let rsiInitialized = false;
    let prevSpread = 0;

    // Keltner Channel state
    let kcEmaSpread = 0;
    let kcEmaAtr = 0;
    let kcInitialized = false;
    let prevSpreadForATR = 0;

    // RSI update function (uses Wilder smoothing)
    function updateRSI(currentSpread: number, rsiPeriod: number): number {
      const delta = currentSpread - prevSpread;
      const gain = Math.max(delta, 0);
      const loss = Math.max(-delta, 0);
      
      const alpha = 1 / rsiPeriod;
      
      if (!rsiInitialized) {
        rsiAvgGain = gain;
        rsiAvgLoss = loss;
        rsiInitialized = true;
      } else {
        rsiAvgGain = alpha * gain + (1 - alpha) * rsiAvgGain;
        rsiAvgLoss = alpha * loss + (1 - alpha) * rsiAvgLoss;
      }
      
      prevSpread = currentSpread;
      
      if (rsiAvgLoss < 1e-10) return 100;
      const rs = rsiAvgGain / rsiAvgLoss;
      return 100 - 100 / (1 + rs);
    }

    // Keltner Channel update function
    function updateKeltnerChannel(currentSpread: number, kcPeriod: number, kcMultiplier: number): {
      kcUpper: number;
      kcLower: number;
      atr: number;
    } | null {
      const alpha = 2 / (kcPeriod + 1);
      
      if (!kcInitialized) {
        kcEmaSpread = currentSpread;
        kcEmaAtr = 0;
        prevSpreadForATR = currentSpread;
        kcInitialized = true;
        return null;
      }
      
      kcEmaSpread = alpha * currentSpread + (1 - alpha) * kcEmaSpread;
      
      const atr = Math.abs(currentSpread - prevSpreadForATR);
      kcEmaAtr = alpha * atr + (1 - alpha) * kcEmaAtr;
      prevSpreadForATR = currentSpread;
      
      const kcUpper = kcEmaSpread + kcMultiplier * kcEmaAtr;
      const kcLower = kcEmaSpread - kcMultiplier * kcEmaAtr;
      
      return { kcUpper, kcLower, atr: kcEmaAtr };
    }

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
      const bbPeriod = params.bbPeriod as number;
      const bbMultiplier = params.bbMultiplier as number;
      const rsiPeriod = params.rsiPeriod as number;
      const rsiOverbought = params.rsiOverbought as number;
      const rsiOversold = params.rsiOversold as number;
      const kcPeriod = params.kcPeriod as number;
      const kcMultiplier = params.kcMultiplier as number;
      const requireSqueeze = params.requireSqueeze as number;
      const requireReversal = params.requireReversal as number;
      const stopAtrMultiplier = params.stopAtrMultiplier as number;
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

      // Compute OLS regression
      const startLookback = dataLength - lookbackPeriod;
      const endLookback = dataLength - 1;
      const { alpha, beta: hedgeRatio } = olsRegression(logPricesA, logPricesB, startLookback, endLookback);

      // Compute spread as OLS residual
      const residual = logPricesA[dataLength - 1] - alpha - hedgeRatio * logPricesB[dataLength - 1];
      residuals.push(residual);

      // Need enough residual data for BB
      if (residuals.length < bbPeriod) {
        return;
      }

      // Compute Bollinger Bands
      const bb = computeBollingerBands(residuals, bbPeriod, bbMultiplier);
      if (!bb) return;

      // Compute RSI
      const rsi = updateRSI(residual, rsiPeriod);

      // Compute Keltner Channel
      const kc = updateKeltnerChannel(residual, kcPeriod, kcMultiplier);

      // Detect squeeze
      let squeeze = false;
      if (kc) {
        squeeze = (bb.upperBand < kc.kcUpper) && (bb.lowerBand > kc.kcLower);
      }

      // Detect reversal
      const reversal = detectReversal(residuals);

      // Compute rolling correlation
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

        // ATR stop
        if (kc && kc.atr > 0) {
          const stopDistance = stopAtrMultiplier * kc.atr;
          if (positionType === 'short-spread' && residual > entrySma + stopDistance) {
            shouldExit = true;
            exitReason = 'atr-stop';
          } else if (positionType === 'long-spread' && residual < entrySma - stopDistance) {
            shouldExit = true;
            exitReason = 'atr-stop';
          }
        }

        // Mean reversion to SMA
        if (positionType === 'short-spread' && residual <= bb.sma) {
          shouldExit = true;
          exitReason = 'mean-reversion';
        } else if (positionType === 'long-spread' && residual >= bb.sma) {
          shouldExit = true;
          exitReason = 'mean-reversion';
        }

        if (shouldExit) {
          if (longPositionA) ctx.closeLongA();
          if (shortPositionA) ctx.closeShortA();
          if (longPositionB) ctx.closeLongB();
          if (shortPositionB) ctx.closeShortB();

          ctx.log(`EXIT ${positionType} (${exitReason}) bars=${barsInPosition} rsi=${rsi.toFixed(1)} %B=${bb.percentB.toFixed(2)}`);
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

      // Calculate position sizes
      const totalNotional = equity * (positionSizePct / 100);
      const absHedge = Math.abs(hedgeRatio);
      const notionalA = totalNotional / (1 + absHedge);
      const notionalB = totalNotional * absHedge / (1 + absHedge);
      const amountA = notionalA / priceA;
      const amountB = notionalB / priceB;

      if (amountA <= 0 || amountB <= 0) return;

      // LONG SPREAD ENTRY (spread below lower BB, expect reversion up)
      if (bb.percentB < 0 && rsi < rsiOversold) {
        // Check optional filters
        if (requireReversal === 1 && !reversal.bottomReversal) return;
        if (requireSqueeze === 1 && !squeeze) return;
        
        // Profit check
        const spreadToSma = bb.sma - residual;
        const expectedProfitBps = spreadToSma * 10000;
        if (expectedProfitBps < minProfitBps) return;
        
        // Open long spread: Long A, Short B
        ctx.openLongA(amountA);
        ctx.openShortB(amountB);
        positionType = 'long-spread';
        barsInPosition = 0;
        entrySma = bb.sma;
        ctx.log(`ENTER long-spread rsi=${rsi.toFixed(1)} %B=${bb.percentB.toFixed(2)} squeeze=${squeeze} reversal=${reversal.bottomReversal} expProfit=${expectedProfitBps.toFixed(0)}bps`);
      }

      // SHORT SPREAD ENTRY (spread above upper BB, expect reversion down)
      if (bb.percentB > 1 && rsi > rsiOverbought) {
        // Check optional filters
        if (requireReversal === 1 && !reversal.topReversal) return;
        if (requireSqueeze === 1 && !squeeze) return;
        
        // Profit check
        const spreadToSma = residual - bb.sma;
        const expectedProfitBps = spreadToSma * 10000;
        if (expectedProfitBps < minProfitBps) return;
        
        // Open short spread: Short A, Long B
        ctx.openShortA(amountA);
        ctx.openLongB(amountB);
        positionType = 'short-spread';
        barsInPosition = 0;
        entrySma = bb.sma;
        ctx.log(`ENTER short-spread rsi=${rsi.toFixed(1)} %B=${bb.percentB.toFixed(2)} squeeze=${squeeze} reversal=${reversal.topReversal} expProfit=${expectedProfitBps.toFixed(0)}bps`);
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
