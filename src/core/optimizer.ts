/**
 * Parameter Optimization Engine
 * Grid search optimization for strategy parameters
 */

import { v4 as uuidv4 } from 'uuid';
import type { Timeframe, PerformanceMetrics, PairsBacktestConfig, Candle, FundingRate } from './types.js';
import { runBacktest, type EngineConfig } from './engine.js';
import { runPairsBacktest } from './pairs-engine.js';
import { loadStrategy } from '../strategy/loader.js';
import { saveOptimizedParams, saveCandles, getCandleDateRange, getCandles, getFundingRates } from '../data/db.js';
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
  optimizeFor: 'sharpeRatio' | 'totalReturnPercent' | 'profitFactor' | 'winRate' | 'composite';
  maxCombinations?: number; // Limit grid size
  batchSize?: number; // Parallel execution batch size
  minTrades?: number; // Minimum trades required for valid result (default: 10)

  // Pairs trading specific (optional)
  symbolB?: string; // Second symbol for pairs trading
  leverage?: number; // Leverage for pairs trading (default: 1)

  // Additional options
  saveAllRuns?: boolean; // Save every backtest run to history
  mode?: 'spot' | 'futures'; // Trading mode

  /**
   * Run optimization on a coarser timeframe for speed (e.g., '5m' instead of '1m')
   * The test/validation phase still uses the original timeframe for accuracy
   */
  optimizeTimeframe?: Timeframe;
}

/**
 * Result of parameter optimization
 */
