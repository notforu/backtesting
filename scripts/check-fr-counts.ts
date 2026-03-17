import { getPool } from '../src/data/db.js';

async function main() {
  const pool = getPool();
  const result = await pool.query("SELECT symbol, COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM funding_rates GROUP BY symbol ORDER BY cnt DESC LIMIT 20");
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}
main().catch(console.error);
