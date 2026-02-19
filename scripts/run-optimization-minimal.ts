/**
 * Minimal CLI Script for quick parameter optimization
 * Uses smaller grid for faster results
 *
 * Run with: npx tsx scripts/run-optimization-minimal.ts
 */

import { runOptimization, type OptimizationConfig, type OptimizationProgress } from '../src/core/optimizer.js';
import { getProvider } from '../src/data/providers/index.js';
import { saveCandles, getCandles, getCandleDateRange } from '../src/data/db.js';
import type { Timeframe } from '../src/core/types.js';

const STRATEGY_NAME = 'marketLeaderDivergence';
const SYMBOL = 'BTCUSDT';
const EXCHANGE = 'binance';
const INITIAL_CAPITAL = 10000;

// Short date range: 30 days for quick test
const END_DATE = Date.now();
const START_DATE = END_DATE - (30 * 24 * 60 * 60 * 1000); // 30 days ago

// Minimal parameter ranges - just 2 values each for quick test
const PARAM_RANGES = {
  fastEMA: { min: 15, max: 25, step: 10 },      // 2 values: 15, 25
  slowEMA: { min: 50, max: 70, step: 20 },      // 2 values: 50, 70
  volumeMultiplier: { min: 1.5, max: 2.0, step: 0.5 },  // 2 values: 1.5, 2.0
  lookbackPeriod: { min: 15, max: 25, step: 10 },       // 2 values: 15, 25
  stopLossPercent: { min: 2, max: 3, step: 1 },         // 2 values: 2, 3
  takeProfitPercent: { min: 4, max: 6, step: 2 },       // 2 values: 4, 6
  positionSizePercent: { min: 95, max: 95, step: 5 },   // 1 value: 95
};
// Total: 2^6 * 1 = 64 combinations per timeframe - much faster!

const TIMEFRAMES_TO_TEST: Timeframe[] = ['1h', '15m', '1m'];

async function prefetchCandles(timeframe: Timeframe): Promise<void> {
  console.log(`  Pre-fetching ${timeframe} candles for ${SYMBOL}...`);

  const cached = await getCandleDateRange(EXCHANGE, SYMBOL, timeframe);
  if (cached.start && cached.end && cached.start <= START_DATE && cached.end >= END_DATE) {
    const existingCandles = await getCandles(EXCHANGE, SYMBOL, timeframe, START_DATE, END_DATE);
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
    await saveCandles(candles, EXCHANGE, SYMBOL, timeframe);
    console.log(`  Cached ${candles.length} ${timeframe} candles`);
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
    maxCombinations: 100,
    batchSize: 4,
  };

  const progressCallback = (progress: OptimizationProgress) => {
    const pct = progress.percent.toFixed(1);
    const best = progress.currentBest
      ? `Best Sharpe: ${progress.currentBest.metric.toFixed(4)}`
      : 'Finding best...';
    process.stdout.write(`\r[${pct}%] ${progress.current}/${progress.total} | ${best}            `);
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
    Object.entries(result.bestParams).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log(`\nBest Metrics:`);
    console.log(`  Sharpe Ratio:  ${result.bestMetrics.sharpeRatio.toFixed(4)}`);
    console.log(`  Total Return:  ${result.bestMetrics.totalReturnPercent.toFixed(2)}%`);
    console.log(`  Win Rate:      ${result.bestMetrics.winRate.toFixed(1)}%`);
    console.log(`  Profit Factor: ${result.bestMetrics.profitFactor === Infinity ? 'Inf' : result.bestMetrics.profitFactor.toFixed(2)}`);
    console.log(`  Max Drawdown:  ${result.bestMetrics.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`  Total Trades:  ${result.bestMetrics.totalTrades}`);
    console.log(`\nSaved to DB - ID: ${result.id}`);
    console.log(`${'─'.repeat(60)}\n`);

  } catch (error) {
    console.error(`\nError optimizing ${timeframe}:`, error);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('MINIMAL GRID SEARCH OPTIMIZATION');
  console.log('='.repeat(60));
  console.log(`Strategy: ${STRATEGY_NAME}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Date Range: ${new Date(START_DATE).toISOString().split('T')[0]} to ${new Date(END_DATE).toISOString().split('T')[0]}`);
  console.log(`Timeframes: ${TIMEFRAMES_TO_TEST.join(', ')}`);

  let totalCombinations = 1;
  console.log(`\nParameter Grid:`);
  Object.entries(PARAM_RANGES).forEach(([key, range]) => {
    const values: number[] = [];
    for (let v = range.min; v <= range.max + 0.001; v += range.step) {
      values.push(Math.round(v * 100) / 100);
    }
    totalCombinations *= values.length;
    console.log(`  ${key}: [${values.join(', ')}]`);
  });
  console.log(`\nCombinations per timeframe: ${totalCombinations}`);

  // Pre-fetch data
  console.log('\n--- Pre-fetching data ---');
  for (const tf of TIMEFRAMES_TO_TEST) {
    await prefetchCandles(tf);
  }
  console.log('--- Pre-fetch complete ---\n');

  // Run optimizations
  for (const tf of TIMEFRAMES_TO_TEST) {
    await runOptimizationForTimeframe(tf);
  }

  console.log('\n' + '='.repeat(60));
  console.log('OPTIMIZATION COMPLETE');
  console.log('Best params saved to database for each timeframe');
  console.log('='.repeat(60) + '\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
