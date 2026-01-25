/**
 * Parameter Optimization Engine
 * Grid search optimization for strategy parameters
 */

import { v4 as uuidv4 } from 'uuid';
import type { Timeframe, PerformanceMetrics } from './types.js';
import { runBacktest, type EngineConfig } from './engine.js';
import { loadStrategy } from '../strategy/loader.js';
import { saveOptimizedParams, saveCandles, getCandleDateRange } from '../data/db.js';
import { getProvider } from '../data/providers/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for parameter optimization
 */
export interface OptimizationConfig {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: number;
  endDate: number;
  initialCapital: number;
  exchange: string;

  // Optimization specific
  paramRanges?: Record<string, { min: number; max: number; step: number }>;
  optimizeFor: 'sharpeRatio' | 'totalReturnPercent' | 'profitFactor' | 'winRate';
  maxCombinations?: number; // Limit grid size
  batchSize?: number; // Parallel execution batch size
}

/**
 * Result of parameter optimization
 */
export interface OptimizationResult {
  id: string;
  strategyName: string;
  symbol: string;
  bestParams: Record<string, unknown>;
  bestMetrics: PerformanceMetrics;
  totalCombinations: number;
  testedCombinations: number;
  optimizedAt: number;
  allResults?: Array<{ params: Record<string, unknown>; metrics: PerformanceMetrics }>;
}

/**
 * Progress callback data
 */
export interface OptimizationProgress {
  current: number;
  total: number;
  percent: number;
  currentBest?: { params: Record<string, unknown>; metric: number };
}

// ============================================================================
// Main Optimization Function
// ============================================================================

/**
 * Run parameter optimization using grid search
 * @param config - Optimization configuration
 * @param onProgress - Optional progress callback
 * @returns Optimization result with best parameters
 */
