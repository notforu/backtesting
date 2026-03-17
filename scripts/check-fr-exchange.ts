import { getPool, closeDb } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT DISTINCT exchange, symbol FROM funding_rates WHERE symbol='SOL/USDT:USDT' LIMIT 5`
  );
  console.log('FR exchange values for SOL:', JSON.stringify(result.rows, null, 2));
  
  const result2 = await pool.query(
    `SELECT DISTINCT exchange FROM candles WHERE symbol='SOL/USDT:USDT' AND timeframe='5m' LIMIT 5`
  );
  console.log('Candle exchange values for SOL 5m:', JSON.stringify(result2.rows, null, 2));
  await closeDb();
}
main().catch(console.error);
