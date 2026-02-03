#!/usr/bin/env node
/**
 * CLI tool for running backtests
 * Usage: npx tsx src/cli/quant-backtest.ts --strategy=NAME --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 [options]
 *
 * Options:
 *   --strategy=NAME       Strategy name (required)
 *   --symbol=SYMBOL       Trading pair (required)
 *   --from=DATE           Start date YYYY-MM-DD (required)
 *   --to=DATE             End date YYYY-MM-DD (required)
 *   --timeframe=TF        Candle timeframe (default: 4h)
 *   --capital=AMOUNT      Initial capital (default: 10000)
 *   --param.KEY=VALUE     Strategy parameter override
 *
 * Outputs JSON to stdout:
 * - Success: {"success":true,"metrics":{...},"tradeCount":42}
 * - Failure: {"success":false,"error":"..."}
 *
 * All logging goes to stderr
 */

import { runBacktest, createBacktestConfig } from '../core/engine.js';
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
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
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

  // Parse strategy parameters
  const strategyParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key.startsWith('param.')) {
      const paramName = key.slice(6);
      // Try to parse as number, boolean, or keep as string
      if (value === 'true') {
        strategyParams[paramName] = true;
      } else if (value === 'false') {
        strategyParams[paramName] = false;
      } else if (!isNaN(Number(value))) {
        strategyParams[paramName] = Number(value);
      } else {
        strategyParams[paramName] = value;
      }
    }
  }

  // Create backtest configuration
  const config = createBacktestConfig({
    strategyName: args.strategy,
    symbol: args.symbol,
    timeframe: (args.timeframe || '4h') as Timeframe,
    startDate,
    endDate,
    initialCapital: args.capital ? Number(args.capital) : 10000,
    exchange: args.exchange || 'binance',
    params: strategyParams,
  });

  console.error(`Running backtest: ${config.strategyName} on ${config.symbol}`);

  try {
    // Run the backtest (with saveResults: false)
    const result = await runBacktest(config, {
      enableLogging: false,
      saveResults: false,
    });

    // Output JSON result to stdout
    process.stdout.write(JSON.stringify({
      success: true,
      metrics: result.metrics,
      tradeCount: result.trades.length,
    }));

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Backtest failed: ${message}`);
    process.stdout.write(JSON.stringify({
      success: false,
      error: message
    }));
    process.exit(1);
  } finally {
    closeDb();
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
