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
  lastExitBar: number;
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
      default: 0.08,
      min: 0.01,
      max: 0.20,
      step: 0.01,
      description: 'Min absolute probability change to enter (0.08 = 8pp move)',
    },
    {
      name: 'exitThreshold',
      label: 'Exit Threshold',
      type: 'number',
      default: 0.04,
      min: 0.005,
      max: 0.10,
      step: 0.005,
      description: 'Reversal threshold to exit (absolute probability change)',
    },
    {
      name: 'positionSizePct',
      label: 'Position Size %',
      type: 'number',
      default: 30,
      min: 10,
      max: 90,
      step: 10,
      description: '% of equity per trade',
    },
    {
      name: 'maxPositionUSD',
      label: 'Max Position ($)',
      type: 'number',
      default: 5000,
      min: 100,
      max: 10000,
      step: 100,
      description: 'Maximum position size in USD (prevents oversizing on thin markets)',
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
    {
      name: 'cooldownBars',
      label: 'Cooldown Bars',
      type: 'number',
      default: 12,
      min: 0,
      max: 20,
      step: 1,
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
      description: 'Min expected profit % to enter (must exceed round-trip costs)',
    },
    {
      name: 'minPriceRange',
      label: 'Min Price Range',
      type: 'number',
      default: 0.15,
      min: 0.02,
      max: 0.50,
      step: 0.02,
      description: 'Min price range (max-min) in lookback window to confirm trend (0.15 = 15pp)',
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
      lastExitBar: -1000,
    };

    (this as any)._state = state;

    context.log(
      `Initialized PM Information Edge: momentumPeriod=${params.momentumPeriod}, entryThreshold=${params.entryThreshold}, exitThreshold=${params.exitThreshold}, positionSize=${params.positionSizePct}%, avoidExtremes=${params.avoidExtremesPct}%, cooldown=${params.cooldownBars}, minProfit=${params.minProfitPct}%, minPriceRange=${params.minPriceRange}`
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
      const maxPositionUSD = params.maxPositionUSD as number;
      const cooldownBars = params.cooldownBars as number;
      const minProfitPct = params.minProfitPct as number;
      const minPriceRange = params.minPriceRange as number;

      const currentPrice = currentCandle.close;

      // Skip forward-filled candles (no real trading)
      if (currentCandle.volume === 0) {
        return;
      }

      // Need at least momentumPeriod + 1 bars to calculate ROC
      if (currentIndex < momentumPeriod) {
        return;
      }

      // Calculate Rate of Change (ROC)
      // Use absolute probability change instead of relative ROC
      // For prediction markets with bounded [0,1] prices, absolute change
      // avoids bias toward low-probability events
      const pastPrice = candles[currentIndex - momentumPeriod].close;
      const roc = currentPrice - pastPrice;

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
            `EXIT LONG: ROC reversed (${(roc * 100).toFixed(2)}pp < -${(exitThreshold * 100).toFixed(2)}pp) at prob=${(currentPrice * 100).toFixed(1)}%, held ${barsHeld} bars`
          );
          context.closeLong();
          state.isLong = false;
          state.lastRoc = roc;
          state.lastExitBar = currentIndex;
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
          state.lastExitBar = currentIndex;
          return;
        }
      }

      if (shortPosition) {
        const barsHeld = currentIndex - state.entryBar;

        // Exit: ROC reverses direction past exit threshold (momentum fading)
        const rocReversed = roc > exitThreshold;

        if (rocReversed) {
          context.log(
            `EXIT SHORT: ROC reversed (${(roc * 100).toFixed(2)}pp > ${(exitThreshold * 100).toFixed(2)}pp) at prob=${(currentPrice * 100).toFixed(1)}%, held ${barsHeld} bars`
          );
          context.closeShort();
          state.isLong = false;
          state.lastRoc = roc;
          state.lastExitBar = currentIndex;
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

        // Trend filter: require sufficient price movement in lookback window
        // This prevents trading in flat/choppy markets where momentum signals are noise
        if (currentIndex >= momentumPeriod) {
          let maxPrice = -Infinity;
          let minPrice = Infinity;
          for (let i = currentIndex - momentumPeriod; i <= currentIndex; i++) {
            const c = candles[i].close;
            if (c > maxPrice) maxPrice = c;
            if (c < minPrice) minPrice = c;
          }
          const priceRange = maxPrice - minPrice;
          if (priceRange < minPriceRange) {
            return; // Market not trending enough
          }
        }

        // Profit filter: ensure momentum signal exceeds minimum expected profit
        if (Math.abs(roc) * 100 <= minProfitPct) {
          return;
        }

        // Entry LONG: Strong positive momentum (probability rising fast)
        if (roc > entryThreshold) {
          const positionValue = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN LONG: ROC=${(roc * 100).toFixed(2)}pp > ${(entryThreshold * 100).toFixed(2)}pp at prob=${(currentPrice * 100).toFixed(1)}%`
            );
            context.openLong(amount);
            state.entryBar = currentIndex;
            state.isLong = true;
            state.lastRoc = roc;
          }
        }

        // Entry SHORT: Strong negative momentum (probability dropping fast)
        if (roc < -entryThreshold) {
          const positionValue = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            context.log(
              `OPEN SHORT: ROC=${(roc * 100).toFixed(2)}pp < -${(entryThreshold * 100).toFixed(2)}pp at prob=${(currentPrice * 100).toFixed(1)}%`
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
