/**
 * CLI entry point for running backtests
 * Usage: npm run backtest -- --strategy=<name> --symbol=<symbol> --from=<date> --to=<date>
 *
 * Examples:
 *   npm run backtest -- --strategy=sma-crossover --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01
 *   npm run backtest -- --strategy=sma-crossover --symbol=ETH/USDT --from=2024-01-01 --to=2024-03-01 --capital=5000
 */

import { runBacktest, createBacktestConfig } from '../core/engine.js';
import { listStrategies, getStrategyDetails } from '../strategy/loader.js';
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
 * Print help message
 */
function printHelp(): void {
  console.log(`
Backtest CLI - Run trading strategy backtests

Usage:
  npm run backtest -- [options]

Options:
  --strategy=<name>    Strategy name (required)
  --symbol=<symbol>    Trading pair, e.g., BTC/USDT (required)
  --from=<date>        Start date, e.g., 2024-01-01 (required)
  --to=<date>          End date, e.g., 2024-06-01 (required)
  --timeframe=<tf>     Candle timeframe (default: 1h)
                       Options: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w
  --capital=<amount>   Initial capital (default: 10000)
  --exchange=<name>    Exchange name (default: binance)
  --param.<key>=<val>  Strategy parameter override
  --list               List available strategies
  --help               Show this help message

Examples:
  npm run backtest -- --strategy=sma-crossover --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01
  npm run backtest -- --strategy=sma-crossover --symbol=ETH/USDT --from=2024-01-01 --to=2024-03-01 --capital=5000 --param.fastPeriod=5 --param.slowPeriod=15
  npm run backtest -- --list
`);
}

/**
 * Print available strategies
 */
async function printStrategies(): Promise<void> {
  console.log('\nAvailable strategies:\n');

  const strategies = await listStrategies();

  if (strategies.length === 0) {
    console.log('  No strategies found in /strategies folder');
    return;
  }

  for (const name of strategies) {
    try {
      const details = await getStrategyDetails(name);
      console.log(`  ${details.name} (v${details.version})`);
      console.log(`    ${details.description}`);
      console.log('    Parameters:');
      for (const param of details.params) {
        console.log(
          `      --param.${param.name}=<${param.type}> (default: ${param.default})`
        );
        console.log(`        ${param.description}`);
      }
      console.log();
    } catch (error) {
      console.log(`  ${name} - Error loading: ${error}`);
    }
  }
}

/**
 * Format metrics for display
 */
function formatMetrics(metrics: Record<string, number>): void {
  console.log('\n========================================');
  console.log('           BACKTEST RESULTS');
  console.log('========================================\n');

  console.log('Performance:');
  console.log(`  Total Return:      $${metrics.totalReturn.toFixed(2)}`);
  console.log(`  Total Return %:    ${metrics.totalReturnPercent.toFixed(2)}%`);
  console.log(`  Sharpe Ratio:      ${metrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Sortino Ratio:     ${metrics.sortinoRatio.toFixed(2)}`);

  console.log('\nRisk:');
  console.log(`  Max Drawdown:      $${metrics.maxDrawdown.toFixed(2)}`);
  console.log(`  Max Drawdown %:    ${metrics.maxDrawdownPercent.toFixed(2)}%`);

  console.log('\nTrade Statistics:');
  console.log(`  Total Trades:      ${metrics.totalTrades}`);
  console.log(`  Winning Trades:    ${metrics.winningTrades}`);
  console.log(`  Losing Trades:     ${metrics.losingTrades}`);
  console.log(`  Win Rate:          ${metrics.winRate.toFixed(2)}%`);
  console.log(`  Profit Factor:     ${metrics.profitFactor.toFixed(2)}`);

  console.log('\nTrade Metrics:');
  console.log(`  Avg Win:           $${metrics.avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:          $${metrics.avgLoss.toFixed(2)}`);
  console.log(`  Expectancy:        $${metrics.expectancy.toFixed(2)}`);

  console.log('\nEfficiency:');
  console.log(`  Exposure Time:     ${metrics.exposureTime.toFixed(2)}%`);

  console.log('\n========================================\n');
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Check for help flag
  if (args.help !== undefined || process.argv.includes('--help')) {
    printHelp();
    return;
  }

  // Check for list flag
  if (args.list !== undefined || process.argv.includes('--list')) {
    await printStrategies();
    return;
  }

  // Validate required arguments
  const required = ['strategy', 'symbol', 'from', 'to'];
  const missing = required.filter((key) => !args[key]);

  if (missing.length > 0) {
    console.error(`Error: Missing required arguments: ${missing.join(', ')}`);
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Parse dates
  const startDate = new Date(args.from).getTime();
  const endDate = new Date(args.to).getTime();

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error('Error: Start date must be before end date');
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
    timeframe: (args.timeframe || '1h') as Timeframe,
    startDate,
    endDate,
    initialCapital: args.capital ? Number(args.capital) : 10000,
    exchange: args.exchange || 'binance',
    params: strategyParams,
  });

  console.log('\nBacktest Configuration:');
  console.log(`  Strategy:    ${config.strategyName}`);
  console.log(`  Symbol:      ${config.symbol}`);
  console.log(`  Timeframe:   ${config.timeframe}`);
  console.log(`  Period:      ${args.from} to ${args.to}`);
  console.log(`  Capital:     $${config.initialCapital}`);
  console.log(`  Exchange:    ${config.exchange}`);
  if (Object.keys(strategyParams).length > 0) {
    console.log(`  Params:      ${JSON.stringify(strategyParams)}`);
  }
  console.log();

  try {
    // Run the backtest
    console.log('Running backtest...\n');
    const result = await runBacktest(config, {
      enableLogging: false,
      onProgress: ({ percent }) => {
        process.stdout.write(`\rProgress: ${percent.toFixed(1)}%`);
      },
    });

    console.log('\n');

    // Display results
    formatMetrics(result.metrics as unknown as Record<string, number>);

    // Show recent trades (close trades with PnL)
    const closeTrades = result.trades.filter(
      (t) => t.action === 'CLOSE_LONG' || t.action === 'CLOSE_SHORT'
    );
    if (closeTrades.length > 0) {
      console.log('Recent Trades (last 5 closes):');
      const recentTrades = closeTrades.slice(-5);
      for (const trade of recentTrades) {
        const date = new Date(trade.timestamp).toISOString().split('T')[0];
        const pnl = trade.pnl ?? 0;
        const pnlPercent = trade.pnlPercent ?? 0;
        const pnlSign = pnl >= 0 ? '+' : '';
        const actionLabel = trade.action === 'CLOSE_LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
        console.log(
          `  ${date}: ${actionLabel} ${trade.amount.toFixed(4)} @ $${trade.price.toFixed(2)} | PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%) | Balance: $${trade.balanceAfter.toFixed(2)}`
        );
      }
      console.log();
    }

    console.log(`Results saved with ID: ${result.id}`);
  } catch (error) {
    console.error('\nBacktest failed:', error);
    process.exit(1);
  } finally {
    closeDb();
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb();
  process.exit(1);
});
