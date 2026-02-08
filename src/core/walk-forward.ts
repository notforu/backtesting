/**
 * Walk-Forward Testing Module
 *
 * Validates strategy parameters by splitting data into train (optimization)
 * and test (out-of-sample validation) periods. This technique helps detect
 * overfitting by measuring how well optimized parameters perform on unseen data.
 *
 * Method:
 * 1. Split data into train (70%) and test (30%) periods
 * 2. Optimize strategy parameters on train period
 * 3. Validate optimized parameters on test period
 * 4. Calculate out-of-sample (OOS) degradation
 * 5. Assess robustness based on degradation threshold
 */

import { v4 as uuidv4 } from 'uuid';
import type { Timeframe, PerformanceMetrics, PairsBacktestConfig } from './types.js';
import { runOptimization, type OptimizationConfig, type OptimizationResult } from './optimizer.js';
import { runBacktest, type EngineConfig } from './engine.js';
import { runPairsBacktest } from './pairs-engine.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Metric to optimize for during walk-forward testing
 */
export type OptimizeMetric = 'sharpeRatio' | 'totalReturn' | 'profitFactor' | 'sortino' | 'calmar';

/**
 * Configuration for walk-forward testing
 */
export interface WalkForwardConfig {
  /**
   * Strategy name to test
   */
  strategyName: string;

  /**
   * Trading symbol (e.g., 'BTC/USDT')
   */
  symbol: string;

  /**
   * Candle timeframe
   */
  timeframe: Timeframe;

  /**
   * Start timestamp in milliseconds
   */
  startDate: number;

  /**
   * End timestamp in milliseconds
   */
  endDate: number;

  /**
   * Train/test split ratio (default: 0.7 = 70% train, 30% test)
   */
  trainRatio: number;

  /**
   * Parameter ranges for optimization (optional)
   * If not provided, uses strategy defaults
   */
  paramRanges?: Record<string, { min: number; max: number; step: number }>;

  /**
   * Metric to optimize for
   */
  optimizeFor: OptimizeMetric;

  /**
   * Exchange name (default: 'binance')
   */
  exchange?: string;

  /**
   * Initial capital for backtests (default: 10000)
   */
  initialCapital?: number;

  /**
   * Maximum parameter combinations to test (default: 500)
   */
  maxCombinations?: number;

  /**
   * Minimum trades required for valid optimization (default: 10)
   */
  minTrades?: number;

  /**
   * OOS degradation threshold for robustness (default: 30%)
   */
  oosThreshold?: number;

  /**
   * Minimum test Sharpe ratio for robustness (default: 0.5)
   */
  minTestSharpe?: number;

  /**
   * Second symbol for pairs trading (optional)
   */
  symbolB?: string;

  /**
   * Leverage for pairs trading (default: 1)
   */
  leverage?: number;
}

/**
 * Result of walk-forward testing
 */
export interface WalkForwardResult {
  /**
   * Training period
   */
  trainPeriod: { start: number; end: number };

  /**
   * Training period metrics
   */
  trainMetrics: PerformanceMetrics;

  /**
   * Optimized parameters from training
   */
  optimizedParams: Record<string, unknown>;

  /**
   * Test (out-of-sample) period
   */
  testPeriod: { start: number; end: number };

  /**
   * Test period metrics
   */
  testMetrics: PerformanceMetrics;

  /**
   * Out-of-sample degradation percentage
   * Formula: (trainSharpe - testSharpe) / trainSharpe * 100
   * Positive values indicate performance degradation
   */
  oosDegrade: number;

  /**
   * Whether the strategy is considered robust
   * Criteria: OOS degradation < threshold AND testSharpe > minimum
   */
  isRobust: boolean;

