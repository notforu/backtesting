#!/usr/bin/env node
/**
 * Verify that funding-rate-spike backtest runs are persisted in the database
 */

import { initDb, getPool, closeDb } from '../src/data/db.js';

async function main(): Promise<void> {
  await initDb();
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT id, strategy_name,
            config->>'symbol'    AS symbol,
            config->>'timeframe' AS timeframe,
            created_at
     FROM backtest_runs
     ORDER BY created_at DESC
     LIMIT 5`
  );

  console.log('Recent backtest runs:');
  for (const r of rows) {
    const shortId = (r.id as string).substring(0, 8);
    console.log(`  ${shortId}  ${r.strategy_name}  ${r.symbol}  ${r.timeframe}  ${r.created_at}`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
