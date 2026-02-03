/**
 * Multi-Asset Validation Module
 *
 * Tests optimized strategy parameters across multiple assets to detect
 * overfitting and assess generalizability. A truly robust strategy should
 * perform well across different market conditions and asset characteristics.
 *
 * Method:
 * 1. Run backtest with fixed parameters on multiple symbols
 * 2. Calculate performance metrics for each symbol
 * 3. Determine pass/fail for each symbol (profitability + positive Sharpe)
 * 4. Aggregate results to assess overall generalizability
 *
 * Use Case:
 * - After optimizing parameters on BTC/USDT, test on ETH/USDT, SOL/USDT, etc.
 * - If params work well across 50%+ of assets, strategy is generalizable
 * - If params only work on the optimization asset, likely overfitted
 */

import { v4 as uuidv4 } from 'uuid';
import type { Timeframe, PerformanceMetrics } from './types.js';
import { runBacktest, type EngineConfig } from './engine.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for multi-asset validation
 */
export interface MultiAssetConfig {
  /**
   * Strategy name to test
   */
  strategyName: string;

  /**
   * Fixed strategy parameters (typically from optimization)
   */
  params: Record<string, unknown>;

  /**
   * Array of trading symbols to test
   * e.g., ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT']
   */
  symbols: string[];

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
   * Exchange name (default: 'binance')
   */
  exchange?: string;

  /**
   * Initial capital for each backtest (default: 10000)
   */
  initialCapital?: number;

  /**
   * Minimum percentage of symbols that must pass (default: 50%)
   */
  passThreshold?: number;

  /**
   * Whether to run backtests in parallel (default: true)
   * Set to false if rate-limited or low memory
   */
  parallel?: boolean;
}

/**
 * Result for a single symbol
 */
export interface SymbolResult {
  /**
   * Trading symbol
   */
  symbol: string;

  /**
   * Performance metrics for this symbol
   */
  metrics: PerformanceMetrics;

  /**
   * Whether this symbol passed validation
   * Pass criteria: totalReturn > 0 AND sharpeRatio > 0
   */
  passed: boolean;

  /**
   * Error message if backtest failed
   */
  error?: string;
}

/**
 * Aggregated result across all symbols
 */
export interface MultiAssetResult {
  /**
   * Results for each symbol
   */
  symbolResults: SymbolResult[];

  /**
   * Average Sharpe ratio across all symbols
   */
  avgSharpeRatio: number;

  /**
   * Number of symbols that passed validation
   */
  symbolsPassed: number;

  /**
   * Total number of symbols tested
   */
  totalSymbols: number;

  /**
   * Whether the strategy is considered generalizable
   * Criteria: symbolsPassed >= totalSymbols * passThreshold
   */
  isGeneralizable: boolean;

  /**
   * Pass rate as percentage
   */
  passRate: number;

  /**
   * Average total return across all symbols (percentage)
   */
  avgTotalReturn: number;

