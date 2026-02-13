/**
 * Cross-Platform Arbitrage Strategy
 *
 * Exploits price differences between Polymarket and Manifold Markets on the same event.
 * Buys on the cheaper platform and sells on the more expensive one when the spread exceeds
 * the entry threshold.
 *
 * Strategy:
 * - Track probability spread between platform A (e.g., Polymarket) and platform B (e.g., Manifold)
 * - Entry: When |spreadA - spreadB| > entryThreshold
 *   - If probA > probB + threshold: short A, long B (sell expensive, buy cheap)
 *   - If probB > probA + threshold: long A, short B (buy cheap, sell expensive)
 * - Exit: When spread narrows to exitThreshold (mean reversion)
 * - Stop Loss: When spread widens beyond stopThreshold (divergence risk)
 * - Time Stop: Exit after maxHoldBars to prevent capital lockup
 *
 * Usage:
 * - Exchange: polymarket or manifold (doesn't matter, pairs engine fetches both)
 * - Symbol A: PM:some-market-slug
 * - Symbol B: MF:equivalent-manifold-slug
 * - Timeframe: 1h or 15m recommended
 *
 * Example pairs to find:
 * - Same political events listed on both platforms
 * - Same sports outcomes
 * - Same crypto price predictions
 */

import type { PairsStrategy, PairsStrategyContext } from '../src/strategy/pairs-base.js';

// Module-level mutable state (reset in init)
let barsInPosition = 0;
let positionType: 'long-a-short-b' | 'short-a-long-b' | null = null;

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
      default: 0.05,
      min: 0.02,
      max: 0.15,
      step: 0.01,
      description: 'Min spread to enter (0.05 = 5% prob difference)',
    },
    {
      name: 'exitThreshold',
      label: 'Exit Spread',
      type: 'number',
      default: 0.01,
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
  ],

  init(ctx: PairsStrategyContext): void {
    barsInPosition = 0;
    positionType = null;
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
          barsInPosition = 0;
          positionType = null;
        }
      }

      // ================================================================
      // ENTRY LOGIC
      // ================================================================
      if (inPosition || positionType !== null) return;

      // Check if spread exceeds entry threshold
      if (absSpread <= entryThreshold) return;

      // Calculate position sizes (equal notional on both legs)
      const totalNotional = equity * (positionSizePct / 100);
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
