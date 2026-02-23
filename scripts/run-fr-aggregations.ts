#!/usr/bin/env node
/**
 * Run FR Spike Aggregation Backtests
 *
 * Loads aggregation configs from the database and runs them sequentially,
 * saving results linked to the aggregation config via aggregationId.
 *
 * Usage:
 *   npx tsx scripts/run-fr-aggregations.ts
 *   npx tsx scripts/run-fr-aggregations.ts --from=2024-01-01 --to=2026-02-22
 *   npx tsx scripts/run-fr-aggregations.ts --ids=id1,id2
 */

import { getAggregationConfigs, saveBacktestRun, closeDb, initDb } from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { AggregateBacktestConfig } from '../src/core/signal-types.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        result[arg.slice(2)] = 'true';
      }
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const from = args.from ?? '2024-01-01';
  const to = args.to ?? '2026-02-22';
  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();

  const filterIds: string[] | null = args.ids
    ? args.ids.split(',').map((id) => id.trim()).filter(Boolean)
    : null;

  console.log('=== RUN FR AGGREGATIONS ===');
  console.log(`Period: ${from} to ${to}`);
  if (filterIds) {
    console.log(`Filtering to IDs: ${filterIds.join(', ')}`);
  }
  console.log('');

  await initDb();

  let configs = await getAggregationConfigs();

  if (filterIds) {
    configs = configs.filter((c) => filterIds.includes(c.id));
    if (configs.length === 0) {
      console.error('No matching aggregation configs found for the provided IDs.');
      await closeDb();
      process.exit(1);
    }
    if (configs.length < filterIds.length) {
      const foundIds = configs.map((c) => c.id);
      const missing = filterIds.filter((id) => !foundIds.includes(id));
      console.warn(`Warning: Could not find configs for IDs: ${missing.join(', ')}`);
    }
  }

  if (configs.length === 0) {
    console.error('No aggregation configs found in the database.');
    await closeDb();
    process.exit(1);
  }

  console.log(`Found ${configs.length} aggregation config(s) to run.\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const label = `[${i + 1}/${configs.length}] ${config.name} (${config.id})`;

    console.log(`${label} - Starting...`);

    try {
      const aggregateConfig: AggregateBacktestConfig = {
        subStrategies: config.subStrategies.map((s) => ({
          strategyName: s.strategyName,
          symbol: s.symbol,
          timeframe: s.timeframe as any,
          params: s.params ?? {},
          exchange: s.exchange ?? config.exchange,
        })),
        allocationMode: config.allocationMode as any,
        maxPositions: config.maxPositions,
        initialCapital: config.initialCapital,
        startDate,
        endDate,
        exchange: config.exchange,
        mode: config.mode as 'spot' | 'futures',
      };

      const startTime = Date.now();
      const result = await runAggregateBacktest(aggregateConfig, {
        saveResults: false,
        enableLogging: true,
      });
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      await saveBacktestRun(result, config.id);

      const m = result.metrics;
      console.log(
        `${label} - Done in ${duration}s` +
        ` | Sharpe ${m.sharpeRatio.toFixed(2)}` +
        ` | Return ${m.totalReturnPercent.toFixed(2)}%` +
        ` | MaxDD ${m.maxDrawdownPercent.toFixed(2)}%` +
        ` | Trades ${m.totalTrades}`
      );
      succeeded++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${label} - FAILED: ${msg}`);
      failed++;
    }

    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${configs.length}`);

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
