/**
 * Prediction Market Spread Arbitrage Strategy
 *
 * Exploits price differences between related prediction markets.
 *
 * Primary mode: Two related markets on the SAME platform (e.g., two Polymarket markets).
 * Example: "Trump wins presidency" vs "Republican wins presidency" - these should be
 * strongly correlated, and spread deviations tend to revert.
 *
 * Theoretical mode: Cross-platform (Polymarket vs Manifold). NOTE: Manifold uses play
 * money (Mana), so cross-platform profits are not realizable in practice. Use only for
 * research/analysis.
 *
 * Strategy:
 * - Track probability spread between market A and market B
 * - Entry: When |spreadA - spreadB| > entryThreshold (and not in extreme zones)
 *   - If probA > probB + threshold: short A, long B (sell expensive, buy cheap)
 *   - If probB > probA + threshold: long A, short B (buy cheap, sell expensive)
 * - Exit: When spread narrows to exitThreshold (mean reversion)
 * - Stop Loss: When spread widens beyond stopThreshold (divergence risk)
 * - Time Stop: Exit after maxHoldBars to prevent capital lockup
 *
 * Usage:
 * - Same-platform: PM:market-1 / PM:market-2 (both Polymarket)
 * - Cross-platform: PM:market-slug / MF:market-slug (theoretical)
 * - Timeframe: 1h or 15m recommended
 */

import type { PairsStrategy, PairsStrategyContext } from '../src/strategy/pairs-base.js';

// Module-level mutable state (reset in init)
let barsInPosition = 0;
let positionType: 'long-a-short-b' | 'short-a-long-b' | null = null;
let lastExitBar = -1000;
let barCount = 0;

