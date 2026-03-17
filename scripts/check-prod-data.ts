import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const symbols = ['LPT/USDT:USDT', 'ZEC/USDT:USDT', 'IOST/USDT:USDT', 'ARB/USDT:USDT', 'BCH/USDT:USDT', 'KAVA/USDT:USDT'];

  console.log('=== CANDLE COUNTS (4h) ===');
  for (const sym of symbols) {
    const r = await pool.query(
      `SELECT count(*) as cnt, min(timestamp) as first_ts, max(timestamp) as last_ts
       FROM candles WHERE symbol = $1 AND timeframe = $2 AND exchange = $3`,
      [sym, '4h', 'bybit']
    );
    const row = r.rows[0];
    const f = row.first_ts ? new Date(Number(row.first_ts)).toISOString().split('T')[0] : 'none';
    const l = row.last_ts ? new Date(Number(row.last_ts)).toISOString().split('T')[0] : 'none';
    console.log(`${sym}: ${row.cnt} candles, ${f} to ${l}`);
  }

  console.log('\n=== FR COUNTS ===');
  for (const sym of symbols) {
    const r = await pool.query(
      `SELECT count(*) as cnt, min(timestamp) as first_ts, max(timestamp) as last_ts
       FROM funding_rates WHERE symbol = $1 AND exchange = $2`,
      [sym, 'bybit']
    );
    const row = r.rows[0];
    const f = row.first_ts ? new Date(Number(row.first_ts)).toISOString().split('T')[0] : 'none';
    const l = row.last_ts ? new Date(Number(row.last_ts)).toISOString().split('T')[0] : 'none';
    console.log(`${sym}: ${row.cnt} FR, ${f} to ${l}`);
  }

  await pool.end();
}
main();