export async function runOptimization(
  config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void
): Promise<OptimizationResult> {
  const {
    strategyName,
    symbol,
    timeframe,
    startDate,
    endDate,
    initialCapital,
    exchange,
    paramRanges,
    optimizeFor,
    maxCombinations = 1000,
    batchSize = 4,
  } = config;

  // Load strategy to get parameter definitions
  const strategy = await loadStrategy(strategyName);

  // Generate parameter combinations
  const combinations = generateParameterCombinations(strategy.params, paramRanges, maxCombinations);

  if (combinations.length === 0) {
    throw new Error('No parameter combinations to test. Check paramRanges configuration.');
  }

  const totalCombinations = combinations.length;
  console.log(`Testing ${totalCombinations} parameter combinations...`);

  // Pre-fetch candles to avoid fetching during backtests
  console.log('Pre-fetching candle data...');
  const cachedRange = getCandleDateRange(exchange, symbol, timeframe);
  if (!cachedRange.start || !cachedRange.end || cachedRange.start > startDate || cachedRange.end < endDate) {
    const provider = getProvider(exchange);
    const candles = await provider.fetchCandles(symbol, timeframe, new Date(startDate), new Date(endDate));
    if (candles.length > 0) {
      saveCandles(candles, exchange, symbol, timeframe);
      console.log(`Cached ${candles.length} candles`);
    }
  } else {
    console.log('Using existing cached candles');
  }

  // Track best result only (don't store all results to save memory)
  let bestResult: { params: Record<string, unknown>; metrics: PerformanceMetrics } | null = null;
  let bestMetricValue = -Infinity;

  // Engine config for backtests (no saving, no logging, skip fee fetch for speed)
  const engineConfig: EngineConfig = {
    saveResults: false,
    enableLogging: false,
    skipFeeFetch: true, // Use default fees to avoid API calls
  };

  // Process combinations in batches
  let testedCount = 0;

  for (let i = 0; i < combinations.length; i += batchSize) {
    const batch = combinations.slice(i, i + batchSize);

    // Run batch in parallel
    const batchPromises = batch.map(async (params) => {
      try {
        const result = await runBacktest(
          {
            id: uuidv4(),
            strategyName,
            params,
            symbol,
            timeframe,
            startDate,
            endDate,
            initialCapital,
            exchange,
          },
          engineConfig
        );

        return { params, metrics: result.metrics };
      } catch (error) {
        // Log error but continue with other combinations
        console.warn(`Failed to test params ${JSON.stringify(params)}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // Process results
    for (const result of batchResults) {
      if (!result) continue;

      testedCount++;

      // Check if this is the best result so far
      const metricValue = result.metrics[optimizeFor];
      if (metricValue > bestMetricValue) {
        bestMetricValue = metricValue;
        bestResult = result;
      }
    }

    // Report progress
    if (onProgress) {
      onProgress({
        current: testedCount,
        total: totalCombinations,
        percent: (testedCount / totalCombinations) * 100,
        currentBest: bestResult
          ? { params: bestResult.params, metric: bestMetricValue }
          : undefined,
      });
    }

    // Allow GC between batches to prevent memory buildup
    await new Promise(resolve => setImmediate(resolve));
  }

  if (!bestResult) {
    throw new Error('No successful backtest runs. All parameter combinations failed.');
  }

  // Create optimization result (no allResults to save memory)
  const optimizationResult: OptimizationResult = {
    id: uuidv4(),
    strategyName,
    symbol,
    bestParams: bestResult.params,
    bestMetrics: bestResult.metrics,
    totalCombinations,
    testedCombinations: testedCount,
    optimizedAt: Date.now(),
  };

  // Save to database
  saveOptimizedParams(optimizationResult);

  console.log(`\nOptimization complete!`);
  console.log(`Best ${optimizeFor}: ${bestMetricValue.toFixed(4)}`);
  console.log(`Best params:`, bestResult.params);

  return optimizationResult;
}

// ============================================================================
// Parameter Combination Generation
// ============================================================================

/**
 * Generate parameter combinations for grid search (memory-efficient)
 * Uses indexed sampling to avoid generating all combinations upfront
 */
function generateParameterCombinations(
  paramDefs: Array<{ name: string; type: string; default: unknown; min?: number; max?: number; step?: number }>,
  paramRanges: Record<string, { min: number; max: number; step: number }> | undefined,
  maxCombinations: number
): Array<Record<string, unknown>> {
  // Build ranges for each parameter
  const parameterValues: Record<string, unknown[]> = {};

  for (const paramDef of paramDefs) {
    const paramName = paramDef.name;
    const range = paramRanges?.[paramName];

    if (range && paramDef.type === 'number') {
      // Use provided range
      const { min, max, step } = range;
      const values: number[] = [];

      for (let value = min; value <= max; value += step) {
        values.push(value);
      }

      parameterValues[paramName] = values;
    } else if (paramDef.min !== undefined && paramDef.max !== undefined && paramDef.step !== undefined) {
      // Use parameter definition range
      const values: number[] = [];
      for (let value = paramDef.min; value <= paramDef.max; value += paramDef.step) {
        values.push(value);
      }
      parameterValues[paramName] = values;
    } else {
      // No range defined, use default value only
      parameterValues[paramName] = [paramDef.default];
    }
  }

  // Calculate total combinations without generating them
  const keys = Object.keys(parameterValues);
  let totalCombinations = 1;
  for (const key of keys) {
    totalCombinations *= parameterValues[key].length;
  }

  // If within limit, generate all
  if (totalCombinations <= maxCombinations) {
    return cartesianProduct(parameterValues);
  }

  // Otherwise, sample evenly using indexed access (memory-efficient)
  console.warn(
    `${totalCombinations.toLocaleString()} possible combinations, sampling ${maxCombinations}. Consider reducing parameter ranges.`
  );
  return sampleCombinationsIndexed(parameterValues, keys, totalCombinations, maxCombinations);
}

/**
 * Generate cartesian product of parameter values (only for small sets)
 */
function cartesianProduct(
  parameterValues: Record<string, unknown[]>
): Array<Record<string, unknown>> {
  const keys = Object.keys(parameterValues);
  if (keys.length === 0) return [];

  const result: Array<Record<string, unknown>> = [];

  function generate(index: number, current: Record<string, unknown>): void {
    if (index === keys.length) {
      result.push({ ...current });
      return;
    }

    const key = keys[index];
    const values = parameterValues[key];

    for (const value of values) {
      current[key] = value;
      generate(index + 1, current);
    }
  }

  generate(0, {});
  return result;
}

/**
 * Sample combinations by index without generating all (memory-efficient)
 * Converts an index into a specific combination using modular arithmetic
 */
function sampleCombinationsIndexed(
  parameterValues: Record<string, unknown[]>,
  keys: string[],
  totalCombinations: number,
  maxCount: number
): Array<Record<string, unknown>> {
  const sampled: Array<Record<string, unknown>> = [];
  const step = totalCombinations / maxCount;

  // Precompute the size of each parameter array for index conversion
  const sizes = keys.map(key => parameterValues[key].length);

  for (let i = 0; i < maxCount; i++) {
    const targetIndex = Math.floor(i * step);
    const combination = indexToCombination(targetIndex, keys, parameterValues, sizes);
    sampled.push(combination);
  }

  return sampled;
}

/**
 * Convert a flat index into a specific parameter combination
 * Works like converting a number to a mixed-radix representation
 */
function indexToCombination(
  index: number,
  keys: string[],
  parameterValues: Record<string, unknown[]>,
  sizes: number[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let remaining = index;

  // Work backwards through the keys
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const values = parameterValues[key];
    const size = sizes[i];
    const valueIndex = remaining % size;
    result[key] = values[valueIndex];
    remaining = Math.floor(remaining / size);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get metric value from metrics object
 */
export function getMetricValue(metrics: PerformanceMetrics, metricName: string): number {
  return metrics[metricName as keyof PerformanceMetrics] as number;
}

/**
 * Compare two parameter sets
 */
export function compareParams(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();

  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (a[keysA[i]] !== b[keysB[i]]) return false;
  }

  return true;
}
