/**
 * Optimizer-Backtest Consistency Tests
 *
 * These tests verify that the optimizer produces results that match
 * regular backtest results when using the same parameters.
 *
 * Bug: Optimizer runs backtests with slippagePercent: undefined (defaults to 0)
 * while regular backtest uses DEFAULT_ENGINE_CONFIG with slippagePercent: 0.05
 */

import { describe, it, expect } from 'vitest';
import { runBacktest, type EngineConfig } from '../engine.js';
import { runOptimization, type OptimizationConfig } from '../optimizer.js';
import type { BacktestConfig } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

// Test configuration constants
const TEST_CONFIG = {
  strategyName: 'sma-crossover',
  symbol: 'BTC/USDT',
  timeframe: '1h' as const,
  startDate: new Date('2024-01-01').getTime(),
  endDate: new Date('2024-01-31').getTime(),
  initialCapital: 10000,
  exchange: 'binance',
};

// Test parameters for the strategy
const TEST_PARAMS = {
  fastPeriod: 10,
  slowPeriod: 20,
  enableShorts: false,
};

// Floating point tolerance for comparisons (0.001%)
const TOLERANCE = 0.00001;

/**
 * Helper to compare two numbers with tolerance
 */
function expectCloseTo(actual: number, expected: number, tolerance = TOLERANCE): void {
  const diff = Math.abs(actual - expected);
  const relativeError = expected !== 0 ? diff / Math.abs(expected) : diff;

  expect(relativeError).toBeLessThanOrEqual(tolerance);
}

