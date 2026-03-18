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

// Register defaults.
// 'default' — explicit opt-in: returned when strategy name is literally 'default'.
calculatorRegistry.set('default', () => defaultWeightCalculator);

// '*' — wildcard fallback: returned for any strategy that has no exact or prefix
// match.  This preserves backward-compatibility so strategies that don't need
// custom weight logic (e.g. non-funding-rate strategies) get weight=1.0 without
// requiring an explicit registration.  Remove this line if you want strict
// enforcement (all unregistered strategies will throw instead of silently
// getting weight=1.0).
calculatorRegistry.set('*', () => defaultWeightCalculator);

// Funding-rate strategies: the 'funding-rate-spike' prefix registration
// matches any name that starts with this prefix — including
// 'funding-rate-spike-v2', 'funding-rate-spike-v3', etc.
calculatorRegistry.set('funding-rate-spike', () => createFundingRateWeightCalculator());

/**
 * Returns the WeightCalculator registered for the given strategy name.
 *
 * Lookup order:
 *   1. Exact match in registry
 *   2. Longest-prefix match (e.g. "funding-rate-spike" matches "funding-rate-spike-v2")
 *   3. Wildcard '*' registration (if present, acts as a catch-all default)
 *   4. Throws an Error — no silent fallback beyond the wildcard.
 *
 * To opt-in to weight=1.0 for all unregistered strategies, register the '*'
 * wildcard (done by default in this module).  To require strict registration,
 * remove the '*' entry and every unregistered strategy name will throw.
 *
 * @throws Error when no matching calculator is found and '*' is not registered.
 */
export function getWeightCalculator(strategyName: string): WeightCalculator {
  // 1. Exact match (also handles 'default' and '*')
  const exact = calculatorRegistry.get(strategyName);
  if (exact !== undefined) {
    return exact();
  }

  // 2. Longest-prefix match: find all registered keys that are a proper prefix
  //    of strategyName, then pick the longest one.
  //    The '*' wildcard is intentionally excluded from prefix matching.
  let bestPrefix: string | null = null;
  for (const key of calculatorRegistry.keys()) {
    if (key === '*') continue;
    if (strategyName.startsWith(key) && (bestPrefix === null || key.length > bestPrefix.length)) {
      bestPrefix = key;
    }
  }

  if (bestPrefix !== null) {
    return calculatorRegistry.get(bestPrefix)!();
  }

  // 3. Wildcard fallback
  const wildcard = calculatorRegistry.get('*');
  if (wildcard !== undefined) {
    return wildcard();
  }

  // 4. No match — throw so configuration problems surface immediately.
  throw new Error(
    `No weight calculator registered for strategy "${strategyName}". ` +
    `Register one via registerWeightCalculator() or use the 'default' key for an explicit default.`,
  );
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