  /**
   * Full optimization result from training period
   */
  optimizationResult: OptimizationResult;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Run walk-forward test on a strategy
 *
 * @param config - Walk-forward test configuration
 * @returns Walk-forward test results with robustness assessment
 *
 * @example
 * ```typescript
 * const result = await runWalkForwardTest({
 *   strategyName: 'sma-cross',
 *   symbol: 'BTC/USDT',
 *   timeframe: '1h',
 *   startDate: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year ago
 *   endDate: Date.now(),
 *   trainRatio: 0.7,
 *   optimizeFor: 'sharpeRatio',
 *   paramRanges: {
 *     fastPeriod: { min: 5, max: 20, step: 5 },
 *     slowPeriod: { min: 20, max: 50, step: 10 }
 *   }
 * });
 *
 * console.log(`OOS Degradation: ${result.oosDegrade.toFixed(2)}%`);
 * console.log(`Robust: ${result.isRobust}`);
 * ```
 */
export async function runWalkForwardTest(
  config: WalkForwardConfig
): Promise<WalkForwardResult> {
  const {
    strategyName,
    symbol,
    timeframe,
    startDate,
    endDate,
    trainRatio,
    paramRanges,
    optimizeFor,
    exchange = 'binance',
    initialCapital = 10000,
    maxCombinations = 500,
    minTrades = 10,
    oosThreshold = 30,
    minTestSharpe = 0.5,
  } = config;

  // Validate configuration
  if (trainRatio <= 0 || trainRatio >= 1) {
    throw new Error('trainRatio must be between 0 and 1');
  }

  if (startDate >= endDate) {
    throw new Error('startDate must be before endDate');
  }

  console.log('\n=== Walk-Forward Testing ===');
  console.log(`Strategy: ${strategyName}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Period: ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
  console.log(`Train Ratio: ${(trainRatio * 100).toFixed(0)}%`);

  // Calculate split point
  const totalDuration = endDate - startDate;
  const trainDuration = Math.floor(totalDuration * trainRatio);
  const trainEndDate = startDate + trainDuration;

  console.log(`\nTrain Period: ${new Date(startDate).toISOString()} to ${new Date(trainEndDate).toISOString()}`);
  console.log(`Test Period: ${new Date(trainEndDate).toISOString()} to ${new Date(endDate).toISOString()}`);

  // Step 1: Optimize on training period
  console.log('\n--- Phase 1: Training (Optimization) ---');

  // Map metric names to optimizer format
  const optimizeMetric = mapMetricToOptimizer(optimizeFor);

  const optimizationConfig: OptimizationConfig = {
    strategyName,
    symbol,
    timeframe,
    startDate,
    endDate: trainEndDate,
    initialCapital,
    exchange,
    paramRanges,
    optimizeFor: optimizeMetric,
    maxCombinations,
    minTrades,
    symbolB: config.symbolB,
    leverage: config.leverage,
  };

  const optimizationResult = await runOptimization(optimizationConfig);

  console.log(`\nOptimization complete!`);
  console.log(`Best params:`, optimizationResult.bestParams);
  console.log(`Train Sharpe: ${optimizationResult.bestMetrics.sharpeRatio.toFixed(4)}`);
  console.log(`Train Return: ${optimizationResult.bestMetrics.totalReturnPercent.toFixed(2)}%`);

  // Step 2: Validate on test period
  console.log('\n--- Phase 2: Testing (Out-of-Sample Validation) ---');

  const engineConfig: EngineConfig = {
    saveResults: false,
    enableLogging: false,
  };

  let testResult;

  if (config.symbolB) {
    // Pairs strategy - use pairs backtest for test period
    const pairsConfig: PairsBacktestConfig = {
      id: uuidv4(),
      strategyName,
      params: optimizationResult.bestParams,
      symbolA: symbol,
      symbolB: config.symbolB,
      timeframe,
      startDate: trainEndDate,
      endDate,
      initialCapital,
      exchange,
      leverage: config.leverage ?? 1,
    };
    testResult = await runPairsBacktest(pairsConfig, engineConfig);
  } else {
    // Single symbol strategy - use regular backtest
    testResult = await runBacktest(
      {
        id: uuidv4(),
        strategyName,
        params: optimizationResult.bestParams,
        symbol,
        timeframe,
        startDate: trainEndDate,
        endDate,
        initialCapital,
        exchange,
      },
      engineConfig
    );
  }

  console.log(`\nTest complete!`);
  console.log(`Test Sharpe: ${testResult.metrics.sharpeRatio.toFixed(4)}`);
  console.log(`Test Return: ${testResult.metrics.totalReturnPercent.toFixed(2)}%`);
  console.log(`Test Trades: ${testResult.metrics.totalTrades}`);

  // Step 3: Calculate OOS degradation
  const trainSharpe = optimizationResult.bestMetrics.sharpeRatio;
  const testSharpe = testResult.metrics.sharpeRatio;

  // Calculate degradation (positive = worse performance on test)
  const oosDegrade = trainSharpe !== 0
    ? ((trainSharpe - testSharpe) / Math.abs(trainSharpe)) * 100
    : 0;

  // Step 4: Assess robustness
  // Strategy is robust if:
  // 1. OOS degradation is within acceptable threshold
  // 2. Test Sharpe is above minimum threshold (strategy still profitable)
  const isRobust = oosDegrade < oosThreshold && testSharpe > minTestSharpe;

  console.log('\n--- Results Summary ---');
  console.log(`OOS Degradation: ${oosDegrade.toFixed(2)}%`);
  console.log(`Robustness: ${isRobust ? 'PASS' : 'FAIL'}`);

  if (!isRobust) {
    if (oosDegrade >= oosThreshold) {
      console.log(`  ⚠ High degradation (>${oosThreshold}%) - possible overfitting`);
    }
    if (testSharpe <= minTestSharpe) {
      console.log(`  ⚠ Low test Sharpe (<${minTestSharpe}) - poor generalization`);
    }
  }

  return {
    trainPeriod: {
      start: startDate,
      end: trainEndDate,
    },
    trainMetrics: optimizationResult.bestMetrics,
    optimizedParams: optimizationResult.bestParams,
    testPeriod: {
      start: trainEndDate,
      end: endDate,
    },
    testMetrics: testResult.metrics,
    oosDegrade,
    isRobust,
    optimizationResult,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Map user-facing metric names to optimizer format
 */
function mapMetricToOptimizer(metric: OptimizeMetric): OptimizationConfig['optimizeFor'] {
  const metricMap: Record<OptimizeMetric, OptimizationConfig['optimizeFor']> = {
    sharpeRatio: 'sharpeRatio',
    totalReturn: 'totalReturnPercent',
    profitFactor: 'profitFactor',
    sortino: 'sharpeRatio', // Use Sharpe as proxy (Sortino uses similar logic)
    calmar: 'sharpeRatio', // Use Sharpe as proxy (Calmar is return/drawdown)
  };

  const mapped = metricMap[metric];
  if (!mapped) {
    console.warn(`Unknown metric ${metric}, defaulting to sharpeRatio`);
    return 'sharpeRatio';
  }

  return mapped;
}

/**
 * Format time duration for display
 */
export function formatDuration(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h`;
}
