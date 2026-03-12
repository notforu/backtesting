#!/usr/bin/env node
/**
 * Prune Aggregation Configs
 *
 * Runs the 8 saved aggregation configs, identifies poor-performing assets
 * per config, creates pruned clones without those assets, runs the pruned
 * versions, and prints a before/after comparison table.
 *
 * Poor performer criteria (any one of):
 *   - Sharpe ratio < 0
 *   - Total return < 0
 *   - Max drawdown > 50%
 *
 * Usage:
 *   npx tsx scripts/prune-aggregations.ts
 */

import { v4 as uuidv4 } from 'uuid';
import {
  initDb,
  closeDb,
  getAggregationConfigs,
  saveAggregationConfig,
  saveBacktestRun,
  type AggregationConfig,
} from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { AggregateBacktestResult, PerAssetResult } from '../src/core/signal-types.js';
import type { AggregateBacktestConfig } from '../src/core/signal-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunResult {
  config: AggregationConfig;
  result: AggregateBacktestResult;
}

interface ComparisonRow {
  name: string;
  returnBefore: number;
  returnAfter: number;
  sharpeBefore: number;
  sharpeAfter: number;
  maxDDBefore: number;
  maxDDAfter: number;
  assetsRemoved: string[];
}

// ---------------------------------------------------------------------------
// Poor performer detection
// ---------------------------------------------------------------------------

function isPoorPerformer(assetResult: PerAssetResult): boolean {
  const m = assetResult.metrics;
  return (
    m.sharpeRatio < 0 ||
    m.totalReturnPercent < 0 ||
    m.maxDrawdownPercent > 50
  );
}

// ---------------------------------------------------------------------------
// Build AggregateBacktestConfig from a saved AggregationConfig
// ---------------------------------------------------------------------------

function toEngineConfig(
  config: AggregationConfig,
  startDate: number,
  endDate: number,
): AggregateBacktestConfig {
  return {
    subStrategies: config.subStrategies.map((s) => ({
      strategyName: s.strategyName,
      symbol: s.symbol,
      timeframe: s.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
      params: s.params ?? {},
      exchange: s.exchange ?? config.exchange,
    })),
    allocationMode: config.allocationMode as AggregateBacktestConfig['allocationMode'],
    maxPositions: config.maxPositions,
    initialCapital: 10000,
    startDate,
    endDate,
    exchange: config.exchange,
    mode: 'futures',
  };
}

// ---------------------------------------------------------------------------
// Run a single config, print progress, return result (or null on error)
// ---------------------------------------------------------------------------

