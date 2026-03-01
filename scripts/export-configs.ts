#!/usr/bin/env node
/**
 * Export backtest run configurations to a portable JSON file
 *
 * Usage:
 *   npx tsx scripts/export-configs.ts --ids=id1,id2,id3 --output=file.json
 *   npx tsx scripts/export-configs.ts --strategy=funding-rate-spike --min-sharpe=1.0 --output=file.json
 *   npx tsx scripts/export-configs.ts --all --output=file.json
 */

import fs from 'fs';
import path from 'path';
import { initDb, closeDb, getBacktestRunsByIds, getBacktestRunIds } from '../src/data/db.js';
import { extractExportConfig, buildExportFile } from '../src/core/config-export.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  ids?: string[];
  strategy?: string;
  minSharpe?: number;
  all: boolean;
  output: string;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      parsed[match[1]] = match[2];
    } else if (arg.startsWith('--')) {
      // Flag without value (e.g. --all)
      parsed[arg.slice(2)] = 'true';
    }
  }

  if (!parsed['output']) {
    console.error('Error: --output is required (e.g., --output=configs.json)');
    process.exit(1);
  }

  const hasSomeSource = parsed['ids'] || parsed['strategy'] || parsed['all'];
  if (!hasSomeSource) {
    console.error('Error: specify at least one of --ids=..., --strategy=..., or --all');
    process.exit(1);
  }

  return {
    ids: parsed['ids'] ? parsed['ids'].split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    strategy: parsed['strategy'],
    minSharpe: parsed['min-sharpe'] ? parseFloat(parsed['min-sharpe']) : undefined,
    all: parsed['all'] === 'true',
    output: parsed['output'],
  };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { ids, strategy, minSharpe, all, output } = parseArgs();

  await initDb();

  try {
    let runIds: string[];

    if (ids && ids.length > 0) {
      // Explicit ID list
      runIds = ids;
      console.error(`Exporting ${runIds.length} run(s) by ID`);
    } else {
      // Query from DB
      const filters: { strategy?: string; minSharpe?: number } = {};
      if (strategy) filters.strategy = strategy;
      if (minSharpe != null) filters.minSharpe = minSharpe;

      runIds = await getBacktestRunIds(all ? undefined : filters);

      if (strategy || minSharpe != null) {
        console.error(`Found ${runIds.length} run(s) matching filters`);
      } else {
        console.error(`Exporting all ${runIds.length} run(s)`);
      }
    }

    if (runIds.length === 0) {
      console.error('No runs found matching the specified criteria');
      process.exit(0);
    }

    // Fetch rows with joined aggregation_configs data
    const rows = await getBacktestRunsByIds(runIds);
    console.error(`Loaded ${rows.length} run(s) from database`);

    // Convert each row to an ExportedConfig
    const configs = rows.map(extractExportConfig);

    // Build the export file
    const exportFile = buildExportFile(configs);

    // Write to output file
    const outputPath = path.resolve(output);
    fs.writeFileSync(outputPath, JSON.stringify(exportFile, null, 2), 'utf-8');

    console.error(`\nExported ${configs.length} config(s) to: ${outputPath}`);
    console.error('');

    // Print a summary table
    console.error('Summary:');
    for (const config of configs) {
      if (config.type === 'single') {
        const m = config.originalMetrics;
        const sharpe = m ? m.sharpeRatio.toFixed(2) : 'n/a';
        console.error(`  [single]       ${config.strategyName} | ${config.symbol} ${config.timeframe} | Sharpe: ${sharpe}`);
      } else if (config.type === 'aggregation') {
        const m = config.originalMetrics;
        const sharpe = m ? m.sharpeRatio.toFixed(2) : 'n/a';
        const name = config.name ?? 'Unnamed';
        console.error(`  [aggregation]  ${name} | ${config.subStrategies.length} sub-strategies | Sharpe: ${sharpe}`);
      } else if (config.type === 'pairs') {
        const m = config.originalMetrics;
        const sharpe = m ? m.sharpeRatio.toFixed(2) : 'n/a';
        console.error(`  [pairs]        ${config.strategyName} | ${config.symbolA}/${config.symbolB} ${config.timeframe} | Sharpe: ${sharpe}`);
      }
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
