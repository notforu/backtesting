/**
 * 1. Find all strategy_configs with empty params on prod
 * 2. Delete their backtest runs
 * 3. Delete the strategy configs themselves (if they have duplicates with params)
 * 4. Re-run backtests for strategy configs that have params
 */
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Find strategy configs with empty params
  const emptyConfigs = await pool.query(`
    SELECT id, strategy_name, symbol, timeframe, content_hash, name
    FROM strategy_configs
    WHERE params = '{}'::jsonb OR params IS NULL
    ORDER BY strategy_name, symbol
  `);

  console.log(`=== STRATEGY CONFIGS WITH EMPTY PARAMS: ${emptyConfigs.rows.length} ===\n`);

  for (const row of emptyConfigs.rows) {
    console.log(`  ${row.id.substring(0,8)} ${row.strategy_name} / ${row.symbol} / ${row.timeframe}`);
  }

  // 2. Find backtest runs linked to these configs
  const emptyIds = emptyConfigs.rows.map(r => r.id);

  if (emptyIds.length === 0) {
    console.log('\nNo empty configs found. Nothing to clean up.');
    await pool.end();
    return;
  }

  const runsToDelete = await pool.query(`
    SELECT id, strategy_name, strategy_config_id,
           (metrics->>'sharpeRatio')::numeric as sharpe,
           config->>'symbol' as symbol
    FROM backtest_runs
    WHERE strategy_config_id = ANY($1)
    ORDER BY strategy_name, symbol
  `, [emptyIds]);

  console.log(`\n=== BACKTEST RUNS TO DELETE: ${runsToDelete.rows.length} ===\n`);
  for (const row of runsToDelete.rows) {
    console.log(`  ${row.id.substring(0,8)} ${row.strategy_name} ${row.symbol} Sharpe=${Number(row.sharpe || 0).toFixed(2)}`);
  }

  // Also find runs with empty params in their config (not linked to any strategy config)
  const orphanRuns = await pool.query(`
    SELECT id, strategy_name, config->>'symbol' as symbol,
           (metrics->>'sharpeRatio')::numeric as sharpe,
           strategy_config_id
    FROM backtest_runs
    WHERE (config->'params' = '{}'::jsonb OR config->'params' IS NULL)
      AND strategy_name != 'aggregation'
      AND strategy_config_id IS NOT NULL
  `);

  console.log(`\n=== ADDITIONAL RUNS WITH EMPTY PARAMS IN CONFIG: ${orphanRuns.rows.length} ===\n`);

  // 3. Check for duplicate configs (same strategy/symbol/timeframe WITH params)
  const dupeCheck = await pool.query(`
    SELECT ec.id as empty_id, fc.id as full_id,
           ec.strategy_name, ec.symbol, ec.timeframe,
           jsonb_object_keys(fc.params) as param_count
    FROM strategy_configs ec
    JOIN strategy_configs fc ON
      fc.strategy_name = ec.strategy_name
      AND fc.symbol = ec.symbol
      AND fc.timeframe = ec.timeframe
      AND fc.params != '{}'::jsonb
    WHERE ec.params = '{}'::jsonb
    GROUP BY ec.id, fc.id, ec.strategy_name, ec.symbol, ec.timeframe
  `);

  console.log(`\n=== EMPTY CONFIGS WITH NON-EMPTY DUPLICATES: ${dupeCheck.rows.length} ===`);

  // 4. Actually clean up
  console.log('\n=== PERFORMING CLEANUP ===\n');

  // Delete runs linked to empty configs
  const delRuns = await pool.query(`
    DELETE FROM backtest_runs WHERE strategy_config_id = ANY($1)
    RETURNING id
  `, [emptyIds]);
  console.log(`Deleted ${delRuns.rowCount} backtest runs linked to empty configs`);

  // Unlink aggregation_configs from empty strategy configs
  // (remove empty config IDs from sub_strategy_config_ids arrays)
  for (const emptyId of emptyIds) {
    await pool.query(`
      UPDATE aggregation_configs
      SET sub_strategy_config_ids = array_remove(sub_strategy_config_ids, $1)
      WHERE $1 = ANY(sub_strategy_config_ids)
    `, [emptyId]);
  }
  console.log(`Cleaned up aggregation_config references`);

  // Delete the empty strategy configs
  const delConfigs = await pool.query(`
    DELETE FROM strategy_configs WHERE id = ANY($1)
    RETURNING id
  `, [emptyIds]);
  console.log(`Deleted ${delConfigs.rowCount} empty strategy configs`);

  // 5. Show remaining state
  const remaining = await pool.query(`
    SELECT count(*) as cnt FROM strategy_configs WHERE params = '{}'::jsonb
  `);
  console.log(`\nRemaining empty configs: ${remaining.rows[0].cnt}`);

  const totalConfigs = await pool.query(`SELECT count(*) as cnt FROM strategy_configs`);
  console.log(`Total strategy configs: ${totalConfigs.rows[0].cnt}`);

  await pool.end();
}
main();
