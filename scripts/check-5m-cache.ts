import { getPool, closeDb } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  
  const result = await pool.query(
    `SELECT symbol, timeframe, COUNT(*) as count FROM candles WHERE timeframe='5m' GROUP BY symbol, timeframe ORDER BY symbol`
  );
  console.log('5m candles cached:');
  console.log(JSON.stringify(result.rows, null, 2));
  
  const frResult = await pool.query(
    `SELECT symbol, COUNT(*) as count FROM funding_rates GROUP BY symbol ORDER BY symbol`
  );
  console.log('\nFunding rates by symbol:');
  console.log(JSON.stringify(frResult.rows, null, 2));
  
  await closeDb();
}
main().catch(console.error);
