/**
 * Fast CLI Script to run parameter optimization for market-leader-divergence strategy
 * Pre-fetches data first, then runs optimization with cached data
 *
 * Run with: npx tsx scripts/run-optimization-fast.ts
 */

import { runOptimization, type OptimizationConfig, type OptimizationProgress } from '../src/core/optimizer.js';
import { getProvider } from '../src/data/providers/index.js';
import { saveCandles, getCandles, getCandleDateRange } from '../src/data/db.js';
import type { Timeframe } from '../src/core/types.js';

const STRATEGY_NAME = 'marketLeaderDivergence';
const SYMBOL = 'BTCUSDT';
const EXCHANGE = 'binance';
const INITIAL_CAPITAL = 10000;

// Shorter date range for faster testing: 3 months
const END_DATE = Date.now();
const START_DATE = END_DATE - (90 * 24 * 60 * 60 * 1000); // 90 days ago

// Focused parameter ranges - smaller grid for faster results
const PARAM_RANGES = {
  fastEMA: { min: 10, max: 30, step: 10 },      // 3 values: 10, 20, 30
  slowEMA: { min: 40, max: 80, step: 20 },      // 3 values: 40, 60, 80
  volumeMultiplier: { min: 1.4, max: 2.0, step: 0.3 },  // 3 values: 1.4, 1.7, 2.0
  lookbackPeriod: { min: 15, max: 25, step: 5 },        // 3 values: 15, 20, 25
  stopLossPercent: { min: 2, max: 3, step: 0.5 },       // 3 values: 2, 2.5, 3
  takeProfitPercent: { min: 4, max: 6, step: 1 },       // 3 values: 4, 5, 6
  positionSizePercent: { min: 95, max: 95, step: 5 },   // 1 value: 95
};
// Total: 3^6 * 1 = 729 combinations per timeframe

const TIMEFRAMES_TO_TEST: Timeframe[] = ['1h', '15m', '1m'];

async function prefetchCandles(timeframe: Timeframe): Promise<void> {
  console.log(`\n  Pre-fetching ${timeframe} candles for ${SYMBOL}...`);

  // Check if we already have cached data
  const cached = getCandleDateRange(EXCHANGE, SYMBOL, timeframe);
  if (cached.start && cached.end && cached.start <= START_DATE && cached.end >= END_DATE) {
    const existingCandles = getCandles(EXCHANGE, SYMBOL, timeframe, START_DATE, END_DATE);
    console.log(`  Using ${existingCandles.length} cached candles`);
    return;
  }

  const provider = getProvider(EXCHANGE);
  const candles = await provider.fetchCandles(
    SYMBOL,
    timeframe,
    new Date(START_DATE),
    new Date(END_DATE)
  );

  if (candles.length > 0) {
    saveCandles(candles, EXCHANGE, SYMBOL, timeframe);
    console.log(`  Cached ${candles.length} ${timeframe} candles`);
  } else {
    console.log(`  Warning: No candles fetched for ${timeframe}`);
  }
}

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
    maxCombinations: 1000,
    batchSize: 8, // Increase batch size since data is cached
  };

  let lastProgressLine = '';
  const progressCallback = (progress: OptimizationProgress) => {
    const pct = progress.percent.toFixed(1);
    const best = progress.currentBest
      ? `Best Sharpe: ${progress.currentBest.metric.toFixed(4)}`
      : 'Finding best...';
    const line = `[${pct}%] Tested ${progress.current}/${progress.total} | ${best}`;
    if (line !== lastProgressLine) {
      process.stdout.write(`\r${line}                    `);
      lastProgressLine = line;
    }
  };

  try {
    const startTime = Date.now();
    const result = await runOptimization(config, progressCallback);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n\n${'─'.repeat(60)}`);
    console.log(`RESULTS FOR ${timeframe.toUpperCase()}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Duration: ${duration} seconds`);
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
    console.log(`\nResult saved to database with ID: ${result.id}`);
    console.log(`${'─'.repeat(60)}\n`);

  } catch (error) {
    console.error(`\nError optimizing ${timeframe}:`, error);
    throw error;
  }
}

async function main() {
  console.log('=' .repeat(60));
  console.log('Starting Fast Grid Search Optimization');
  console.log('='.repeat(60));
  console.log(`Strategy: ${STRATEGY_NAME}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Date Range: ${new Date(START_DATE).toISOString().split('T')[0]} to ${new Date(END_DATE).toISOString().split('T')[0]}`);
  console.log(`Timeframes: ${TIMEFRAMES_TO_TEST.join(', ')}`);
  console.log(`\nParameter Grid (${Object.keys(PARAM_RANGES).length} params):`);

  let totalCombinations = 1;
  Object.entries(PARAM_RANGES).forEach(([key, range]) => {
    const values: number[] = [];
    for (let v = range.min; v <= range.max + 0.001; v += range.step) {
      values.push(Math.round(v * 100) / 100);
    }
    totalCombinations *= values.length;
    console.log(`  ${key}: [${values.join(', ')}] (${values.length} values)`);
  });
  console.log(`\nTotal combinations per timeframe: ${totalCombinations}`);

  // Pre-fetch all data first
  console.log('\n--- Pre-fetching candle data ---');
  for (const timeframe of TIMEFRAMES_TO_TEST) {
    await prefetchCandles(timeframe);
  }
  console.log('--- Data pre-fetch complete ---\n');

  // Run optimizations
  for (const timeframe of TIMEFRAMES_TO_TEST) {
    await runOptimizationForTimeframe(timeframe);
  }

  console.log('\n' + '='.repeat(60));
  console.log('ALL OPTIMIZATIONS COMPLETE');
  console.log('Results saved to database - view in UI or query via API:');
  console.log(`  GET /api/optimize/${STRATEGY_NAME}/${SYMBOL}`);
  console.log('='.repeat(60) + '\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
