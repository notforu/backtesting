#!/usr/bin/env node
/**
 * CLI tool for parameter optimization
 * Usage: npx tsx src/cli/quant-optimize.ts --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 [options]
 *
 * Options:
 *   --strategy=NAME           Strategy name (required)
 *   --symbol=SYMBOL           Trading pair (required)
 *   --from=DATE               Start date YYYY-MM-DD (required)
 *   --to=DATE                 End date YYYY-MM-DD (required)
 *   --timeframe=TF            Candle timeframe (default: 4h)
 *   --optimize-for=METRIC     Metric to optimize (default: sharpeRatio)
 *   --max-combinations=NUM    Max parameter combinations (default: 500)
 *   --min-trades=NUM          Minimum trades required (default: 10)
 *   --symbol-b=SYMBOL         Second symbol for pairs trading (optional)
 *   --leverage=NUM            Leverage for pairs trading (default: 1)
 *
 * Outputs JSON to stdout:
 * - Success: {"success":true,"bestParams":{...},"bestMetrics":{...},"totalCombinations":500,"testedCombinations":423}
 * - Failure: {"success":false,"error":"..."}
 *
 * Progress output goes to stderr
 */

import { runOptimization, type OptimizationConfig } from '../core/optimizer.js';
import { closeDb } from '../data/db.js';
import type { Timeframe } from '../core/types.js';

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key && value) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Redirect console.log to stderr
 */
function redirectConsoleToStderr(): void {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  // Keep reference for potential restoration
  (console as any)._originalLog = originalLog;
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  redirectConsoleToStderr();

  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  const required = ['strategy', 'symbol', 'from', 'to'];
  const missing = required.filter((key) => !args[key]);

  if (missing.length > 0) {
    console.error(`Error: Missing required arguments: ${missing.join(', ')}`);
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Missing required arguments: ${missing.join(', ')}`
    }));
    process.exit(1);
  }

  // Parse dates
  const startDate = new Date(args.from).getTime();
  const endDate = new Date(args.to).getTime();

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD');
    process.stdout.write(JSON.stringify({
      success: false,
      error: 'Invalid date format. Use YYYY-MM-DD'
    }));
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error('Error: Start date must be before end date');
    process.stdout.write(JSON.stringify({
      success: false,
      error: 'Start date must be before end date'
    }));
    process.exit(1);
  }

  // Parse optimize-for metric
  const optimizeFor = args['optimize-for'] || 'sharpeRatio';
  const validMetrics = ['sharpeRatio', 'totalReturnPercent', 'profitFactor', 'winRate', 'composite'];
  if (!validMetrics.includes(optimizeFor)) {
    console.error(`Error: Invalid optimize-for metric. Valid options: ${validMetrics.join(', ')}`);
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Invalid optimize-for metric. Valid options: ${validMetrics.join(', ')}`
    }));
    process.exit(1);
  }

  // Parse numeric options
  const maxCombinations = args['max-combinations'] ? parseInt(args['max-combinations'], 10) : 500;
  const minTrades = args['min-trades'] ? parseInt(args['min-trades'], 10) : 10;
  const symbolB = args['symbol-b'];
  const leverage = args.leverage ? Number(args.leverage) : 1;

  // Create optimization configuration
  const config: OptimizationConfig = {
    strategyName: args.strategy,
    symbol: args.symbol,
    timeframe: (args.timeframe || '4h') as Timeframe,
    startDate,
    endDate,
    initialCapital: args.capital ? Number(args.capital) : 10000,
    exchange: args.exchange || 'binance',
    optimizeFor: optimizeFor as OptimizationConfig['optimizeFor'],
    maxCombinations,
    minTrades,
    symbolB,
    leverage,
  };

  console.error(`Running optimization: ${config.strategyName} on ${config.symbol}`);

  try {
    // Run optimization with progress callback
    const result = await runOptimization(config, (progress) => {
      // Progress to stderr
      console.error(
        `Progress: ${progress.current}/${progress.total} (${progress.percent.toFixed(1)}%)`
      );
    });

    // Output JSON result to stdout
    process.stdout.write(JSON.stringify({
      success: true,
      bestParams: result.bestParams,
      bestMetrics: result.bestMetrics,
      totalCombinations: result.totalCombinations,
      testedCombinations: result.testedCombinations,
    }));

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Optimization failed: ${message}`);
    process.stdout.write(JSON.stringify({
      success: false,
      error: message
    }));
    process.exit(1);
  } finally {
    await closeDb();
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.stdout.write(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error'
  }));
  closeDb();
  process.exit(1);
});
