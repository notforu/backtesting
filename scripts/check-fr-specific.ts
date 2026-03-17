import { getPool } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  const symbols = ['LDO/USDT:USDT', 'DOGE/USDT:USDT', 'ICP/USDT:USDT', 'XLM/USDT:USDT', 'NEAR/USDT:USDT', 'BTC/USDT:USDT'];
  const result = await pool.query(
    "SELECT symbol, COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM funding_rates WHERE symbol = ANY($1) GROUP BY symbol ORDER BY symbol",
    [symbols]
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}
main().catch(console.error);
