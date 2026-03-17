/**
 * Compare trade counts and candle counts between local and prod
 * to find root cause of the massive performance gap.
 */
import { getPool } from '../src/data/db.js';

const PROD_URL = 'http://5.223.56.226';
const pool = getPool();

async function loginProd(): Promise<string> {
  const resp = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'admin' }),
  });
  const data = await resp.json() as { token: string };
  return data.token;
}

async function main() {
  // Check local run details for the top config (79fcd037)
  const localRun = await pool.query(`
    SELECT
      id,
      (metrics->>'totalTrades')::int as trades,
      (metrics->>'sharpeRatio')::numeric as sharpe,
      (metrics->>'totalReturnPercent')::numeric as return_pct,
      jsonb_array_length(equity) as equity_bars,
      config->'params' as params,
      start_date, end_date
    FROM backtest_runs
    WHERE id LIKE '79fcd037%'
  `);

  if (localRun.rows.length > 0) {
    const r = localRun.rows[0];
    console.log('=== LOCAL RUN (79fcd037) ===');
    console.log(`Trades: ${r.trades}, Sharpe: ${Number(r.sharpe).toFixed(2)}, Return: ${Number(r.return_pct).toFixed(1)}%`);
    console.log(`Equity bars: ${r.equity_bars}`);
    console.log(`Start: ${r.start_date}, End: ${r.end_date}`);
    console.log(`Params:`, JSON.stringify(r.params, null, 2).substring(0, 500));
  }

  // Check local candle counts for a sample symbol
  const symbols = ['LPT/USDT:USDT', 'ZEC/USDT:USDT', 'IOST/USDT:USDT'];

  console.log('\n=== LOCAL CANDLE COUNTS (4h timeframe) ===');
  for (const sym of symbols) {
    const candles = await pool.query(`
      SELECT count(*) as cnt,
             min(timestamp) as first_ts,
             max(timestamp) as last_ts
      FROM candles
      WHERE symbol = $1 AND timeframe = '4h' AND exchange = 'bybit'
    `, [sym]);
    const r = candles.rows[0];
    console.log(`${sym}: ${r.cnt} candles, ${new Date(Number(r.first_ts)).toISOString().split('T')[0]} to ${new Date(Number(r.last_ts)).toISOString().split('T')[0]}`);
  }

  console.log('\n=== LOCAL FUNDING RATE COUNTS ===');
  for (const sym of symbols) {
    const fr = await pool.query(`
      SELECT count(*) as cnt,
             min(timestamp) as first_ts,
             max(timestamp) as last_ts
      FROM funding_rates
      WHERE symbol = $1 AND exchange = 'bybit'
    `, [sym]);
    const r = fr.rows[0];
    console.log(`${sym}: ${r.cnt} FR records, ${r.first_ts ? new Date(Number(r.first_ts)).toISOString().split('T')[0] : 'none'} to ${r.last_ts ? new Date(Number(r.last_ts)).toISOString().split('T')[0] : 'none'}`);
  }

  // Check prod candle and FR counts via direct DB query on prod
  const token = await loginProd();
  const headers = { 'Authorization': `Bearer ${token}` };

  // Use the backtest endpoint with a single asset to compare
  // Actually, let's just compare the date ranges of the runs

  // Check what date range local runs actually cover
  const localDates = await pool.query(`
    SELECT
      equity->0->>'timestamp' as first_equity_ts,
      equity->-1->>'timestamp' as last_equity_ts,
      jsonb_array_length(equity) as equity_len
    FROM backtest_runs
    WHERE id LIKE '79fcd037%'
  `);

  if (localDates.rows.length > 0) {
    const r = localDates.rows[0];
    const firstDate = new Date(Number(r.first_equity_ts));
    const lastDate = new Date(Number(r.last_equity_ts));
    console.log(`\n=== LOCAL RUN DATE RANGE ===`);
    console.log(`First equity: ${firstDate.toISOString()}`);
    console.log(`Last equity: ${lastDate.toISOString()}`);
    console.log(`Equity points: ${r.equity_len}`);
    console.log(`Duration: ${((Number(r.last_equity_ts) - Number(r.first_equity_ts)) / (1000 * 60 * 60 * 24)).toFixed(0)} days`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