async function runConfig(
  config: AggregationConfig,
  label: string,
  startDate: number,
  endDate: number,
): Promise<AggregateBacktestResult | null> {
  const engineCfg = toEngineConfig(config, startDate, endDate);
  const t0 = Date.now();
  try {
    const result = await runAggregateBacktest(engineCfg, {
      saveResults: false,
      enableLogging: false,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const m = result.metrics;
    console.log(
      `  ${label} done in ${secs}s` +
      ` | Sharpe ${m.sharpeRatio.toFixed(2)}` +
      ` | Return ${m.totalReturnPercent.toFixed(1)}%` +
      ` | MaxDD ${m.maxDrawdownPercent.toFixed(1)}%` +
      ` | Trades ${m.totalTrades}`,
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${label} FAILED: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const START_DATE = new Date('2024-01-01').getTime();
  const END_DATE = new Date('2026-01-01').getTime();

  console.log('=== PRUNE AGGREGATION CONFIGS ===');
  console.log(`Period: 2024-01-01 to 2026-01-01`);
  console.log('');

  await initDb();

  // ------------------------------------------------------------------
  // Step 1: Load all saved configs
  // ------------------------------------------------------------------

  const configs = await getAggregationConfigs();
  console.log(`Found ${configs.length} saved aggregation config(s).`);
  console.log('');

  if (configs.length === 0) {
    console.log('No configs found. Exiting.');
    await closeDb();
    return;
  }

  // ------------------------------------------------------------------
  // Step 2: Run all configs as baseline
  // ------------------------------------------------------------------

  console.log('--- STEP 1/4: Running baseline configs ---');
  console.log('');

  const baselineRuns: RunResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    console.log(`[${i + 1}/${configs.length}] ${config.name}`);
    console.log(
      `  mode=${config.allocationMode}, maxPos=${config.maxPositions}, ` +
      `subStrategies=${config.subStrategies.length}`,
    );

    const result = await runConfig(config, 'Baseline', START_DATE, END_DATE);
    if (result !== null) {
      await saveBacktestRun(result, config.id);
      baselineRuns.push({ config, result });
    }
    console.log('');
  }

  // ------------------------------------------------------------------
  // Step 3: Identify poor performers and create pruned configs
  // ------------------------------------------------------------------

  console.log('--- STEP 2/4: Analyzing per-asset results ---');
  console.log('');

  interface PruneCandidate {
    original: RunResult;
    prunedConfig: AggregationConfig;
    removedSymbols: string[];
  }

  const pruneCandidates: PruneCandidate[] = [];

  for (const run of baselineRuns) {
    const { config, result } = run;
    const perAsset = result.perAssetResults;

    const poorSymbols: string[] = [];
    for (const [symbol, assetResult] of Object.entries(perAsset)) {
      if (isPoorPerformer(assetResult)) {
        const m = assetResult.metrics;
        poorSymbols.push(symbol);
        console.log(
          `  ${config.name} | POOR: ${symbol}` +
          ` | Sharpe ${m.sharpeRatio.toFixed(2)}` +
          ` | Return ${m.totalReturnPercent.toFixed(1)}%` +
          ` | MaxDD ${m.maxDrawdownPercent.toFixed(1)}%`,
        );
      }
    }

    if (poorSymbols.length === 0) {
      console.log(`  ${config.name} | No poor performers — skipping pruning`);
      continue;
    }

    // Build pruned sub-strategies (remove poor performers)
    const prunedSubStrategies = config.subStrategies.filter(
      (s) => !poorSymbols.includes(s.symbol),
    );

    if (prunedSubStrategies.length === 0) {
      console.log(
        `  ${config.name} | All assets are poor performers — cannot prune to empty config, skipping`,
      );
      continue;
    }

    // Cap maxPositions to number of remaining assets
    const prunedMaxPositions = Math.min(config.maxPositions, prunedSubStrategies.length);

    const prunedConfig: AggregationConfig = {
      id: uuidv4(),
      name: `${config.name} (Pruned)`,
      allocationMode: config.allocationMode,
      maxPositions: prunedMaxPositions,
      subStrategies: prunedSubStrategies,
      subStrategyConfigIds: [],
      initialCapital: 10000,
      exchange: config.exchange,
      mode: 'futures',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    pruneCandidates.push({
      original: run,
      prunedConfig,
      removedSymbols: poorSymbols,
    });
  }

  console.log('');

  if (pruneCandidates.length === 0) {
    console.log('No configs have poor performers. Nothing to prune. Exiting.');
    await closeDb();
    return;
  }

  // ------------------------------------------------------------------
  // Step 4: Save pruned configs to DB
  // ------------------------------------------------------------------

  console.log('--- STEP 3/4: Saving pruned configs ---');
  console.log('');

  for (const candidate of pruneCandidates) {
    await saveAggregationConfig(candidate.prunedConfig);
    console.log(
      `  Saved "${candidate.prunedConfig.name}"` +
      ` (${candidate.prunedConfig.subStrategies.length} assets,` +
      ` maxPos=${candidate.prunedConfig.maxPositions})` +
      ` — removed: ${candidate.removedSymbols.join(', ')}`,
    );
  }

  console.log('');

  // ------------------------------------------------------------------
  // Step 5: Run pruned configs
  // ------------------------------------------------------------------

  console.log('--- STEP 4/4: Running pruned configs ---');
  console.log('');

  interface PrunedRunResult {
    candidate: PruneCandidate;
    result: AggregateBacktestResult | null;
  }

  const prunedRuns: PrunedRunResult[] = [];

  for (let i = 0; i < pruneCandidates.length; i++) {
    const candidate = pruneCandidates[i];
    const cfg = candidate.prunedConfig;
    console.log(`[${i + 1}/${pruneCandidates.length}] ${cfg.name}`);
    console.log(
      `  mode=${cfg.allocationMode}, maxPos=${cfg.maxPositions}, ` +
      `subStrategies=${cfg.subStrategies.length}`,
    );

    const result = await runConfig(cfg, 'Pruned', START_DATE, END_DATE);
    if (result !== null) {
      await saveBacktestRun(result, cfg.id);
    }
    prunedRuns.push({ candidate, result });
    console.log('');
  }

  // ------------------------------------------------------------------
  // Step 6: Build and print comparison table
  // ------------------------------------------------------------------

  console.log('');
  console.log('='.repeat(130));
  console.log('COMPARISON TABLE');
  console.log('='.repeat(130));

  const header = [
    'Config Name'.padEnd(52),
    'Return% (before)'.padStart(17),
    'Return% (after)'.padStart(16),
    'Sharpe (before)'.padStart(16),
    'Sharpe (after)'.padStart(15),
    'MaxDD (before)'.padStart(15),
    'MaxDD (after)'.padStart(14),
    'Assets Removed',
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(130));

  const comparisonRows: ComparisonRow[] = [];

  for (const pr of prunedRuns) {
    const { candidate, result: prunedResult } = pr;
    const origMetrics = candidate.original.result.metrics;
    const origName = candidate.original.config.name;

    if (prunedResult === null) {
      const row: ComparisonRow = {
        name: origName,
        returnBefore: origMetrics.totalReturnPercent,
        returnAfter: NaN,
        sharpeBefore: origMetrics.sharpeRatio,
        sharpeAfter: NaN,
        maxDDBefore: origMetrics.maxDrawdownPercent,
        maxDDAfter: NaN,
        assetsRemoved: candidate.removedSymbols,
      };
      comparisonRows.push(row);
    } else {
      const pm = prunedResult.metrics;
      const row: ComparisonRow = {
        name: origName,
        returnBefore: origMetrics.totalReturnPercent,
        returnAfter: pm.totalReturnPercent,
        sharpeBefore: origMetrics.sharpeRatio,
        sharpeAfter: pm.sharpeRatio,
        maxDDBefore: origMetrics.maxDrawdownPercent,
        maxDDAfter: pm.maxDrawdownPercent,
        assetsRemoved: candidate.removedSymbols,
      };
      comparisonRows.push(row);
    }
  }

  for (const row of comparisonRows) {
    const fmtNum = (n: number, decimals: number): string =>
      isNaN(n) ? 'N/A' : n.toFixed(decimals);

    const line = [
      row.name.slice(0, 52).padEnd(52),
      fmtNum(row.returnBefore, 1).padStart(17),
      fmtNum(row.returnAfter, 1).padStart(16),
      fmtNum(row.sharpeBefore, 2).padStart(16),
      fmtNum(row.sharpeAfter, 2).padStart(15),
      fmtNum(row.maxDDBefore, 1).padStart(15),
      fmtNum(row.maxDDAfter, 1).padStart(14),
      `  ${row.assetsRemoved.join(', ')}`,
    ].join('  ');
    console.log(line);
  }

  console.log('-'.repeat(130));
  console.log(`Processed: ${pruneCandidates.length} config(s) with poor performers`);
  console.log('='.repeat(130));

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb().catch(() => {});
  process.exit(1);
});
