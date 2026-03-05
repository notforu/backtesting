#!/usr/bin/env node
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}
import pg from 'pg';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Check candle cache
  const candles = await pool.query(`
    SELECT exchange, symbol, timeframe, COUNT(*)::int as cnt,
           MIN(timestamp)::text as min_ts, MAX(timestamp)::text as max_ts
    FROM candles
    GROUP BY exchange, symbol, timeframe
    ORDER BY symbol, timeframe
  `);

  console.log('=== CANDLES ===');
  for (const row of candles.rows) {
    const from = new Date(Number(row.min_ts)).toISOString().slice(0, 10);
    const to = new Date(Number(row.max_ts)).toISOString().slice(0, 10);
    console.log(`  ${row.symbol} (${row.timeframe}): ${row.cnt} candles (${from} - ${to})`);
  }

  // Check OI cache
  const oi = await pool.query(`
    SELECT exchange, symbol, COUNT(*)::int as cnt,
           MIN(timestamp)::text as min_ts, MAX(timestamp)::text as max_ts
    FROM open_interest
    GROUP BY exchange, symbol
    ORDER BY symbol
  `);

  console.log('\n=== OPEN INTEREST ===');
  if (oi.rows.length === 0) console.log('  (empty)');
  for (const row of oi.rows) {
    const from = new Date(Number(row.min_ts)).toISOString().slice(0, 10);
    const to = new Date(Number(row.max_ts)).toISOString().slice(0, 10);
    console.log(`  ${row.symbol}: ${row.cnt} records (${from} - ${to})`);
  }

  // Check LSR cache
  const lsr = await pool.query(`
    SELECT exchange, symbol, COUNT(*)::int as cnt,
           MIN(timestamp)::text as min_ts, MAX(timestamp)::text as max_ts
    FROM long_short_ratio
    GROUP BY exchange, symbol
    ORDER BY symbol
  `);

  console.log('\n=== LONG/SHORT RATIO ===');
  if (lsr.rows.length === 0) console.log('  (empty)');
  for (const row of lsr.rows) {
    const from = new Date(Number(row.min_ts)).toISOString().slice(0, 10);
    const to = new Date(Number(row.max_ts)).toISOString().slice(0, 10);
    console.log(`  ${row.symbol}: ${row.cnt} records (${from} - ${to})`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
