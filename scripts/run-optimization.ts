/**
 * CLI Script to run parameter optimization for market-leader-divergence strategy
 * Run with: npx tsx scripts/run-optimization.ts
 */

import { runOptimization, type OptimizationConfig, type OptimizationProgress } from '../src/core/optimizer.js';

const STRATEGY_NAME = 'marketLeaderDivergence';
const SYMBOL = 'BTCUSDT';
const EXCHANGE = 'binance';
const INITIAL_CAPITAL = 10000;

// Date range: last 6 months for meaningful results
const END_DATE = Date.now();
const START_DATE = END_DATE - (180 * 24 * 60 * 60 * 1000); // 180 days ago

// Focused parameter ranges for faster optimization
// Using a subset of the full ranges to keep combinations manageable
const PARAM_RANGES = {
  fastEMA: { min: 10, max: 30, step: 10 },      // 3 values: 10, 20, 30
  slowEMA: { min: 40, max: 100, step: 30 },     // 3 values: 40, 70, 100
  volumeMultiplier: { min: 1.3, max: 2.1, step: 0.4 },  // 3 values: 1.3, 1.7, 2.1
  lookbackPeriod: { min: 10, max: 30, step: 10 },       // 3 values: 10, 20, 30
  stopLossPercent: { min: 1.5, max: 3.5, step: 1 },     // 3 values: 1.5, 2.5, 3.5
  takeProfitPercent: { min: 3, max: 7, step: 2 },       // 3 values: 3, 5, 7
  positionSizePercent: { min: 95, max: 95, step: 5 },   // 1 value: 95
};
// Total: 3^6 * 1 = 729 combinations per timeframe

type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

const TIMEFRAMES_TO_TEST: Timeframe[] = ['1h', '15m', '1m'];

async function runOptimizationForTimeframe(timeframe: Timeframe): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`OPTIMIZING: ${STRATEGY_NAME} on ${SYMBOL} @ ${timeframe}`);
  console.log(`${'='.repeat(60)}\n`);

  const config: OptimizationConfig = {
    strategyName: STRATEGY_NAME,
    symbol: SYMBOL,
    timeframe,
    startDate: START_DATE,
    endDate: END_DATE,
    initialCapital: INITIAL_CAPITAL,
    exchange: EXCHANGE,
    paramRanges: PARAM_RANGES,
    optimizeFor: 'sharpeRatio',
    maxCombinations: 1000, // Limit just in case
    batchSize: 4, // Run 4 backtests in parallel
  };

  const progressCallback = (progress: OptimizationProgress) => {
    const pct = progress.percent.toFixed(1);
    const best = progress.currentBest
      ? `Best Sharpe: ${progress.currentBest.metric.toFixed(4)}`
      : 'Finding best...';
    process.stdout.write(`\r[${pct}%] Tested ${progress.current}/${progress.total} | ${best}      `);
  };

  try {
    const startTime = Date.now();
    const result = await runOptimization(config, progressCallback);
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log(`\n\n${'─'.repeat(60)}`);
    console.log(`RESULTS FOR ${timeframe.toUpperCase()}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Duration: ${duration} minutes`);
    console.log(`Tested: ${result.testedCombinations}/${result.totalCombinations} combinations`);
    console.log(`\nBest Parameters:`);
    console.log(JSON.stringify(result.bestParams, null, 2));
    console.log(`\nBest Metrics:`);
    console.log(`  Sharpe Ratio: ${result.bestMetrics.sharpeRatio.toFixed(4)}`);
    console.log(`  Total Return: ${result.bestMetrics.totalReturnPercent.toFixed(2)}%`);
    console.log(`  Win Rate: ${result.bestMetrics.winRate.toFixed(1)}%`);
    console.log(`  Profit Factor: ${result.bestMetrics.profitFactor === Infinity ? 'Inf' : result.bestMetrics.profitFactor.toFixed(2)}`);
    console.log(`  Max Drawdown: ${result.bestMetrics.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`  Total Trades: ${result.bestMetrics.totalTrades}`);
    console.log(`${'─'.repeat(60)}\n`);

    return;
  } catch (error) {
    console.error(`\nError optimizing ${timeframe}:`, error);
    throw error;
  }
}

async function main() {
  console.log('Starting Grid Search Optimization');
  console.log(`Strategy: ${STRATEGY_NAME}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Date Range: ${new Date(START_DATE).toISOString().split('T')[0]} to ${new Date(END_DATE).toISOString().split('T')[0]}`);
  console.log(`Timeframes: ${TIMEFRAMES_TO_TEST.join(', ')}`);
  console.log(`Parameter Ranges:`);
  Object.entries(PARAM_RANGES).forEach(([key, range]) => {
    const values: number[] = [];
    for (let v = range.min; v <= range.max; v += range.step) {
      values.push(Math.round(v * 100) / 100);
    }
    console.log(`  ${key}: [${values.join(', ')}]`);
  });

  for (const timeframe of TIMEFRAMES_TO_TEST) {
    await runOptimizationForTimeframe(timeframe);
  }

  console.log('\n' + '='.repeat(60));
  console.log('ALL OPTIMIZATIONS COMPLETE');
  console.log('Results saved to database - view in UI or query API');
  console.log('='.repeat(60) + '\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
