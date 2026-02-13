import type { Strategy, StrategyContext } from '../src/strategy/base.js';

/**
 * Prediction Market Information Edge Strategy
 *
 * Momentum/trend-following strategy for prediction markets that tracks
 * rate-of-change (ROC) in probability to detect information cascades.
 *
 * Logic:
 * - Calculate rolling ROC of probability over momentumPeriod bars
 * - Enter LONG when ROC > entryThreshold (rapid probability increase)
 * - Enter SHORT when ROC < -entryThreshold (rapid probability decrease)
 * - Exit when momentum reverses past exitThreshold
 * - Filter out trades near extremes (0 or 1 probability) to avoid binary risk
 *
 * Price values represent probabilities in range [0, 1]
 */

interface StrategyState {
  entryBar: number;
  lastRoc: number;
  isLong: boolean;
  rocHistory: number[];
}

const pmInformationEdge: Strategy = {
  name: 'pm-information-edge',
  description: 'Momentum/trend-following on prediction market probability changes',
  version: '1.0.0',

  params: [
    {
      name: 'momentumPeriod',
      label: 'Momentum Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 100,
      step: 5,
      description: 'Bars for ROC calculation',
    },
    {
      name: 'entryThreshold',
      label: 'Entry Threshold',
      type: 'number',
      default: 0.05,
      min: 0.01,
      max: 0.20,
      step: 0.01,
      description: 'Min ROC to enter (0.05 = 5% probability move)',
    },
    {
      name: 'exitThreshold',
      label: 'Exit Threshold',
      type: 'number',
      default: 0.02,
      min: 0.005,
      max: 0.10,
      step: 0.005,
      description: 'ROC reversal to exit',
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 50,
      min: 10,
      max: 90,
      step: 10,
      description: '% of equity per trade',
    },
    {
      name: 'avoidExtremesPct',
      label: 'Avoid Extremes %',
      type: 'number',
      default: 10,
      min: 5,
      max: 25,
      step: 5,
      description: 'Skip trades when prob < X% or > (100-X)%',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;

    // Initialize state using closure pattern (IIFE below will capture this)
    const state: StrategyState = {
      entryBar: 0,
      lastRoc: 0,
      isLong: false,
      rocHistory: [],
    };

    (this as any)._state = state;

    context.log(
      `Initialized PM Information Edge: momentumPeriod=${params.momentumPeriod}, entryThreshold=${params.entryThreshold}, exitThreshold=${params.exitThreshold}, positionSize=${params.positionSizePct}%, avoidExtremes=${params.avoidExtremesPct}%`
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
      const momentumPeriod = params.momentumPeriod as number;
      const entryThreshold = params.entryThreshold as number;
      const exitThreshold = params.exitThreshold as number;
      const positionSizePct = params.positionSizePct as number;
      const avoidExtremesPct = params.avoidExtremesPct as number;

      const currentPrice = currentCandle.close;

      // Need at least momentumPeriod + 1 bars to calculate ROC
      if (currentIndex < momentumPeriod) {
        return;
      }

      // Calculate Rate of Change (ROC)
      // ROC = (current_price - price_N_bars_ago) / price_N_bars_ago
      const pastPrice = candles[currentIndex - momentumPeriod].close;
      const roc = pastPrice > 0 ? (currentPrice - pastPrice) / pastPrice : 0;

      // Store ROC for trend analysis
      state.rocHistory.push(roc);
      if (state.rocHistory.length > 5) {
        state.rocHistory.shift(); // Keep only recent ROC values
      }

      // Filter: Avoid extremes (prices near 0 or 1)
      const lowerBound = avoidExtremesPct / 100;
      const upperBound = 1 - (avoidExtremesPct / 100);
      const isInExtremeZone = currentPrice < lowerBound || currentPrice > upperBound;

      // === EXIT LOGIC ===

      if (longPosition) {
        const barsHeld = currentIndex - state.entryBar;

        // Exit: ROC reverses direction past exit threshold (momentum fading)
        const rocReversed = roc < -exitThreshold;

        if (rocReversed) {
          context.log(
            `EXIT LONG: ROC reversed (${(roc * 100).toFixed(2)}% < -${(exitThreshold * 100).toFixed(2)}%) at prob=${(currentPrice * 100).toFixed(1)}%, held ${barsHeld} bars`
          );
          context.closeLong();
          state.isLong = false;
          state.lastRoc = roc;
          return;
        }

        // Safety exit: Price moved into extreme zone
        if (currentPrice > upperBound) {
          context.log(
            `EXIT LONG: Price in extreme zone (${(currentPrice * 100).toFixed(1)}% > ${(upperBound * 100).toFixed(1)}%), held ${barsHeld} bars`
          );
          context.closeLong();
          state.isLong = false;
          state.lastRoc = roc;
          return;
        }
      }

      if (shortPosition) {
        const barsHeld = currentIndex - state.entryBar;

        // Exit: ROC reverses direction past exit threshold (momentum fading)
        const rocReversed = roc > exitThreshold;

        if (rocReversed) {
          context.log(
            `EXIT SHORT: ROC reversed (${(roc * 100).toFixed(2)}% > ${(exitThreshold * 100).toFixed(2)}%) at prob=${(currentPrice * 100).toFixed(1)}%, held ${barsHeld} bars`
          );
          context.closeShort();
          state.isLong = false;
          state.lastRoc = roc;
          return;
        }

        // Safety exit: Price moved into extreme zone
        if (currentPrice < lowerBound) {
          context.log(
            `EXIT SHORT: Price in extreme zone (${(currentPrice * 100).toFixed(1)}% < ${(lowerBound * 100).toFixed(1)}%), held ${barsHeld} bars`
          );
          context.closeShort();
          state.isLong = false;
          state.lastRoc = roc;
          return;
        }
      }

      // === ENTRY LOGIC ===

      // Only enter if not already in a position and not in extreme zone
      if (!longPosition && !shortPosition && !isInExtremeZone) {
        // Entry LONG: Strong positive momentum (probability rising fast)
        if (roc > entryThreshold) {
          const positionValue = equity * (positionSizePct / 100);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN LONG: ROC=${(roc * 100).toFixed(2)}% > ${(entryThreshold * 100).toFixed(2)}% at prob=${(currentPrice * 100).toFixed(1)}%`
            );
            context.openLong(amount);
            state.entryBar = currentIndex;
            state.isLong = true;
            state.lastRoc = roc;
          }
        }

        // Entry SHORT: Strong negative momentum (probability dropping fast)
        if (roc < -entryThreshold) {
          const positionValue = equity * (positionSizePct / 100);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN SHORT: ROC=${(roc * 100).toFixed(2)}% < -${(entryThreshold * 100).toFixed(2)}% at prob=${(currentPrice * 100).toFixed(1)}%`
            );
            context.openShort(amount);
            state.entryBar = currentIndex;
            state.isLong = false;
            state.lastRoc = roc;
          }
        }
      }

      // Update last ROC for next bar
      state.lastRoc = roc;
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

export default pmInformationEdge;
