/**
 * Script: create-configs-from-standalone.ts
 *
 * Creates aggregation configs from the best standalone backtest runs.
 * For each unique run (by symbol set + allocation mode + maxPositions), creates:
 *   1. An "Auto" config with all original sub-strategies
 *   2. A "Auto Pruned" config with poor-performing assets removed (if any)
 *
 * Usage:
 *   node --import tsx/esm scripts/create-configs-from-standalone.ts
 */

import { v4 as uuidv4 } from 'uuid';
import {
  initDb,
  getPool,
  saveAggregationConfig,
  getAggregationConfigs,
  type AggregationConfig,
} from '../src/data/db.js';

// ============================================================================
// Types
// ============================================================================

interface SubStrategy {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
  exchange?: string;
}

interface StandaloneRunConfig {
  strategyName: string;
  mode: string;
  exchange: string;
  initialCapital: number;
  startDate: number;
  endDate: number;
  params: {
    maxPositions: number;
    allocationMode: string;
    subStrategies: SubStrategy[];
  };
}

interface PerAssetMetrics {
  sharpeRatio: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  profitFactor: number;
}

interface PerAssetEntry {
  metrics: PerAssetMetrics;
  trades?: unknown[];
  equity?: unknown[];
}

interface StandaloneRunMetrics {
  sharpeRatio: number;
  totalReturnPercent?: number;
  maxDrawdownPercent?: number;
  [key: string]: unknown;
}

interface StandaloneRun {
  id: string;
  config: StandaloneRunConfig;
  metrics: StandaloneRunMetrics;
  per_asset_results: Record<string, PerAssetEntry>;
}

// ============================================================================
// Query
// ============================================================================

