/**
 * Test optimization endpoint directly
 */
import { runOptimization } from '../src/core/optimizer.js';

async function test() {
  console.log('Starting optimization test...');

  try {
    const result = await runOptimization({
      strategyName: 'marketLeaderDivergence',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      startDate: new Date('2025-12-01').getTime(),
      endDate: new Date('2026-01-20').getTime(),
      initialCapital: 10000,
      exchange: 'binance',
      optimizeFor: 'sharpeRatio',
      maxCombinations: 3,
      batchSize: 1,
    }, (progress) => {
      console.log(`Progress: ${progress.current}/${progress.total} (${progress.percent.toFixed(1)}%)`);
    });

    console.log('\n=== SUCCESS ===');
    console.log('Best params:', JSON.stringify(result.bestParams, null, 2));
    console.log('Best Sharpe:', result.bestMetrics.sharpeRatio);
  } catch (error) {
    console.error('\n=== ERROR ===');
    console.error(error);
  }
}

test();
