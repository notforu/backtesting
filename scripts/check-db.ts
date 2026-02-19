/**
 * Check database state
 */
import { getPool, getAllOptimizedParams, getCandleDateRange } from '../src/data/db.js';

async function main(): Promise<void> {
  const pool = getPool();

  console.log('=== Database Status ===\n');

  // Check tables
  const tablesResult = await pool.query(
    `SELECT tablename as name FROM pg_catalog.pg_tables WHERE schemaname = 'public'`
  );
  const tables = tablesResult.rows as { name: string }[];
  console.log('Tables:', tables.map(t => t.name).join(', '));

  // Check optimized params
  const optimized = await getAllOptimizedParams();
  console.log('\n=== Optimized Parameters ===');
  if (optimized.length === 0) {
    console.log('No optimized parameters found in database');
  } else {
    optimized.forEach(opt => {
      console.log(`\nStrategy: ${opt.strategyName} | Symbol: ${opt.symbol}`);
      console.log(`Best Sharpe: ${opt.bestMetrics.sharpeRatio.toFixed(4)}`);
      console.log(`Best Params:`, JSON.stringify(opt.bestParams, null, 2));
    });
  }

  // Check cached candles
  console.log('\n=== Cached Candle Data ===');
  const pairs = [
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1h' as const },
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '15m' as const },
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1m' as const },
  ];

  for (const { exchange, symbol, timeframe } of pairs) {
    const range = await getCandleDateRange(exchange, symbol, timeframe);
    if (range.start && range.end) {
      console.log(`${symbol} ${timeframe}: ${new Date(range.start).toISOString().split('T')[0]} to ${new Date(range.end).toISOString().split('T')[0]}`);
    } else {
      console.log(`${symbol} ${timeframe}: No data cached`);
    }
  }

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
