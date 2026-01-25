/**
 * Test script for parameter optimization engine
 * Run with: npx tsx test-optimizer.ts
 */

import { runOptimization } from './src/core/optimizer.js';
import { getOptimizedParams } from './src/data/db.js';

async function testOptimizer() {
  console.log('Testing Parameter Optimization Engine\n');

  // Test with SMA Crossover strategy
  const config = {
    strategyName: 'sma-crossover',
    symbol: 'BTC/USDT',
    timeframe: '1h' as const,
    startDate: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    endDate: Date.now(),
    initialCapital: 10000,
    exchange: 'binance',
    optimizeFor: 'sharpeRatio' as const,
    maxCombinations: 20, // Small number for quick test
    batchSize: 4,
    paramRanges: {
      fastPeriod: { min: 5, max: 15, step: 5 }, // 3 values: 5, 10, 15
      slowPeriod: { min: 20, max: 40, step: 10 }, // 3 values: 20, 30, 40
    },
  };

  console.log('Configuration:');
  console.log(`- Strategy: ${config.strategyName}`);
  console.log(`- Symbol: ${config.symbol}`);
  console.log(`- Timeframe: ${config.timeframe}`);
  console.log(`- Date Range: ${new Date(config.startDate).toISOString()} to ${new Date(config.endDate).toISOString()}`);
  console.log(`- Optimize For: ${config.optimizeFor}`);
  console.log(`- Max Combinations: ${config.maxCombinations}`);
  console.log(`- Batch Size: ${config.batchSize}\n`);

  try {
    // Run optimization with progress callback
    console.log('Starting optimization...\n');
    const result = await runOptimization(config, (progress) => {
      console.log(
        `Progress: ${progress.current}/${progress.total} (${progress.percent.toFixed(1)}%)` +
        (progress.currentBest
          ? ` - Best: ${progress.currentBest.metric.toFixed(4)} @ ${JSON.stringify(progress.currentBest.params)}`
          : '')
      );
    });

    console.log('\n=== Optimization Complete ===');
    console.log(`Total Combinations: ${result.totalCombinations}`);
    console.log(`Tested Combinations: ${result.testedCombinations}`);
    console.log(`\nBest Parameters:`);
    console.log(JSON.stringify(result.bestParams, null, 2));
    console.log(`\nBest Metrics:`);
    console.log(`- Sharpe Ratio: ${result.bestMetrics.sharpeRatio.toFixed(4)}`);
    console.log(`- Total Return: ${result.bestMetrics.totalReturnPercent.toFixed(2)}%`);
    console.log(`- Win Rate: ${result.bestMetrics.winRate.toFixed(2)}%`);
    console.log(`- Max Drawdown: ${result.bestMetrics.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`- Profit Factor: ${result.bestMetrics.profitFactor.toFixed(2)}`);
    console.log(`- Total Trades: ${result.bestMetrics.totalTrades}`);

    // Verify it was saved to database
    console.log('\n=== Testing Database Retrieval ===');
    const saved = getOptimizedParams(config.strategyName, config.symbol);
    if (saved) {
      console.log(`✓ Successfully retrieved from database`);
      console.log(`  Strategy: ${saved.strategyName}`);
      console.log(`  Symbol: ${saved.symbol}`);
      console.log(`  Optimized At: ${new Date(saved.optimizedAt).toISOString()}`);
    } else {
      console.log(`✗ Failed to retrieve from database`);
    }

  } catch (error) {
    console.error('\n=== Optimization Failed ===');
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      console.error(error.stack);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the test
testOptimizer().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
