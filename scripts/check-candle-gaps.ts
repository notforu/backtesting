import { initDb, getPool, closeDb } from '../src/data/db.js';

async function main() {
  await initDb();
  const p = getPool();

  const symbols = ['DOGE/USDT:USDT', 'IOST/USDT:USDT', 'ZEC/USDT:USDT', 'TRB/USDT:USDT', 'IOTA/USDT:USDT'];

  const h2Start = new Date('2022-07-01').getTime();
  const h2End = new Date('2022-12-31').getTime();

  for (const sym of symbols) {
    const short = sym.replace('/USDT:USDT', '');

    // Count candles in H2 range
    const { rows: h2 } = await p.query(
      `SELECT COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
       FROM candles WHERE exchange='binance' AND symbol=$1 AND timeframe='4h'
       AND timestamp >= $2 AND timestamp <= $3`,
      [sym, h2Start, h2End]
    );

    // Find the gap — last candle before Jul and first candle after Jul
    const { rows: gap } = await p.query(
      `SELECT
        (SELECT MAX(timestamp) FROM candles WHERE exchange='binance' AND symbol=$1 AND timeframe='4h' AND timestamp < $2) as last_before,
        (SELECT MIN(timestamp) FROM candles WHERE exchange='binance' AND symbol=$1 AND timeframe='4h' AND timestamp >= $2) as first_after`,
      [sym, h2Start]
    );

    const h2Count = h2[0].cnt;
    const lastBefore = gap[0].last_before ? new Date(Number(gap[0].last_before)).toISOString().slice(0, 16) : 'none';
    const firstAfter = gap[0].first_after ? new Date(Number(gap[0].first_after)).toISOString().slice(0, 16) : 'none';
    const gapDays = gap[0].last_before && gap[0].first_after
      ? Math.round((Number(gap[0].first_after) - Number(gap[0].last_before)) / (86400 * 1000))
      : 'N/A';

    console.log(`${short.padEnd(8)} H2 candles: ${String(h2Count).padStart(5)}  last_before_Jul: ${lastBefore}  first_after_Jul: ${firstAfter}  gap: ${gapDays} days`);
  }

  await closeDb();
}

main();
