import { initDb, getPool, closeDb } from '../src/data/db.js';

async function main() {
  await initDb();
  const p = getPool();

  const { rows: candles } = await p.query(`
    SELECT symbol, COUNT(*) as cnt,
      MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
    FROM candles WHERE exchange='binance' AND timeframe='4h' AND symbol LIKE '%USDT:USDT'
    GROUP BY symbol ORDER BY symbol
  `);

  console.log('=== BINANCE 4h CANDLE COVERAGE ===');
  console.log('Symbol'.padEnd(18) + 'Count'.padStart(6) + '  First'.padEnd(14) + '  Last'.padEnd(14) + '  Days');
  for (const r of candles) {
    const first = new Date(Number(r.min_ts)).toISOString().slice(0, 10);
    const last = new Date(Number(r.max_ts)).toISOString().slice(0, 10);
    const days = Math.round((Number(r.max_ts) - Number(r.min_ts)) / (86400 * 1000));
    console.log(
      r.symbol.replace('/USDT:USDT', '').padEnd(18) +
      String(r.cnt).padStart(6) + '  ' + first + '  ' + last + '  ' + String(days).padStart(4)
    );
  }

  const { rows: frs } = await p.query(`
    SELECT symbol, COUNT(*) as cnt,
      MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
    FROM funding_rates WHERE exchange='binance' AND symbol LIKE '%USDT:USDT'
    GROUP BY symbol ORDER BY symbol
  `);

  console.log('');
  console.log('=== BINANCE FUNDING RATE COVERAGE ===');
  console.log('Symbol'.padEnd(18) + 'Count'.padStart(6) + '  First'.padEnd(14) + '  Last'.padEnd(14) + '  Days');
  for (const r of frs) {
    const first = new Date(Number(r.min_ts)).toISOString().slice(0, 10);
    const last = new Date(Number(r.max_ts)).toISOString().slice(0, 10);
    const days = Math.round((Number(r.max_ts) - Number(r.min_ts)) / (86400 * 1000));
    console.log(
      r.symbol.replace('/USDT:USDT', '').padEnd(18) +
      String(r.cnt).padStart(6) + '  ' + first + '  ' + last + '  ' + String(days).padStart(4)
    );
  }

  await closeDb();
}

main();
