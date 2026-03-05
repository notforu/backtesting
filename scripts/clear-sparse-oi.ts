#!/usr/bin/env node
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import pg from 'pg';

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const r = await pool.query(`
    SELECT exchange, symbol, COUNT(*)::int as cnt,
           MIN(timestamp)::text as first_ts, MAX(timestamp)::text as last_ts
    FROM open_interest GROUP BY exchange, symbol ORDER BY symbol
  `);

  console.log('Current OI records:');
  for (const row of r.rows) {
    console.log(`  ${row.symbol}: ${row.cnt} records (${row.first_ts} - ${row.last_ts})`);
  }

  const del = await pool.query('DELETE FROM open_interest');
  console.log(`\nDeleted ${del.rowCount} OI records`);

  const r2 = await pool.query('SELECT COUNT(*)::int as cnt FROM long_short_ratio');
  console.log(`LSR records: ${r2.rows[0].cnt}`);
  if (r2.rows[0].cnt > 0) {
    await pool.query('DELETE FROM long_short_ratio');
    console.log('Deleted all LSR records');
  }

  await pool.end();
  console.log('Done! Re-run cache-oi-data.ts to fetch fresh data.');
}

main().catch(e => { console.error(e); process.exit(1); });
