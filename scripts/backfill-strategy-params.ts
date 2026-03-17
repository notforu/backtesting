/**
 * Backfill empty params in strategy_configs with strategy defaults.
 * Finds all strategy_configs where params = '{}' and fills with defaults.
 */
import { getPool } from '../src/data/db.js';
import { loadStrategy } from '../src/strategy/loader.js';
import { getDefaultParams } from '../src/strategy/base.js';
import { computeStrategyConfigHash } from '../src/utils/content-hash.js';

async function main() {
  const pool = getPool();

  const { rows } = await pool.query(`
    SELECT id, strategy_name, symbol, timeframe, params
    FROM strategy_configs
    WHERE params = '{}'::jsonb OR params IS NULL
  `);

  console.log(`Found ${rows.length} strategy configs with empty params\n`);

  let updated = 0;
  for (const row of rows) {
    try {
      const strategy = await loadStrategy(row.strategy_name);
      const defaults = getDefaultParams(strategy);

      if (Object.keys(defaults).length === 0) {
        console.log(`  ${row.id.substring(0,8)} ${row.strategy_name} — no defaults available, skipping`);
        continue;
      }

      // Recompute content hash with new params
      const newHash = computeStrategyConfigHash({
        strategyName: row.strategy_name,
        symbol: row.symbol,
        timeframe: row.timeframe,
        params: defaults,
      });

      await pool.query(
        `UPDATE strategy_configs SET params = $1::jsonb, content_hash = $2 WHERE id = $3`,
        [JSON.stringify(defaults), newHash, row.id]
      );

      console.log(`  ${row.id.substring(0,8)} ${row.strategy_name}/${row.symbol} — updated with ${Object.keys(defaults).length} params`);
      updated++;
    } catch (err) {
      console.log(`  ${row.id.substring(0,8)} ${row.strategy_name} — ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone. Updated ${updated}/${rows.length}`);
  await pool.end();
}
main();
