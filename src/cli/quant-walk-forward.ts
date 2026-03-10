#!/usr/bin/env node
/**
 * CLI tool for walk-forward testing
 * Usage: npx tsx src/cli/quant-walk-forward.ts --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 [options]
 *
 * Options:
 *   --strategy=NAME         Strategy name (required)
 *   --symbol=SYMBOL         Trading pair (required)
 *   --from=DATE             Start date YYYY-MM-DD (required)
 *   --to=DATE               End date YYYY-MM-DD (required)
 *   --timeframe=TF          Candle timeframe (default: 4h)
 *   --train-ratio=RATIO     Train/test split ratio (default: 0.7)
 *   --optimize-for=METRIC   Metric to optimize (default: sharpeRatio)
 *   --optimize-timeframe=TF Coarser timeframe for optimization phase (test uses original TF)
 *
 * Outputs JSON to stdout:
 * - Success: {"success":true,"trainMetrics":{...},"testMetrics":{...},"optimizedParams":{...},"oosDegrade":15.2}
 * - Failure: {"success":false,"error":"..."}
 *
 * All logging goes to stderr
 */

import { runWalkForwardTest, type WalkForwardConfig, type OptimizeMetric } from '../core/walk-forward.js';
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

  // Parse train ratio
  const trainRatio = args['train-ratio'] ? parseFloat(args['train-ratio']) : 0.7;
  if (trainRatio <= 0 || trainRatio >= 1) {
    console.error('Error: train-ratio must be between 0 and 1');
    process.stdout.write(JSON.stringify({
      success: false,
      error: 'train-ratio must be between 0 and 1'
    }));
    process.exit(1);
  }

  // Parse optimize-for metric
  const optimizeFor = (args['optimize-for'] || 'sharpeRatio') as OptimizeMetric;
  const validMetrics: OptimizeMetric[] = ['sharpeRatio', 'totalReturn', 'profitFactor', 'sortino', 'calmar'];
  if (!validMetrics.includes(optimizeFor)) {
    console.error(`Error: Invalid optimize-for metric. Valid options: ${validMetrics.join(', ')}`);
    process.stdout.write(JSON.stringify({
      success: false,
      error: `Invalid optimize-for metric. Valid options: ${validMetrics.join(', ')}`
    }));
    process.exit(1);
  }

  const optimizeTimeframe = args['optimize-timeframe'] as Timeframe | undefined;

  // Create walk-forward configuration
  const config: WalkForwardConfig = {
    strategyName: args.strategy,
    symbol: args.symbol,
    timeframe: (args.timeframe || '4h') as Timeframe,
    startDate,
    endDate,
    trainRatio,
    optimizeFor,
    exchange: args.exchange || 'binance',
    initialCapital: args.capital ? Number(args.capital) : 10000,
    mode: args.mode === 'futures' ? 'futures' : undefined,
    optimizeTimeframe,
  };

  console.error(`Running walk-forward test: ${config.strategyName} on ${config.symbol}`);

  try {
    // Run walk-forward test
    const result = await runWalkForwardTest(config);

    // Output JSON result to stdout
    process.stdout.write(JSON.stringify({
      success: true,
      trainMetrics: result.trainMetrics,
      testMetrics: result.testMetrics,
      optimizedParams: result.optimizedParams,
      oosDegrade: result.oosDegrade,
      isRobust: result.isRobust,
    }));

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Walk-forward test failed: ${message}`);
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