async function queryTopStandaloneRuns(): Promise<StandaloneRun[]> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    config: unknown;
    metrics: unknown;
    per_asset_results: unknown;
  }>(
    `SELECT id, config, metrics, per_asset_results
     FROM backtest_runs
     WHERE per_asset_results IS NOT NULL
       AND aggregation_id IS NULL
       AND strategy_name = 'aggregation'
       AND (metrics->>'sharpeRatio')::float >= 1.5
     ORDER BY (metrics->>'sharpeRatio')::float DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    config: row.config as StandaloneRunConfig,
    metrics: row.metrics as StandaloneRunMetrics,
    per_asset_results: row.per_asset_results as Record<string, PerAssetEntry>,
  }));
}

// ============================================================================
// De-duplication
// ============================================================================

/**
 * Generate a canonical key for a run based on (sorted symbols, allocation mode, maxPositions).
 */
function runKey(run: StandaloneRun): string {
  const params = run.config.params;
  const symbols = params.subStrategies
    .map((s) => s.symbol)
    .sort()
    .join(',');
  return `${params.allocationMode}|${params.maxPositions}|${symbols}`;
}

/**
 * Deduplicate runs by their canonical key, keeping the best Sharpe per group.
 */
function deduplicateRuns(runs: StandaloneRun[]): StandaloneRun[] {
  const best = new Map<string, StandaloneRun>();
  for (const run of runs) {
    const key = runKey(run);
    const existing = best.get(key);
    if (!existing || run.metrics.sharpeRatio > existing.metrics.sharpeRatio) {
      best.set(key, run);
    }
  }
  return Array.from(best.values());
}

// ============================================================================
// Config name helpers
// ============================================================================

function formatSharpe(sharpe: number): string {
  return sharpe.toFixed(2);
}

function originalConfigName(run: StandaloneRun, assetCount: number): string {
  const { allocationMode, maxPositions } = run.config.params;
  const sharpe = formatSharpe(run.metrics.sharpeRatio);
  return `Auto: ${allocationMode} ${maxPositions}pos ${assetCount}assets Sharpe${sharpe}`;
}

function prunedConfigName(run: StandaloneRun, remainingAssets: number): string {
  const { allocationMode, maxPositions } = run.config.params;
  const sharpe = formatSharpe(run.metrics.sharpeRatio);
  return `Auto Pruned: ${allocationMode} ${maxPositions}pos ${remainingAssets}assets Sharpe${sharpe}`;
}

// ============================================================================
// Asset quality check
// ============================================================================

interface PruneReason {
  symbol: string;
  reasons: string[];
}

function assessAssetQuality(
  symbol: string,
  metrics: PerAssetMetrics
): PruneReason | null {
  const reasons: string[] = [];

  if (metrics.sharpeRatio < 0) {
    reasons.push(`sharpeRatio=${metrics.sharpeRatio.toFixed(3)} < 0`);
  }
  if (metrics.totalReturnPercent < 0) {
    reasons.push(`totalReturnPercent=${metrics.totalReturnPercent.toFixed(2)}% < 0`);
  }
  if (metrics.maxDrawdownPercent > 50) {
    reasons.push(`maxDrawdownPercent=${metrics.maxDrawdownPercent.toFixed(2)}% > 50%`);
  }

  return reasons.length > 0 ? { symbol, reasons } : null;
}

// ============================================================================
// Main logic
// ============================================================================

async function main(): Promise<void> {
  console.log('Initializing database...');
  await initDb();

  console.log('Querying top standalone runs (Sharpe >= 1.5)...');
  const allRuns = await queryTopStandaloneRuns();
  console.log(`Found ${allRuns.length} qualifying runs.`);

  if (allRuns.length === 0) {
    console.log('No runs found. Exiting.');
    process.exit(0);
  }

  const uniqueRuns = deduplicateRuns(allRuns);
  console.log(`After deduplication: ${uniqueRuns.length} unique combinations.\n`);

  // Load existing configs to avoid duplicates
  const existingConfigs = await getAggregationConfigs();
  const existingNames = new Set(existingConfigs.map((c) => c.name));
  console.log(`Existing aggregation configs: ${existingConfigs.length}\n`);

  let created = 0;
  let skipped = 0;

  for (const run of uniqueRuns) {
    const params = run.config.params;
    const subStrategies = params.subStrategies;
    const assetCount = subStrategies.length;

    console.log(
      `Processing run ${run.id} — Sharpe=${run.metrics.sharpeRatio.toFixed(3)}, ` +
        `${assetCount} assets, mode=${params.allocationMode}, maxPos=${params.maxPositions}`
    );

    // -------------------------------------------------------------------------
    // 1. Original config
    // -------------------------------------------------------------------------
    const origName = originalConfigName(run, assetCount);

    if (existingNames.has(origName)) {
      console.log(`  [SKIP] "${origName}" already exists.`);
      skipped++;
    } else {
      const now = Date.now();
      const origConfig: AggregationConfig = {
        id: uuidv4(),
        name: origName,
        allocationMode: params.allocationMode,
        maxPositions: params.maxPositions,
        subStrategies: subStrategies.map((s) => ({
          strategyName: s.strategyName,
          symbol: s.symbol,
          timeframe: s.timeframe,
          params: s.params ?? {},
          exchange: s.exchange ?? run.config.exchange,
        })),
        subStrategyConfigIds: [],
        initialCapital: run.config.initialCapital ?? 10000,
        exchange: run.config.exchange ?? 'bybit',
        mode: run.config.mode ?? 'futures',
        createdAt: now,
        updatedAt: now,
      };

      await saveAggregationConfig(origConfig);
      existingNames.add(origName);
      created++;

      console.log(
        `  [CREATED] "${origName}" — ${assetCount} assets, ` +
          `allocationMode=${params.allocationMode}, maxPositions=${params.maxPositions}`
      );
    }

    // -------------------------------------------------------------------------
    // 2. Pruned config
    // -------------------------------------------------------------------------

    // Assess each asset
    const prunedReasons: PruneReason[] = [];
    const passingSubStrategies: SubStrategy[] = [];

    for (const subStrat of subStrategies) {
      const assetResult = run.per_asset_results[subStrat.symbol];
      if (!assetResult) {
        // No per-asset data — keep it (can't assess)
        passingSubStrategies.push(subStrat);
        continue;
      }

      const pruneReason = assessAssetQuality(subStrat.symbol, assetResult.metrics);
      if (pruneReason) {
        prunedReasons.push(pruneReason);
      } else {
        passingSubStrategies.push(subStrat);
      }
    }

    if (prunedReasons.length === 0) {
      // All assets pass quality thresholds — no pruned version needed
      console.log(`  [SKIP PRUNED] All ${assetCount} assets pass quality thresholds.`);
    } else {
      // Determine effective maxPositions for pruned config
      const effectiveMaxPositions = Math.min(
        params.maxPositions,
        passingSubStrategies.length
      );

      if (passingSubStrategies.length === 0) {
        console.log(`  [SKIP PRUNED] All assets were pruned — no assets remaining.`);
      } else {
        const prunedName = prunedConfigName(run, passingSubStrategies.length);

        if (existingNames.has(prunedName)) {
          console.log(`  [SKIP] "${prunedName}" already exists.`);
          skipped++;
        } else {
          const now = Date.now();
          const prunedConfig: AggregationConfig = {
            id: uuidv4(),
            name: prunedName,
            allocationMode: params.allocationMode,
            maxPositions: effectiveMaxPositions,
            subStrategies: passingSubStrategies.map((s) => ({
              strategyName: s.strategyName,
              symbol: s.symbol,
              timeframe: s.timeframe,
              params: s.params ?? {},
              exchange: s.exchange ?? run.config.exchange,
            })),
            subStrategyConfigIds: [],
            initialCapital: run.config.initialCapital ?? 10000,
            exchange: run.config.exchange ?? 'bybit',
            mode: run.config.mode ?? 'futures',
            createdAt: now,
            updatedAt: now,
          };

          await saveAggregationConfig(prunedConfig);
          existingNames.add(prunedName);
          created++;

          console.log(
            `  [CREATED] "${prunedName}" — ${passingSubStrategies.length} assets ` +
              `(removed ${prunedReasons.length}), maxPositions=${effectiveMaxPositions}`
          );

          // Print removed assets
          for (const removed of prunedReasons) {
            console.log(
              `    Removed ${removed.symbol}: ${removed.reasons.join(', ')}`
            );
          }
        }
      }
    }

    console.log();
  }

  console.log('='.repeat(60));
  console.log(`Summary: ${created} configs created, ${skipped} skipped (already existed).`);

  // Close pool
  const pool = getPool();
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
