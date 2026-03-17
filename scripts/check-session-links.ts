import { getPool } from '../src/data/db.js';
const pool = getPool();

async function main() {
  // Check paper sessions
  const sessions = await pool.query(`
    SELECT id, name, aggregation_config_id, strategy_config_id,
           jsonb_array_length(aggregation_config->'subStrategies') as sub_count
    FROM paper_sessions ORDER BY created_at DESC
  `);

  console.log('=== Paper Sessions ===');
  for (const row of sessions.rows) {
    console.log(`${row.id.substring(0,8)} agg_id=${(row.aggregation_config_id || 'NULL').substring(0,8)} sc_id=${row.strategy_config_id || 'NULL'} subs=${row.sub_count} "${row.name}"`);
  }

  // Check aggregation configs
  const aggs = await pool.query(`
    SELECT id, name, sub_strategy_config_ids, content_hash
    FROM aggregation_configs ORDER BY created_at DESC
  `);

  console.log('\n=== Aggregation Configs ===');
  for (const row of aggs.rows) {
    console.log(`${row.id.substring(0,8)} scIds=${row.sub_strategy_config_ids?.length || 0} hash=${(row.content_hash || 'NULL').substring(0,8)} "${row.name}"`);
  }

  await pool.end();
}
main();
