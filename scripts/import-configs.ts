#!/usr/bin/env node
/**
 * Import and optionally re-run backtest configurations from a JSON export file
 *
 * Usage:
 *   npx tsx scripts/import-configs.ts --input=file.json [--dry-run]
 *   npx tsx scripts/import-configs.ts --input=best-configurations/ [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { initDb, closeDb, saveBacktestRun } from '../src/data/db.js';
import { parseImportFile } from '../src/core/config-export.js';
import type { ExportedConfig, BacktestConfigExportFile } from '../src/core/config-export-types.js';
import { runBacktest } from '../src/core/engine.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { runPairsBacktest } from '../src/core/pairs-engine.js';
import type { Timeframe } from '../src/core/types.js';
import type { AllocationMode } from '../src/core/signal-types.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  input: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      parsed[match[1]] = match[2];
    } else if (arg.startsWith('--')) {
      parsed[arg.slice(2)] = 'true';
    }
  }

  if (!parsed['input']) {
    console.error('Error: --input is required (e.g., --input=configs.json or --input=configs/)');
    process.exit(1);
  }

  return {
    input: parsed['input'],
    dryRun: parsed['dry-run'] === 'true',
  };
}

// ============================================================================
// Load import files
// ============================================================================

function loadImportFiles(inputPath: string): BacktestConfigExportFile[] {
  const resolved = path.resolve(inputPath);

  if (!fs.existsSync(resolved)) {
    console.error(`Error: Input path does not exist: ${resolved}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolved);

  if (stat.isDirectory()) {
    const jsonFiles = fs.readdirSync(resolved)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(resolved, f));

    if (jsonFiles.length === 0) {
      console.error(`Error: No .json files found in directory: ${resolved}`);
      process.exit(1);
    }

    console.error(`Found ${jsonFiles.length} JSON file(s) in directory`);
    return jsonFiles.map((filePath) => {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return parseImportFile(raw);
    });
  }

  // Single file
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  return [parseImportFile(raw)];
}

// ============================================================================
// Execute a single config
// ============================================================================

async function executeConfig(config: ExportedConfig): Promise<string> {
  if (config.type === 'single') {
    const result = await runBacktest({
      id: uuidv4(),
      strategyName: config.strategyName,
      params: config.params,
      symbol: config.symbol,
      timeframe: config.timeframe as Timeframe,
      startDate: new Date(config.startDate).getTime(),
      endDate: new Date(config.endDate).getTime(),
      initialCapital: config.initialCapital,
      exchange: config.exchange,
      mode: config.mode,
    });
    await saveBacktestRun(result);
    return result.id;
  }

  if (config.type === 'aggregation') {
    const result = await runAggregateBacktest({
      subStrategies: config.subStrategies.map((s) => ({
        strategyName: s.strategyName,
        symbol: s.symbol,
        timeframe: s.timeframe as Timeframe,
        params: s.params,
        exchange: s.exchange ?? config.exchange,
      })),
      allocationMode: config.allocationMode as AllocationMode,
      maxPositions: config.maxPositions,
      initialCapital: config.initialCapital,
      startDate: new Date(config.startDate).getTime(),
      endDate: new Date(config.endDate).getTime(),
      exchange: config.exchange,
      mode: config.mode,
      feeRate: config.feeRate,
      slippagePercent: config.slippagePercent,
    });
    // runAggregateBacktest saves internally (saveResults=true by default)
    return result.id;
  }

  if (config.type === 'pairs') {
    const result = await runPairsBacktest({
      id: uuidv4(),
      strategyName: config.strategyName,
      params: config.params,
      symbolA: config.symbolA,
      symbolB: config.symbolB,
      timeframe: config.timeframe as Timeframe,
      startDate: new Date(config.startDate).getTime(),
      endDate: new Date(config.endDate).getTime(),
      initialCapital: config.initialCapital,
      exchange: config.exchange,
      leverage: 1,
    });
    // pairs engine saves internally
    return result.id;
  }

  throw new Error(`Unknown config type: ${(config as ExportedConfig).type}`);
}

// ============================================================================
// Print config summary table
// ============================================================================

function printSummary(configs: ExportedConfig[]): void {
  console.log(`\nConfigs to import (${configs.length} total):\n`);
  console.log('  #   Type         Strategy / Name                     Symbols                Timeframe  Sharpe');
  console.log('  ─── ──────────── ─────────────────────────────────── ────────────────────── ──────────  ──────');

  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    const num = String(i + 1).padStart(3);
    const type = c.type.padEnd(12);
    const sharpe = c.originalMetrics ? c.originalMetrics.sharpeRatio.toFixed(2) : ' n/a';

    let name: string;
    let symbols: string;
    let timeframe: string;

    if (c.type === 'aggregation') {
      name = (c.name ?? 'Unnamed Aggregation').slice(0, 35).padEnd(35);
      symbols = c.subStrategies.map((s) => s.symbol).join(', ').slice(0, 22).padEnd(22);
      timeframe = [...new Set(c.subStrategies.map((s) => s.timeframe))].join(',').padEnd(10);
    } else if (c.type === 'pairs') {
      name = c.strategyName.slice(0, 35).padEnd(35);
      symbols = `${c.symbolA}/${c.symbolB}`.slice(0, 22).padEnd(22);
      timeframe = c.timeframe.padEnd(10);
    } else {
      name = c.strategyName.slice(0, 35).padEnd(35);
      symbols = c.symbol.slice(0, 22).padEnd(22);
      timeframe = c.timeframe.padEnd(10);
    }

    console.log(`  ${num} ${type} ${name} ${symbols} ${timeframe}  ${sharpe}`);
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { input, dryRun } = parseArgs();

  console.error(`Loading configs from: ${path.resolve(input)}`);
  const importFiles = loadImportFiles(input);

  // Merge all configs from all files
  const allConfigs: ExportedConfig[] = [];
  for (const file of importFiles) {
    allConfigs.push(...file.configs);
  }

  console.error(`\nLoaded ${allConfigs.length} config(s) from ${importFiles.length} file(s)`);
  console.error(`Mode: ${dryRun ? 'DRY RUN (no execution)' : 'EXECUTE'}`);

  // Print summary table to stdout
  printSummary(allConfigs);

  if (dryRun) {
    console.log('Dry run complete. Use without --dry-run to execute the configs.');
    return;
  }

  // Actually run the configs
  await initDb();

  try {
    const results: Array<{
      index: number;
      type: string;
      status: 'success' | 'error';
      runId?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < allConfigs.length; i++) {
      const config = allConfigs[i];
      const label = config.type === 'aggregation'
        ? (config.name ?? 'Unnamed Aggregation')
        : config.type === 'pairs'
          ? `${config.strategyName} ${config.symbolA}/${config.symbolB}`
          : `${config.strategyName} ${config.symbol}`;

      process.stderr.write(`[${i + 1}/${allConfigs.length}] Running ${label}... `);

      try {
        const runId = await executeConfig(config);
        results.push({ index: i, type: config.type, status: 'success', runId });
        process.stderr.write(`OK (${runId})\n`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({ index: i, type: config.type, status: 'error', error: errMsg });
        process.stderr.write(`FAILED: ${errMsg}\n`);
      }
    }

    // Print results summary
    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;

    console.error(`\n=== IMPORT COMPLETE ===`);
    console.error(`Succeeded: ${succeeded}/${results.length}`);
    if (failed > 0) {
      console.error(`Failed:    ${failed}/${results.length}`);
      for (const r of results.filter((r) => r.status === 'error')) {
        console.error(`  [${r.index + 1}] ${r.error}`);
      }
    }

    if (succeeded > 0) {
      console.error('\nNew run IDs:');
      for (const r of results.filter((r) => r.status === 'success')) {
        console.error(`  [${r.index + 1}] ${r.runId}`);
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
