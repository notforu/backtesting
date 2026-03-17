import { getPool, closeDb } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  const symbols = ['SOL/USDT:USDT', 'DOGE/USDT:USDT', 'LDO/USDT:USDT', 'ARB/USDT:USDT'];
  
  for (const sym of symbols) {
    const result = await pool.query(
      `SELECT exchange, COUNT(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts 
       FROM candles WHERE symbol=$1 AND timeframe='5m' GROUP BY exchange`,
      [sym]
    );
    for (const r of result.rows) {
      const minDate = new Date(parseInt(r.min_ts)).toISOString().split('T')[0];
      const maxDate = new Date(parseInt(r.max_ts)).toISOString().split('T')[0];
      console.log(`${sym} [${r.exchange}]: ${r.count} candles, ${minDate} to ${maxDate}`);
    }
  }
  await closeDb();
}
main().catch(console.error);