export interface OptimizationResult {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  bestParams: Record<string, unknown>;
  bestMetrics: PerformanceMetrics;
  totalCombinations: number;
  testedCombinations: number;
  optimizedAt: number;
  startDate?: number;
  endDate?: number;
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
    maxCombinations = 500,
    minTrades = 10,
    saveAllRuns = false,
    mode,
    optimizeTimeframe,
  } = config;

  // Use a coarser timeframe for speed if specified
  const effectiveTimeframe = optimizeTimeframe || timeframe;
  if (optimizeTimeframe) {
    console.log(`Using coarser timeframe ${optimizeTimeframe} for optimization (original: ${timeframe})`);
  }

  // Load strategy to get parameter definitions
  const strategy = await loadStrategy(strategyName);

  // Check if this is a pairs strategy
  const isPairsStrategy = (strategy as any).isPairs === true;

  // Validate pairs configuration
  if (isPairsStrategy && !config.symbolB) {
    throw new Error('Pairs strategy requires symbolB parameter');
  }

  // Generate parameter combinations
  const combinations = generateParameterCombinations(strategy.params, paramRanges, maxCombinations);

  if (combinations.length === 0) {
    throw new Error('No parameter combinations to test. Check paramRanges configuration.');
  }

  const totalCombinations = combinations.length;
  console.log(`Testing ${totalCombinations} parameter combinations...`);

  // Pre-fetch candles to avoid fetching during backtests
  console.log('Pre-fetching candle data...');
  const provider = getProvider(exchange);

  // Fetch candles for symbol A (with PM-aware cache check, using effectiveTimeframe)
  const isPM = ['polymarket', 'manifold'].includes(exchange);
  const cachedRange = await getCandleDateRange(exchange, symbol, effectiveTimeframe);
  const needsFetchA = !cachedRange.start || !cachedRange.end ||
    (!isPM && (cachedRange.start > startDate || cachedRange.end < endDate)) ||
    (isPM && cachedRange.end < Date.now() - 7 * 24 * 60 * 60 * 1000);

  if (needsFetchA) {
    const fetchedCandles = await provider.fetchCandles(symbol, effectiveTimeframe, new Date(startDate), new Date(endDate));
    if (fetchedCandles.length > 0) {
      await saveCandles(fetchedCandles, exchange, symbol, effectiveTimeframe);
      console.log(`Cached ${fetchedCandles.length} candles for ${symbol} (${effectiveTimeframe})`);
    }
  } else {
    console.log(`Using existing cached candles for ${symbol} (${effectiveTimeframe})`);
  }

  // Load candles into memory once for all combinations
  console.log('Loading candles into memory for reuse...');
  const preloadedCandles: Candle[] = await getCandles(exchange, symbol, effectiveTimeframe, startDate, endDate);
  console.log(`Pre-loaded ${preloadedCandles.length} candles (${effectiveTimeframe})`);

  // If pairs strategy, also fetch candles for symbol B
  if (isPairsStrategy && config.symbolB) {
    const cachedRangeB = await getCandleDateRange(exchange, config.symbolB, effectiveTimeframe);
    const needsFetchB = !cachedRangeB.start || !cachedRangeB.end ||
      (!isPM && (cachedRangeB.start > startDate || cachedRangeB.end < endDate)) ||
      (isPM && cachedRangeB.end < Date.now() - 7 * 24 * 60 * 60 * 1000);

    if (needsFetchB) {
      const candlesB = await provider.fetchCandles(config.symbolB, effectiveTimeframe, new Date(startDate), new Date(endDate));
      if (candlesB.length > 0) {
        await saveCandles(candlesB, exchange, config.symbolB, effectiveTimeframe);
        console.log(`Cached ${candlesB.length} candles for ${config.symbolB} (${effectiveTimeframe})`);
      }
    } else {
      console.log(`Using existing cached candles for ${config.symbolB} (${effectiveTimeframe})`);
    }
  }

  // Pre-load funding rates once for futures mode
  let preloadedFundingRates: FundingRate[] = [];
  if (mode === 'futures') {
    console.log('Pre-loading funding rates...');
    preloadedFundingRates = await getFundingRates(exchange, symbol, startDate, endDate);
    console.log(`Pre-loaded ${preloadedFundingRates.length} funding rates`);
  }

  // Pre-fetch trading fees once (cache for all backtest runs)
  let cachedFeeRate = 0.001; // Default 0.1% taker fee
  try {
    const fees = await provider.fetchTradingFees(symbol);
    cachedFeeRate = fees.taker;
    console.log(`Using exchange fee rate: ${(cachedFeeRate * 100).toFixed(3)}% (taker)`);
  } catch {
    console.log(`Could not fetch fees, using default: ${(cachedFeeRate * 100).toFixed(3)}%`);
  }

  // Track best result only (don't store all results to save memory)
  let bestResult: { params: Record<string, unknown>; metrics: PerformanceMetrics } | null = null;
  let bestMetricValue = -Infinity;

  // Engine config for backtests (no logging, use cached fee rate, preloaded data)
  const engineConfig: EngineConfig = {
    saveResults: saveAllRuns, // Save every run when requested
    enableLogging: false,
    skipFeeFetch: true, // Skip API calls, use cached fee rate below
    broker: {
      slippagePercent: 0, // No slippage (consistent with default engine config)
      commissionPercent: 0, // No commission (fees handled via feeRate)
      feeRate: cachedFeeRate, // Pre-fetched fee rate
    },
    preloadedCandles, // Reuse same candles for every combination
    preloadedFundingRates: mode === 'futures' ? preloadedFundingRates : undefined,
    earlyStopEquityFraction: 0.3, // Stop if equity drops 70% (clearly bad param set)
    preloadedStrategy: strategy, // Reuse already-loaded strategy to skip import() overhead
  };

  // Process combinations sequentially to control memory usage
  let testedCount = 0;

  for (let i = 0; i < combinations.length; i++) {
    const params = combinations[i];

    try {
      let runResult: { params: Record<string, unknown>; metrics: PerformanceMetrics } | null = null;

      if (isPairsStrategy) {
        // Pairs strategy - use pairs backtest
        const pairsConfig: PairsBacktestConfig = {
          id: uuidv4(),
          strategyName,
          params,
          symbolA: symbol,
          symbolB: config.symbolB!,
          timeframe: effectiveTimeframe,
          startDate,
          endDate,
          initialCapital,
          exchange,
          leverage: config.leverage ?? 1,
        };
        const result = await runPairsBacktest(pairsConfig, engineConfig);
        runResult = { params, metrics: result.metrics };
      } else {
        // Single symbol strategy - use regular backtest
        const result = await runBacktest(
          {
            id: uuidv4(),
            strategyName,
            params,
            symbol,
            timeframe: effectiveTimeframe,
            startDate,
            endDate,
            initialCapital,
            exchange,
            mode,
          },
          engineConfig
        );
        runResult = { params, metrics: result.metrics };
      }

      testedCount++;

      // Skip results with insufficient trades
      if (runResult.metrics.totalTrades < minTrades) {
        console.warn(`Skipping params - only ${runResult.metrics.totalTrades} trades (min: ${minTrades})`);
      } else {
        // Check if this is the best result so far
        let metricValue: number;
        if (optimizeFor === 'composite') {
          metricValue = calculateCompositeScore(runResult.metrics);
        } else {
          metricValue = runResult.metrics[optimizeFor];
        }

        if (metricValue > bestMetricValue) {
          bestMetricValue = metricValue;
          bestResult = runResult;
        }
      }
    } catch (error) {
      // Log error but continue with other combinations
      console.warn(`Failed to test params ${JSON.stringify(params)}:`, error);
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

    // Yield to event loop and allow GC between runs
    if (i % 10 === 0) {
      await new Promise(resolve => setImmediate(resolve));
      if (global.gc) global.gc();
    }
  }

  if (!bestResult) {
    throw new Error(`No parameter combination produced at least ${minTrades} trades. Try widening parameter ranges or using a longer time period.`);
  }

  // Create optimization result (no allResults to save memory)
  const optimizationResult: OptimizationResult = {
    id: uuidv4(),
    strategyName,
    symbol,
    timeframe,
    bestParams: bestResult.params,
    bestMetrics: bestResult.metrics,
    totalCombinations,
    testedCombinations: testedCount,
    optimizedAt: Date.now(),
    startDate,
    endDate,
  };

  // Save to database
  await saveOptimizedParams(optimizationResult);

  console.log(`\nOptimization complete!`);
  console.log(`Best ${optimizeFor}: ${bestMetricValue.toFixed(4)}`);
  console.log(`Best params:`, bestResult.params);

  return optimizationResult;
}