  /**
   * Average profit factor across all symbols
   */
  avgProfitFactor: number;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Run multi-asset validation test
 *
 * @param config - Multi-asset validation configuration
 * @returns Validation results with generalizability assessment
 *
 * @example
 * ```typescript
 * const result = await runMultiAssetValidation({
 *   strategyName: 'sma-cross',
 *   params: { fastPeriod: 10, slowPeriod: 30 },
 *   symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'],
 *   timeframe: '1h',
 *   startDate: Date.now() - 180 * 24 * 60 * 60 * 1000, // 6 months ago
 *   endDate: Date.now(),
 * });
 *
 * console.log(`Pass Rate: ${result.passRate.toFixed(1)}%`);
 * console.log(`Generalizable: ${result.isGeneralizable}`);
 * ```
 */
export async function runMultiAssetValidation(
  config: MultiAssetConfig
): Promise<MultiAssetResult> {
  const {
    strategyName,
    params,
    symbols,
    timeframe,
    startDate,
    endDate,
    exchange = 'binance',
    initialCapital = 10000,
    passThreshold = 0.5,
    parallel = true,
  } = config;

  // Validate configuration
  if (symbols.length === 0) {
    throw new Error('Must provide at least one symbol to test');
  }

  if (startDate >= endDate) {
    throw new Error('startDate must be before endDate');
  }

  if (passThreshold < 0 || passThreshold > 1) {
    throw new Error('passThreshold must be between 0 and 1');
  }

  console.log('\n=== Multi-Asset Validation ===');
  console.log(`Strategy: ${strategyName}`);
  console.log(`Parameters:`, params);
  console.log(`Symbols: ${symbols.join(', ')}`);
  console.log(`Period: ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`);
  console.log(`Pass Threshold: ${(passThreshold * 100).toFixed(0)}%`);
  console.log(`\nTesting ${symbols.length} symbols...`);

  // Engine config: no saving, minimal logging
  const engineConfig: EngineConfig = {
    saveResults: false,
    enableLogging: false,
  };

  // Run backtests for each symbol
  const symbolResults: SymbolResult[] = [];

  if (parallel) {
    // Parallel execution for speed
    console.log('Running backtests in parallel...');

    const backtestPromises = symbols.map(async (symbol) => {
      return runSymbolBacktest(
        symbol,
        strategyName,
        params,
        timeframe,
        startDate,
        endDate,
        initialCapital,
        exchange,
        engineConfig
      );
    });

    const results = await Promise.all(backtestPromises);
    symbolResults.push(...results);
  } else {
    // Sequential execution (rate-limit friendly)
    console.log('Running backtests sequentially...');

    for (const symbol of symbols) {
      const result = await runSymbolBacktest(
        symbol,
        strategyName,
        params,
        timeframe,
        startDate,
        endDate,
        initialCapital,
        exchange,
        engineConfig
      );
      symbolResults.push(result);

      // Brief delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Aggregate results
  console.log('\n--- Symbol Results ---');

  let totalSharpe = 0;
  let totalReturn = 0;
  let totalProfitFactor = 0;
  let symbolsPassed = 0;

  for (const result of symbolResults) {
    if (result.error) {
      console.log(`${result.symbol}: ERROR - ${result.error}`);
      continue;
    }

    const { metrics, passed } = result;
    totalSharpe += metrics.sharpeRatio;
    totalReturn += metrics.totalReturnPercent;
    totalProfitFactor += metrics.profitFactor;

    if (passed) {
      symbolsPassed++;
      console.log(
        `${result.symbol}: PASS - Return: ${metrics.totalReturnPercent.toFixed(2)}%, ` +
        `Sharpe: ${metrics.sharpeRatio.toFixed(2)}, Trades: ${metrics.totalTrades}`
      );
    } else {
      console.log(
        `${result.symbol}: FAIL - Return: ${metrics.totalReturnPercent.toFixed(2)}%, ` +
        `Sharpe: ${metrics.sharpeRatio.toFixed(2)}, Trades: ${metrics.totalTrades}`
      );
    }
  }

  // Calculate averages (excluding error results)
  const validResults = symbolResults.filter(r => !r.error);
  const validCount = validResults.length;

  const avgSharpeRatio = validCount > 0 ? totalSharpe / validCount : 0;
  const avgTotalReturn = validCount > 0 ? totalReturn / validCount : 0;
  const avgProfitFactor = validCount > 0 ? totalProfitFactor / validCount : 0;

  // Assess generalizability
  const passRate = validCount > 0 ? (symbolsPassed / validCount) * 100 : 0;
  const isGeneralizable = symbolsPassed >= validCount * passThreshold;

  console.log('\n--- Aggregate Results ---');
  console.log(`Symbols Tested: ${validCount}`);
  console.log(`Symbols Passed: ${symbolsPassed}`);
  console.log(`Pass Rate: ${passRate.toFixed(1)}%`);
  console.log(`Avg Sharpe Ratio: ${avgSharpeRatio.toFixed(3)}`);
  console.log(`Avg Total Return: ${avgTotalReturn.toFixed(2)}%`);
  console.log(`Avg Profit Factor: ${avgProfitFactor.toFixed(2)}`);
  console.log(`Generalizability: ${isGeneralizable ? 'PASS' : 'FAIL'}`);

  if (!isGeneralizable) {
    console.log(`  ⚠ Pass rate ${passRate.toFixed(1)}% below threshold ${(passThreshold * 100).toFixed(0)}%`);
    console.log(`  ⚠ Parameters may be overfitted to specific asset`);
  }

  return {
    symbolResults,
    avgSharpeRatio,
    symbolsPassed,
    totalSymbols: validCount,
    isGeneralizable,
    passRate,
    avgTotalReturn,
    avgProfitFactor,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Run backtest for a single symbol and determine pass/fail
 */
async function runSymbolBacktest(
  symbol: string,
  strategyName: string,
  params: Record<string, unknown>,
  timeframe: Timeframe,
  startDate: number,
  endDate: number,
  initialCapital: number,
  exchange: string,
  engineConfig: EngineConfig
): Promise<SymbolResult> {
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

    const { metrics } = result;

    // Pass criteria: profitable AND positive risk-adjusted returns
    const passed = metrics.totalReturnPercent > 0 && metrics.sharpeRatio > 0;

    return {
      symbol,
      metrics,
      passed,
    };
  } catch (error) {
    // Handle backtest errors gracefully
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`Failed to backtest ${symbol}: ${errorMessage}`);

    // Return empty metrics with error flag
    return {
      symbol,
      metrics: {
        totalReturn: 0,
        totalReturnPercent: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgWin: 0,
        avgLoss: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        expectancy: 0,
        expectancyPercent: 0,
        largestWin: 0,
        largestLoss: 0,
        avgTradeDuration: 0,
        exposureTime: 0,
        totalFees: 0,
      },
      passed: false,
      error: errorMessage,
    };
  }
}

/**
 * Get common crypto pairs for testing
 */
export function getCommonCryptoPairs(): string[] {
  return [
    'BTC/USDT',
    'ETH/USDT',
    'BNB/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'ADA/USDT',
    'AVAX/USDT',
    'DOT/USDT',
    'MATIC/USDT',
    'LINK/USDT',
  ];
}

/**
 * Get top N symbols by market cap
 */
export function getTopSymbols(count: number): string[] {
  const common = getCommonCryptoPairs();
  return common.slice(0, Math.min(count, common.length));
}
