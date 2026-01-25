/**
 * Check database state
 */
import { getDb, getAllOptimizedParams, getCandleDateRange } from '../src/data/db.js';

const db = getDb();

console.log('=== Database Status ===\n');

// Check tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log('Tables:', tables.map(t => t.name).join(', '));

// Check optimized params
const optimized = getAllOptimizedParams();
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
  const range = getCandleDateRange(exchange, symbol, timeframe);
  if (range.start && range.end) {
    console.log(`${symbol} ${timeframe}: ${new Date(range.start).toISOString().split('T')[0]} to ${new Date(range.end).toISOString().split('T')[0]}`);
  } else {
    console.log(`${symbol} ${timeframe}: No data cached`);
  }
}

console.log('\n=== Done ===');
