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
import type { Timeframe, PerformanceMetrics, Trade, EquityPoint, RollingMetrics } from './types.js';
import { runOptimization, type OptimizationConfig, type OptimizationResult } from './optimizer.js';
import { runBacktest, type EngineConfig } from './engine.js';
import { loadStrategy, clearStrategyCache } from '../strategy/loader.js';
import { getCandles } from '../data/db.js';

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
   * Trading mode: 'spot' or 'futures' (default: 'spot')
   */
  mode?: 'spot' | 'futures';

  /**
   * Coarser timeframe for the optimization (train) phase only, for speed
   * The test (out-of-sample) phase always uses the original timeframe for accuracy
   * E.g., set to '5m' when timeframe is '1m' to reduce bar count by 5x during grid search
   */
  optimizeTimeframe?: Timeframe;
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

  /** Full trades from test period backtest (optional, for persistence) */
  testTrades?: Trade[];
  /** Full equity curve from test period (optional, for persistence) */
  testEquity?: EquityPoint[];
  /** Rolling metrics from test period (optional, for persistence) */
  testRollingMetrics?: RollingMetrics;
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
    mode,
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

  // Load BTC daily candles for V3 regime filter (if the strategy name indicates V3)
  async function loadBtcDailyCandlesIfNeeded(): Promise<Array<{ timestamp: number; close: number }>> {
    if (!strategyName.includes('v3') && !strategyName.includes('V3')) {
      return [];
    }

    const candidates: Array<[string, string]> = [
      ['binance', 'BTC/USDT:USDT'],
      ['binance', 'BTC/USDT'],
      ['bybit', 'BTC/USDT:USDT'],
      ['bybit', 'BTC/USDT'],
    ];

    for (const [ex, sym] of candidates) {
      const candles = await getCandles(ex, sym, '1d' as Timeframe, startDate - 300 * 86400000, endDate);
      if (candles.length >= 200) {
        return candles.map(c => ({ timestamp: c.timestamp, close: c.close }));
      }
    }

    // V3 regime filter is the whole point of V3 — throw instead of silently continuing
    throw new Error(
      `Could not load BTC daily candles required for V3 regime filter in strategy "${strategyName}". ` +
      `Cache BTC/USDT daily candles first using: ` +
      `npx tsx scripts/cache-candles.ts --exchange=binance --symbols=BTC/USDT --timeframes=1d --from=YYYY-MM-DD --to=YYYY-MM-DD`,
    );
  }

  const btcCandles = await loadBtcDailyCandlesIfNeeded();

  // For V3 strategies: inject BTC candles into the cached strategy instance before optimization.
  // loadStrategy() uses a cache, so the optimizer (which calls loadStrategy internally) will
  // get the same instance with _btcDailyCandles already set.
  if (btcCandles.length > 0) {
    clearStrategyCache();
    const strategyInstance = await loadStrategy(strategyName);
    (strategyInstance as any)._btcDailyCandles = btcCandles;
    console.log(`Injected ${btcCandles.length} BTC daily candles into strategy for regime filter`);
  }

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
    mode,
    optimizeTimeframe: config.optimizeTimeframe, // Coarser TF for speed (test phase uses original TF)
  };

  const optimizationResult = await runOptimization(optimizationConfig);

  console.log(`\nOptimization complete!`);
  console.log(`Best params:`, optimizationResult.bestParams);
  console.log(`Train Sharpe: ${optimizationResult.bestMetrics.sharpeRatio.toFixed(4)}`);
  console.log(`Train Return: ${optimizationResult.bestMetrics.totalReturnPercent.toFixed(2)}%`);

  // Step 2: Validate on test period
  console.log('\n--- Phase 2: Testing (Out-of-Sample Validation) ---');

  // For V3 strategies: inject BTC candles into a fresh strategy instance for the test phase.
  // The optimizer may have mutated the cached instance's internal state across runs, so we
  // clear the cache and load a clean instance with BTC candles re-injected.
  let testPreloadedStrategy: Awaited<ReturnType<typeof loadStrategy>> | undefined;
  if (btcCandles.length > 0) {
    clearStrategyCache();
    testPreloadedStrategy = await loadStrategy(strategyName);
    (testPreloadedStrategy as any)._btcDailyCandles = btcCandles;
  }

  const engineConfig: EngineConfig = {
    saveResults: false,
    enableLogging: false,
    ...(testPreloadedStrategy ? { preloadedStrategy: testPreloadedStrategy } : {}),
  };

  const testResult = await runBacktest(
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
      mode,
    },
    engineConfig
  );

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
    testTrades: testResult.trades,
    testEquity: testResult.equity,
    testRollingMetrics: testResult.rollingMetrics,
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
