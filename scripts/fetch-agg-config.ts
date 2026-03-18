/**
 * Fetch a specific aggregation config and its latest run from the database.
 */
import { getPool } from '../src/data/db.js';

const AGG_CONFIG_ID = 'b35b694c-264b-4b80-bce5-b544854840c3';

async function main(): Promise<void> {
  const pool = getPool();

  try {
    // 1. Fetch the aggregation config row
    const configResult = await pool.query(
      `SELECT * FROM aggregation_configs WHERE id = $1`,
      [AGG_CONFIG_ID]
    );

    if (configResult.rows.length === 0) {
      console.error(`No aggregation_configs row found for id: ${AGG_CONFIG_ID}`);
      process.exit(1);
    }

    const configRow = configResult.rows[0];

    console.log('=== aggregation_configs row ===');
    console.log(JSON.stringify(configRow, null, 2));

    // 2. Fetch the latest aggregation run for this config
    const runResult = await pool.query(
      `SELECT * FROM aggregation_runs
       WHERE aggregation_config_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [AGG_CONFIG_ID]
    );

    if (runResult.rows.length === 0) {
      console.log('\n=== aggregation_runs: no runs found for this config ===');
    } else {
      const runRow = runResult.rows[0];
      console.log('\n=== aggregation_runs (latest) ===');
      console.log(JSON.stringify(runRow, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