const strategy: PairsStrategy = {
  name: 'pm-cross-platform-arb',
  description: 'Cross-platform arbitrage between Polymarket and Manifold Markets',
  version: '1.0.0',
  isPairs: true,

  params: [
    {
      name: 'entryThreshold',
      label: 'Entry Spread',
      type: 'number',
      default: 0.08,
      min: 0.02,
      max: 0.15,
      step: 0.01,
      description: 'Min spread to enter (0.05 = 5% prob difference)',
    },
    {
      name: 'exitThreshold',
      label: 'Exit Spread',
      type: 'number',
      default: 0.03,
      min: 0.0,
      max: 0.05,
      step: 0.005,
      description: 'Exit when spread narrows to this',
    },
    {
      name: 'stopThreshold',
      label: 'Stop Spread',
      type: 'number',
      default: 0.15,
      min: 0.08,
      max: 0.30,
      step: 0.01,
      description: 'Stop loss if spread widens',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 100,
      min: 20,
      max: 500,
      step: 20,
      description: 'Time-based exit',
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 80,
      min: 20,
      max: 95,
      step: 10,
      description: '% of capital per trade',
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
      name: 'avoidExtremesPct',
      label: 'Avoid Extremes %',
      type: 'number',
      default: 5,
      min: 1,
      max: 25,
      step: 1,
      description: 'Skip entry when either market prob < X% or > (100-X)%',
    },
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 48,
      min: 0,
      max: 50,
      step: 5,
      description: 'Bars to wait after exit before re-entering',
    },
    {
      name: 'minProfitPct',
      label: 'Min Profit %',
      type: 'number',
      default: 8,
      min: 1,
      max: 15,
      step: 1,
      description: 'Min expected profit % (spread - costs) to enter',
    },
    {
      name: 'minSpreadHistory',
      label: 'Min Spread History',
      type: 'number',
      default: 30,
      min: 5,
      max: 100,
      step: 5,
      description: 'Min bars of spread data before trading',
    },
  ],

  init(ctx: PairsStrategyContext): void {
    barsInPosition = 0;
    positionType = null;
    lastExitBar = -1000;
    barCount = 0;
    ctx.log(`Cross-Platform Arbitrage initialized`);
    ctx.log(`Platform A: ${ctx.symbolA}`);
    ctx.log(`Platform B: ${ctx.symbolB}`);
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
      const entryThreshold = params.entryThreshold as number;
      const exitThreshold = params.exitThreshold as number;
      const stopThreshold = params.stopThreshold as number;
      const maxHoldBars = params.maxHoldBars as number;
      const positionSizePct = params.positionSizePct as number;
      const avoidExtremesPct = params.avoidExtremesPct as number;
      const maxPositionUSD = params.maxPositionUSD as number;
      const cooldownBars = params.cooldownBars as number;
      const minProfitPct = params.minProfitPct as number;
      const minSpreadHistory = params.minSpreadHistory as number;

      // Increment bar count
      barCount++;

      // Skip forward-filled candles (no real trading)
      if (candleA.volume === 0 || candleB.volume === 0) {
        return;
      }

      // Get current probabilities (close prices)
      const probA = candleA.close;
      const probB = candleB.close;

      // Calculate spread (price difference)
      const spread = probA - probB;
      const absSpread = Math.abs(spread);

      // Check if in position
      const inPosition =
        longPositionA !== null ||
        shortPositionA !== null ||
        longPositionB !== null ||
        shortPositionB !== null;

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

        // Mean reversion: spread narrowed to exit threshold
        if (absSpread <= exitThreshold) {
          shouldExit = true;
          exitReason = 'mean-reversion';
        }

        // Stop loss: spread diverged beyond stop threshold
        if (absSpread > stopThreshold) {
          shouldExit = true;
          exitReason = 'stop-loss';
        }

        if (shouldExit) {
          // Close all positions
          if (longPositionA) ctx.closeLongA();
          if (shortPositionA) ctx.closeShortA();
          if (longPositionB) ctx.closeLongB();
          if (shortPositionB) ctx.closeShortB();

          ctx.log(
            `EXIT ${positionType} spread=${spread.toFixed(4)} (${exitReason}) bars=${barsInPosition}`
          );
          lastExitBar = ctx.currentIndex;
          barsInPosition = 0;
          positionType = null;
        }
      }

      // ================================================================
      // ENTRY LOGIC
      // ================================================================
      if (inPosition || positionType !== null) return;

      // Ensure enough spread history before trading
      if (barCount < minSpreadHistory) return;

      // Cooldown check
      if (ctx.currentIndex - lastExitBar < cooldownBars) return;

      // Filter: Avoid extremes (prices near 0 or 1)
      const lowerBound = avoidExtremesPct / 100;
      const upperBound = 1 - lowerBound;
      if (probA < lowerBound || probA > upperBound || probB < lowerBound || probB > upperBound) return;

      // Check if spread exceeds entry threshold
      if (absSpread <= entryThreshold) return;

      // Profit filter: expected convergence profit must exceed minimum
      const expectedConvergenceProfit = (absSpread - exitThreshold) * 100;
      if (expectedConvergenceProfit <= minProfitPct) return;

      // Calculate position sizes (equal notional on both legs)
      const totalNotional = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
      const notionalPerLeg = totalNotional / 2;

      const amountA = notionalPerLeg / probA;
      const amountB = notionalPerLeg / probB;

      if (amountA <= 0 || amountB <= 0) return;

      // Determine direction based on which platform is more expensive
      if (spread > entryThreshold) {
        // A is more expensive than B
        // Strategy: Short A (sell expensive), Long B (buy cheap)
        ctx.openShortA(amountA);
        ctx.openLongB(amountB);
        positionType = 'short-a-long-b';
        barsInPosition = 0;
        ctx.log(
          `ENTER short-a-long-b spread=${spread.toFixed(4)} probA=${probA.toFixed(4)} probB=${probB.toFixed(4)}`
        );
      } else if (spread < -entryThreshold) {
        // B is more expensive than A
        // Strategy: Long A (buy cheap), Short B (sell expensive)
        ctx.openLongA(amountA);
        ctx.openShortB(amountB);
        positionType = 'long-a-short-b';
        barsInPosition = 0;
        ctx.log(
          `ENTER long-a-short-b spread=${spread.toFixed(4)} probA=${probA.toFixed(4)} probB=${probB.toFixed(4)}`
        );
      }
  },

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
