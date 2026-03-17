import { getPool, closeDb } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  const symbols = ['SOL/USDT:USDT', 'DOGE/USDT:USDT', 'LDO/USDT:USDT', 'ARB/USDT:USDT', 'ZEC/USDT:USDT', 'TRB/USDT:USDT', 'IOST/USDT:USDT', 'STG/USDT:USDT'];
  
  for (const sym of symbols) {
    const result = await pool.query(
      `SELECT COUNT(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM candles WHERE symbol=$1 AND timeframe='5m'`,
      [sym]
    );
    const r = result.rows[0];
    if (r.count > 0) {
      const minDate = new Date(parseInt(r.min_ts)).toISOString().split('T')[0];
      const maxDate = new Date(parseInt(r.max_ts)).toISOString().split('T')[0];
      console.log(`${sym}: ${r.count} candles, ${minDate} to ${maxDate}`);
    } else {
      console.log(`${sym}: NO DATA`);
    }
  }
  
  // Check FR date ranges for target symbols
  console.log('\n--- Funding Rate Date Ranges ---');
  for (const sym of symbols) {
    const result = await pool.query(
      `SELECT COUNT(*) as count, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM funding_rates WHERE symbol=$1`,
      [sym]
    );
    const r = result.rows[0];
    if (r.count > 0) {
      const minDate = new Date(parseInt(r.min_ts)).toISOString().split('T')[0];
      const maxDate = new Date(parseInt(r.max_ts)).toISOString().split('T')[0];
      console.log(`${sym}: ${r.count} FR entries, ${minDate} to ${maxDate}`);
    } else {
      console.log(`${sym}: NO FR DATA`);
    }
  }
  
  await closeDb();
}
main().catch(console.error);
