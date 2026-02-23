/**
 * Weight Calculators for Signal Aggregation
 *
 * Provides implementations of WeightCalculator that determine how strongly
 * a signal should be weighted when aggregating across multiple sub-strategies.
 */

import type { WeightCalculator, WeightContext } from './signal-types.js';

// ============================================================================
// Default Weight Calculator
// ============================================================================

/**
 * Always returns a weight of 1.0. Use this when no special weighting logic
 * is needed and all signals should be treated equally.
 */
export const defaultWeightCalculator: WeightCalculator = {
  calculateWeight(_context: WeightContext): number {
    return 1.0;
  },
};

// ============================================================================
// Funding Rate Weight Calculator
// ============================================================================

/**
 * Calculates weight based on how extreme the current funding rate is relative
 * to the maximum absolute funding rate seen in the lookback window.
 *
 * A funding rate equal to the max in the window yields weight 1.0.
 * A funding rate of zero yields weight 0.
 * Intermediate values are linearly interpolated.
 *
 * @param lookbackBars - Number of bars to look back when computing the max
 *   absolute funding rate. Defaults to 24.
 */
export function createFundingRateWeightCalculator(lookbackBars: number = 24): WeightCalculator {
  return {
    calculateWeight(context: WeightContext): number {
      const { currentFundingRate, fundingRates } = context;
      if (currentFundingRate === undefined || !fundingRates || fundingRates.length === 0) {
        return 0;
      }

      // Get lookback window of funding rates
      const recentRates = fundingRates.slice(-lookbackBars);
      if (recentRates.length === 0) return 0;

      // Find max absolute funding rate in lookback window
      const maxAbsFR = Math.max(...recentRates.map(fr => Math.abs(fr.fundingRate)));
      if (maxAbsFR === 0) return 0;

      // Weight = how extreme current rate is relative to max in window
      return Math.min(1, Math.abs(currentFundingRate) / maxAbsFR);
    },
  };
}

// ============================================================================
// Registry
// ============================================================================

const calculatorRegistry = new Map<string, () => WeightCalculator>();

// Register defaults
calculatorRegistry.set('default', () => defaultWeightCalculator);
calculatorRegistry.set('funding-rate-spike', () => createFundingRateWeightCalculator());

/**
 * Returns the WeightCalculator registered for the given strategy name.
 * Falls back to the 'default' calculator if no specific one is registered.
 */
export function getWeightCalculator(strategyName: string): WeightCalculator {
  const factory = calculatorRegistry.get(strategyName) ?? calculatorRegistry.get('default')!;
  return factory();
}

/**
 * Registers a WeightCalculator factory for a given strategy name.
 * Call this at application startup to add custom calculators.
 */
export function registerWeightCalculator(
  strategyName: string,
  factory: () => WeightCalculator,
): void {
  calculatorRegistry.set(strategyName, factory);
}
