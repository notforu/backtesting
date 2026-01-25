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

  // Engine config for backtests (no saving, no logging for speed)
  const engineConfig: EngineConfig = {
    saveResults: false,
    enableLogging: false,
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
 * Generate all parameter combinations for grid search
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

  // Generate all combinations using cartesian product
  const combinations = cartesianProduct(parameterValues);

  // Limit combinations if needed
  if (combinations.length > maxCombinations) {
    console.warn(
      `Generated ${combinations.length} combinations, limiting to ${maxCombinations}. Consider reducing parameter ranges.`
    );
    // Sample evenly across the space
    return sampleCombinations(combinations, maxCombinations);
  }

  return combinations;
}

/**
 * Generate cartesian product of parameter values
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
 * Sample combinations evenly to stay within limit
 */
function sampleCombinations(
  combinations: Array<Record<string, unknown>>,
  maxCount: number
): Array<Record<string, unknown>> {
  if (combinations.length <= maxCount) return combinations;

  const step = combinations.length / maxCount;
  const sampled: Array<Record<string, unknown>> = [];

  for (let i = 0; i < maxCount; i++) {
    const index = Math.floor(i * step);
    sampled.push(combinations[index]);
  }

  return sampled;
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