// ============================================================================
// Multi-Symbol/Timeframe Optimization
// ============================================================================

/**
 * Multi-symbol/timeframe optimization progress
 */
export interface MultiOptimizationProgress extends OptimizationProgress {
  currentSymbol?: string;
  currentTimeframe?: string;
  overallCurrent?: number;
  overallTotal?: number;
}

/**
 * Run optimization across multiple symbols and timeframes
 * @param config - Base optimization config
 * @param symbols - Array of symbols to test
 * @param timeframes - Array of timeframes to test
 * @param onProgress - Optional progress callback
 * @returns Array of optimization results
 */
export async function runMultiOptimization(
  config: OptimizationConfig,
  symbols: string[],
  timeframes: Timeframe[],
  onProgress?: (progress: MultiOptimizationProgress) => void
): Promise<OptimizationResult[]> {
  const results: OptimizationResult[] = [];
  const totalJobs = symbols.length * timeframes.length;
  let completedJobs = 0;

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      try {
        const result = await runOptimization(
          { ...config, symbol, timeframe },
          (progress) => {
            if (onProgress) {
              onProgress({
                ...progress,
                currentSymbol: symbol,
                currentTimeframe: timeframe,
                overallCurrent: completedJobs,
                overallTotal: totalJobs,
              });
            }
          }
        );
        results.push(result);
      } catch (error) {
        console.warn(
          `Optimization failed for ${symbol} ${timeframe}:`,
          error instanceof Error ? error.message : error
        );
      }
      completedJobs++;

      // Report overall progress
      if (onProgress) {
        onProgress({
          current: 0,
          total: 0,
          percent: (completedJobs / totalJobs) * 100,
          currentSymbol: symbol,
          currentTimeframe: timeframe,
          overallCurrent: completedJobs,
          overallTotal: totalJobs,
        });
      }
    }
  }

  return results;
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
 * Adds jitter to avoid systematic gaps in sampling
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
    // Add jitter to sampling to avoid systematic gaps
    const jitter = Math.random() * step * 0.5;
    const targetIndex = Math.floor(i * step + jitter) % totalCombinations;
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
// Composite Scoring
// ============================================================================

/**
 * Calculate composite optimization score
 * Balances multiple metrics for more robust optimization
 *
 * This approach addresses the limitation of single-metric optimization by combining:
 * - Sharpe Ratio: Risk-adjusted returns
 * - Total Return: Absolute profitability
 * - Profit Factor: Win/loss ratio
 * - Win Rate: Consistency
 * - Max Drawdown: Downside protection
 *
 * @param metrics - Performance metrics from a backtest
 * @returns Normalized composite score (0-1 range, higher is better)
 */
function calculateCompositeScore(metrics: PerformanceMetrics): number {
  // Weights for different metrics (must sum to 1.0)
  const weights = {
    sharpeRatio: 0.25,
    totalReturnPercent: 0.30,
    profitFactor: 0.20,
    winRate: 0.15,
    maxDrawdownPenalty: 0.10,
  };

  // Normalize metrics to 0-1 range
  // Sharpe: typically -2 to 3, normalize assuming range of -1 to 3
  const sharpeNorm = Math.max(0, Math.min(1, (metrics.sharpeRatio + 1) / 4));

  // Return: typically -50% to 50%, normalize to 0-1 (0% = 0.5, 50% = 1.0, -50% = 0.0)
  const returnNorm = Math.max(0, Math.min(1, (metrics.totalReturnPercent + 50) / 100));

  // Profit factor: typically 0 to 5, normalize to 0-1 (PF of 4+ is excellent)
  const pfNorm = Math.max(0, Math.min(1, metrics.profitFactor / 4));

  // Win rate: 0-100%, normalize to 0-1
  const wrNorm = metrics.winRate / 100;

  // Drawdown penalty: lower drawdown is better, so invert
  // Typical drawdowns are 5-30%, normalize assuming 30% is worst acceptable
  const ddPenalty = Math.max(0, 1 - metrics.maxDrawdownPercent / 30);

  // Calculate weighted sum
  const compositeScore = (
    weights.sharpeRatio * sharpeNorm +
    weights.totalReturnPercent * returnNorm +
    weights.profitFactor * pfNorm +
    weights.winRate * wrNorm +
    weights.maxDrawdownPenalty * ddPenalty
  );

  return compositeScore;
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