describe('Optimizer-Backtest Consistency', () => {
  describe('Basic Consistency', () => {
    it('should produce same results when optimizer and backtest use same config', async () => {
      // Run a single-point optimization (no grid search)
      const optimizationConfig: OptimizationConfig = {
        ...TEST_CONFIG,
        paramRanges: {
          fastPeriod: { min: 10, max: 10, step: 1 },
          slowPeriod: { min: 20, max: 20, step: 1 },
        },
        optimizeFor: 'totalReturnPercent',
        maxCombinations: 1,
        minTrades: 0, // Allow even if few trades
      };

      const optimizationResult = await runOptimization(optimizationConfig);

      // Run regular backtest with same parameters
      const backtestConfig: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: TEST_PARAMS,
      };

      // Use same engine config as optimizer (no slippage override)
      const engineConfig: EngineConfig = {
        saveResults: false,
        enableLogging: false,
      };

      const backtestResult = await runBacktest(backtestConfig, engineConfig);

      // Compare key metrics
      console.log('Optimizer metrics:', {
        finalEquity: optimizationResult.bestMetrics.totalReturn + TEST_CONFIG.initialCapital,
        totalReturn: optimizationResult.bestMetrics.totalReturn,
        totalReturnPercent: optimizationResult.bestMetrics.totalReturnPercent,
        trades: optimizationResult.bestMetrics.totalTrades,
      });

      console.log('Backtest metrics:', {
        finalEquity: backtestResult.metrics.totalReturn + TEST_CONFIG.initialCapital,
        totalReturn: backtestResult.metrics.totalReturn,
        totalReturnPercent: backtestResult.metrics.totalReturnPercent,
        trades: backtestResult.metrics.totalTrades,
      });

      // Test that results match
      expect(backtestResult.metrics.totalTrades).toBe(optimizationResult.bestMetrics.totalTrades);
      expectCloseTo(
        backtestResult.metrics.totalReturnPercent,
        optimizationResult.bestMetrics.totalReturnPercent
      );
      expectCloseTo(
        backtestResult.metrics.totalReturn,
        optimizationResult.bestMetrics.totalReturn
      );
    }, 120000); // 2 minute timeout

    it('should produce same results with explicit default engine config', async () => {
      // Run optimizer with explicit default engine config
      const optimizationConfig: OptimizationConfig = {
        ...TEST_CONFIG,
        paramRanges: {
          fastPeriod: { min: 10, max: 10, step: 1 },
          slowPeriod: { min: 20, max: 20, step: 1 },
        },
        optimizeFor: 'totalReturnPercent',
        maxCombinations: 1,
        minTrades: 0,
      };

      const optimizationResult = await runOptimization(optimizationConfig);

      // Run backtest with explicit DEFAULT_ENGINE_CONFIG values
      const backtestConfig: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: TEST_PARAMS,
      };

      // Explicitly pass default values (matching the fixed DEFAULT_ENGINE_CONFIG)
      const engineConfig: EngineConfig = {
        broker: {
          slippagePercent: 0, // Fixed: matches DEFAULT_ENGINE_CONFIG and optimizer
          commissionPercent: 0,
          feeRate: 0, // Will be fetched
        },
        saveResults: false,
        enableLogging: false,
      };

      const backtestResult = await runBacktest(backtestConfig, engineConfig);

      console.log('Optimizer metrics (with defaults):', {
        totalReturnPercent: optimizationResult.bestMetrics.totalReturnPercent,
        trades: optimizationResult.bestMetrics.totalTrades,
      });

      console.log('Backtest metrics (with defaults):', {
        totalReturnPercent: backtestResult.metrics.totalReturnPercent,
        trades: backtestResult.metrics.totalTrades,
      });

      // After the fix: both optimizer and backtest should use slippagePercent: 0
      // Results should now be identical
      expect(backtestResult.metrics.totalTrades).toBe(optimizationResult.bestMetrics.totalTrades);
      expectCloseTo(
        backtestResult.metrics.totalReturnPercent,
        optimizationResult.bestMetrics.totalReturnPercent
      );
    }, 120000);
  });

  describe('Fee Handling Consistency', () => {
    it('should produce same results with cached fee rates', async () => {
      // Test that skipFeeFetch and pre-set fee rates work consistently
      const feeRate = 0.001; // 0.1% taker fee

      // Run optimizer (which sets skipFeeFetch: true and pre-fetches fees)
      const optimizationConfig: OptimizationConfig = {
        ...TEST_CONFIG,
        paramRanges: {
          fastPeriod: { min: 15, max: 15, step: 1 },
          slowPeriod: { min: 30, max: 30, step: 1 },
        },
        optimizeFor: 'sharpeRatio',
        maxCombinations: 1,
        minTrades: 0,
      };

      const optimizationResult = await runOptimization(optimizationConfig);

      // Run backtest with same fee rate and skipFeeFetch
      const backtestConfig: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: {
          fastPeriod: 15,
          slowPeriod: 30,
          enableShorts: false,
        },
      };

      const engineConfig: EngineConfig = {
        broker: {
          feeRate,
        },
        skipFeeFetch: true, // Use provided fee rate, don't fetch
        saveResults: false,
        enableLogging: false,
      };

      const backtestResult = await runBacktest(backtestConfig, engineConfig);

      // Verify fees are calculated consistently
      console.log('Optimizer total fees:', optimizationResult.bestMetrics.totalFees);
      console.log('Backtest total fees:', backtestResult.metrics.totalFees);

      expectCloseTo(
        backtestResult.metrics.totalFees,
        optimizationResult.bestMetrics.totalFees
      );

      expectCloseTo(
        backtestResult.metrics.totalReturnPercent,
        optimizationResult.bestMetrics.totalReturnPercent
      );
    }, 120000);
  });

  describe('Multiple Parameter Sets', () => {
    it('should produce consistent results across different parameter combinations', async () => {
      // Run optimizer with multiple parameter combinations
      const optimizationConfig: OptimizationConfig = {
        ...TEST_CONFIG,
        paramRanges: {
          fastPeriod: { min: 8, max: 12, step: 2 }, // 8, 10, 12
          slowPeriod: { min: 20, max: 24, step: 2 }, // 20, 22, 24
        },
        optimizeFor: 'totalReturnPercent',
        maxCombinations: 9, // 3x3 = 9 combinations
        minTrades: 0,
      };

      const optimizationResult = await runOptimization(optimizationConfig);

      // Run backtest with the best parameters found by optimizer
      const backtestConfig: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: optimizationResult.bestParams,
      };

      const engineConfig: EngineConfig = {
        saveResults: false,
        enableLogging: false,
      };

      const backtestResult = await runBacktest(backtestConfig, engineConfig);

      console.log('Best params from optimizer:', optimizationResult.bestParams);
      console.log('Optimizer best return:', optimizationResult.bestMetrics.totalReturnPercent);
      console.log('Backtest return with best params:', backtestResult.metrics.totalReturnPercent);

      // Results should match
      expect(backtestResult.metrics.totalTrades).toBe(optimizationResult.bestMetrics.totalTrades);
      expectCloseTo(
        backtestResult.metrics.totalReturnPercent,
        optimizationResult.bestMetrics.totalReturnPercent
      );
    }, 180000); // 3 minute timeout for multiple runs
  });

  describe('Slippage Configuration Bug', () => {
    it('should expose the slippage configuration mismatch', async () => {
      // This test explicitly demonstrates the bug

      // Run optimizer (which doesn't pass slippagePercent to engine config)
      const optimizationConfig: OptimizationConfig = {
        ...TEST_CONFIG,
        paramRanges: {
          fastPeriod: { min: 10, max: 10, step: 1 },
          slowPeriod: { min: 20, max: 20, step: 1 },
        },
        optimizeFor: 'totalReturnPercent',
        maxCombinations: 1,
        minTrades: 0,
      };

      const optimizationResult = await runOptimization(optimizationConfig);

      // Run backtest WITHOUT explicit engine config (uses DEFAULT_ENGINE_CONFIG)
      const backtestConfigDefault: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: TEST_PARAMS,
      };

      const backtestResultDefault = await runBacktest(backtestConfigDefault);

      // Run backtest WITH zero slippage (like optimizer)
      const backtestConfigZeroSlippage: BacktestConfig = {
        id: uuidv4(),
        ...TEST_CONFIG,
        params: TEST_PARAMS,
      };

      const engineConfigZeroSlippage: EngineConfig = {
        broker: {
          slippagePercent: 0, // No slippage like optimizer
        },
        saveResults: false,
        enableLogging: false,
      };

      const backtestResultZeroSlippage = await runBacktest(
        backtestConfigZeroSlippage,
        engineConfigZeroSlippage
      );

      console.log('Optimizer result (implicit 0 slippage):', {
        totalReturnPercent: optimizationResult.bestMetrics.totalReturnPercent,
        totalReturn: optimizationResult.bestMetrics.totalReturn,
      });

      console.log('Backtest with DEFAULT config (0.05% slippage):', {
        totalReturnPercent: backtestResultDefault.metrics.totalReturnPercent,
        totalReturn: backtestResultDefault.metrics.totalReturn,
      });

      console.log('Backtest with explicit 0 slippage:', {
        totalReturnPercent: backtestResultZeroSlippage.metrics.totalReturnPercent,
        totalReturn: backtestResultZeroSlippage.metrics.totalReturn,
      });

      // Optimizer should match zero-slippage backtest
      expectCloseTo(
        optimizationResult.bestMetrics.totalReturnPercent,
        backtestResultZeroSlippage.metrics.totalReturnPercent
      );

      // But optimizer will NOT match default backtest (this demonstrates the bug)
      // This assertion should FAIL, proving the inconsistency
      expectCloseTo(
        optimizationResult.bestMetrics.totalReturnPercent,
        backtestResultDefault.metrics.totalReturnPercent
      );
    }, 180000);
  });

  describe('Different Timeframes', () => {
    it('should produce consistent results on different timeframes', async () => {
      const timeframes = ['1h', '4h'] as const;

      for (const timeframe of timeframes) {
        const optimizationConfig: OptimizationConfig = {
          ...TEST_CONFIG,
          timeframe,
          paramRanges: {
            fastPeriod: { min: 10, max: 10, step: 1 },
            slowPeriod: { min: 20, max: 20, step: 1 },
          },
          optimizeFor: 'totalReturnPercent',
          maxCombinations: 1,
          minTrades: 0,
        };

        const optimizationResult = await runOptimization(optimizationConfig);

        const backtestConfig: BacktestConfig = {
          id: uuidv4(),
          ...TEST_CONFIG,
          timeframe,
          params: TEST_PARAMS,
        };

        const engineConfig: EngineConfig = {
          saveResults: false,
          enableLogging: false,
        };

        const backtestResult = await runBacktest(backtestConfig, engineConfig);

        console.log(`${timeframe} - Optimizer:`, optimizationResult.bestMetrics.totalReturnPercent);
        console.log(`${timeframe} - Backtest:`, backtestResult.metrics.totalReturnPercent);

        expectCloseTo(
          backtestResult.metrics.totalReturnPercent,
          optimizationResult.bestMetrics.totalReturnPercent
        );
      }
    }, 240000); // 4 minute timeout
  });
});
