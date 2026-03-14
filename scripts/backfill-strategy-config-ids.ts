/**
 * Backfill sub_strategy_config_ids for aggregation_configs rows that are
 * missing them.  This is equivalent to what migration 015 does but as a
 * standalone script so it can be re-run safely on production.
 *
 * Usage:
 *   npx tsx scripts/backfill-strategy-config-ids.ts
 */

import { getPool, closeDb } from '../src/data/db.js';
import { findOrCreateStrategyConfig } from '../src/data/strategy-config.js';
import { computeAggregationConfigHash } from '../src/utils/content-hash.js';

interface AggregationRow {
  id: string;
  name: string;
  allocation_mode: string;
  max_positions: number;
  sub_strategies: string | { strategyName: string; symbol: string; timeframe: string; params?: Record<string, unknown> }[];
  sub_strategy_config_ids: string[] | null;
  content_hash: string | null;
}

async function main() {
  const pool = getPool();

  console.log('Fetching aggregation configs with missing sub_strategy_config_ids...');

  const { rows } = await pool.query<AggregationRow>(
    `SELECT id, name, allocation_mode, max_positions, sub_strategies, sub_strategy_config_ids, content_hash
     FROM aggregation_configs
     WHERE sub_strategy_config_ids IS NULL
        OR array_length(sub_strategy_config_ids, 1) IS NULL
     ORDER BY id`
  );

  if (rows.length === 0) {
    console.log('No aggregation configs need backfilling. All done.');
    return;
  }

  console.log(`Found ${rows.length} aggregation config(s) to backfill.`);

  let successCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    const subStrategies = (typeof row.sub_strategies === 'string'
      ? JSON.parse(row.sub_strategies)
      : row.sub_strategies) as { strategyName: string; symbol: string; timeframe: string; params?: Record<string, unknown> }[];

    console.log(`\nProcessing "${row.name}" (${row.id}) — ${subStrategies.length} sub-strategies`);

    try {
      const subStrategyConfigIds: string[] = [];

      for (const sub of subStrategies) {
        const { config: strategyConfig, created } = await findOrCreateStrategyConfig({
          strategyName: sub.strategyName,
          symbol: sub.symbol,
          timeframe: sub.timeframe,
          params: sub.params ?? {},
        });
        console.log(
          `  ${created ? 'Created' : 'Found  '} strategy_config ${strategyConfig.id} (${sub.strategyName} / ${sub.symbol} / ${sub.timeframe})`
        );
        subStrategyConfigIds.push(strategyConfig.id);
      }

      const contentHash = computeAggregationConfigHash({
        allocationMode: row.allocation_mode,
        maxPositions: row.max_positions,
        strategyConfigIds: subStrategyConfigIds,
      });

      await pool.query(
        `UPDATE aggregation_configs
         SET sub_strategy_config_ids = $1,
             content_hash = $2,
             updated_at = $3
         WHERE id = $4`,
        [subStrategyConfigIds, contentHash, Date.now(), row.id]
      );

      console.log(`  Updated aggregation with ${subStrategyConfigIds.length} config IDs, hash=${contentHash.slice(0, 16)}...`);
      successCount++;
    } catch (err) {
      console.error(`  ERROR processing "${row.name}": ${err instanceof Error ? err.message : String(err)}`);
      errorCount++;
    }
  }

  console.log(`\nDone. ${successCount} succeeded, ${errorCount} failed.`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => closeDb());
