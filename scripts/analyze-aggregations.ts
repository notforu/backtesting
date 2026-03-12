#!/usr/bin/env node
/**
 * Analyze Aggregation Backtest Results
 *
 * Reads all aggregation configs and their latest backtest runs from the database.
 * For each aggregation with perAssetResults, prints:
 *   - Overall metrics
 *   - Per-asset table sorted by Sharpe ratio
 *   - Highlighted poor performers (Sharpe < 0, negative return, or MaxDD > 50%)
 *   - Theoretical improvement if poor performers were removed
 *
 * At the end, prints a summary with removal recommendations.
 *
 * Usage:
 *   npx tsx scripts/analyze-aggregations.ts
 */

import { initDb, closeDb, getAggregationConfigs, getPool } from '../src/data/db.js';
import type { PerAssetResult } from '../src/core/signal-types.js';
import type { PerformanceMetrics } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Terminal color helpers (no dependencies)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function red(s: string): string { return `${RED}${s}${RESET}`; }
function yellow(s: string): string { return `${YELLOW}${s}${RESET}`; }
function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function cyan(s: string): string { return `${CYAN}${s}${RESET}`; }
function bold(s: string): string { return `${BOLD}${s}${RESET}`; }
function dim(s: string): string { return `${DIM}${s}${RESET}`; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function pad(s: string, width: number): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for width calc
  const padding = Math.max(0, width - plain.length);
  return s + ' '.repeat(padding);
}

function rpad(s: string, width: number): string {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - plain.length);
  return ' '.repeat(padding) + s;
}

function separator(char: string, width: number): string {
  return char.repeat(width);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AggregationRun {
  id: string;
  aggregationId: string | null;
  strategyName: string;
  metrics: PerformanceMetrics;
  perAssetResults: Record<string, PerAssetResult> | null;
  createdAt: number;
}

interface AssetRow {
  key: string;      // e.g. "LDO/USDT:USDT 4h"
  symbol: string;
  returnPct: number;
  sharpe: number;
  maxDDPct: number;
  trades: number;
  profitFactor: number;
  fundingIncome: number;
  isPoor: boolean;
  poorReasons: string[];
}

interface RemovalRecommendation {
  aggregationName: string;
  assets: string[];
  currentSharpe: number;
  currentReturn: number;
  currentMaxDD: number;
}

// ---------------------------------------------------------------------------
// Query: get latest backtest run for each aggregation
// ---------------------------------------------------------------------------

async function getLatestRunsForAggregations(): Promise<AggregationRun[]> {
  const pool = getPool();

  // Get the most recent backtest run for each aggregation_id that has per_asset_results
  const { rows } = await pool.query<{
    id: string;
    aggregation_id: string | null;
    strategy_name: string;
    metrics: unknown;
    per_asset_results: unknown;
    created_at: string;
  }>(`
    SELECT DISTINCT ON (COALESCE(aggregation_id, id))
      id,
      aggregation_id,
      strategy_name,
      metrics,
      per_asset_results,
      created_at
    FROM backtest_runs
    WHERE per_asset_results IS NOT NULL
    ORDER BY COALESCE(aggregation_id, id), created_at DESC
  `);

  return rows.map((row) => {
    const metrics = (typeof row.metrics === 'string'
      ? JSON.parse(row.metrics)
      : row.metrics) as PerformanceMetrics;

    const perAssetResults = row.per_asset_results != null
      ? (typeof row.per_asset_results === 'string'
        ? JSON.parse(row.per_asset_results)
        : row.per_asset_results) as Record<string, PerAssetResult>
      : null;

    return {
      id: row.id,
      aggregationId: row.aggregation_id,
      strategyName: row.strategy_name,
      metrics,
      perAssetResults,
      createdAt: Number(row.created_at),
    };
  });
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

function buildAssetRows(perAssetResults: Record<string, PerAssetResult>): AssetRow[] {
  return Object.entries(perAssetResults).map(([key, par]) => {
    const m = par.metrics;
    const returnPct = m.totalReturnPercent ?? 0;
    const sharpe = m.sharpeRatio ?? 0;
    const maxDDPct = m.maxDrawdownPercent ?? 0;
    const trades = m.totalTrades ?? 0;
    const profitFactor = m.profitFactor ?? 0;
    const fundingIncome = par.fundingIncome ?? 0;

    const poorReasons: string[] = [];
    if (sharpe < 0) poorReasons.push('Sharpe<0');
    if (returnPct < 0) poorReasons.push('Return<0');
    if (maxDDPct > 50) poorReasons.push('MaxDD>50%');

    return {
      key,
      symbol: par.symbol ?? key,
      returnPct,
      sharpe,
      maxDDPct,
      trades,
      profitFactor,
      fundingIncome,
      isPoor: poorReasons.length > 0,
      poorReasons,
    };
  });
}

/**
 * Naive theoretical improvement estimate if poor performers are excluded.
 * Since the aggregate engine trades each asset independently and then merges
 * the equity, a rough proxy is: sum of per-asset returns, weighted equally,
 * excluding the poor performers. We compare the average asset-level Sharpe
 * with vs without the poor performers.
 *
 * Note: This is a rough proxy — true improvement requires a re-run, because
 * the portfolio-level metrics depend on the allocation engine's behaviour.
 */
function theoreticalImprovement(rows: AssetRow[]): {
  goodCount: number;
  poorCount: number;
  avgSharpeAll: number;
  avgSharpeGood: number;
  avgReturnAll: number;
  avgReturnGood: number;
  avgMaxDDAll: number;
  avgMaxDDGood: number;
} {
  const good = rows.filter((r) => !r.isPoor);
  const avg = (arr: number[]): number =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    goodCount: good.length,
    poorCount: rows.length - good.length,
    avgSharpeAll: avg(rows.map((r) => r.sharpe)),
    avgSharpeGood: avg(good.map((r) => r.sharpe)),
    avgReturnAll: avg(rows.map((r) => r.returnPct)),
    avgReturnGood: avg(good.map((r) => r.returnPct)),
    avgMaxDDAll: avg(rows.map((r) => r.maxDDPct)),
    avgMaxDDGood: avg(good.map((r) => r.maxDDPct)),
  };
}

// ---------------------------------------------------------------------------
// Printing helpers
// ---------------------------------------------------------------------------

const COL_WIDTHS = {
  asset: 28,
  returnPct: 10,
  sharpe: 8,
  maxDD: 9,
  trades: 7,
  pf: 8,
  funding: 11,
  flags: 20,
};

const TABLE_WIDTH =
  COL_WIDTHS.asset + COL_WIDTHS.returnPct + COL_WIDTHS.sharpe +
  COL_WIDTHS.maxDD + COL_WIDTHS.trades + COL_WIDTHS.pf +
  COL_WIDTHS.funding + COL_WIDTHS.flags + 8; // separators

function printTableHeader(): void {
  console.log(
    bold(pad('Asset (symbol tf)', COL_WIDTHS.asset)) +
    bold(rpad('Return%', COL_WIDTHS.returnPct)) +
    bold(rpad('Sharpe', COL_WIDTHS.sharpe)) +
    bold(rpad('MaxDD%', COL_WIDTHS.maxDD)) +
    bold(rpad('Trades', COL_WIDTHS.trades)) +
    bold(rpad('ProfFac', COL_WIDTHS.pf)) +
    bold(rpad('Funding$', COL_WIDTHS.funding)) +
    bold(pad('  Flags', COL_WIDTHS.flags)),
  );
  console.log(dim(separator('-', TABLE_WIDTH)));
}

function printAssetRow(row: AssetRow): void {
  const assetLabel = row.key.length > COL_WIDTHS.asset - 2
    ? row.key.slice(0, COL_WIDTHS.asset - 3) + '…'
    : row.key;

  const colorize = (s: string): string => row.isPoor ? red(s) : s;

  const returnStr = fmtPct(row.returnPct);
  const sharpeStr = fmt(row.sharpe);
  const maxDDStr = `${row.maxDDPct.toFixed(1)}%`;
  const tradesStr = String(row.trades);
  const pfStr = row.profitFactor > 0 ? fmt(row.profitFactor) : 'n/a';
  const fundingStr = `$${row.fundingIncome.toFixed(0)}`;
  const flagsStr = row.isPoor ? `** ${row.poorReasons.join(', ')} **` : '';

  console.log(
    colorize(pad(assetLabel, COL_WIDTHS.asset)) +
    colorize(rpad(returnStr, COL_WIDTHS.returnPct)) +
    colorize(rpad(sharpeStr, COL_WIDTHS.sharpe)) +
    colorize(rpad(maxDDStr, COL_WIDTHS.maxDD)) +
    colorize(rpad(tradesStr, COL_WIDTHS.trades)) +
    colorize(rpad(pfStr, COL_WIDTHS.pf)) +
    colorize(rpad(fundingStr, COL_WIDTHS.funding)) +
    colorize(pad('  ' + flagsStr, COL_WIDTHS.flags)),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await initDb();

  console.log('');
  console.log(bold(cyan('=== AGGREGATION BACKTEST ANALYSIS ===')));
  console.log(dim(`Loaded at: ${new Date().toLocaleString()}`));
  console.log('');

  // Load all aggregation configs (for name lookup)
  const configs = await getAggregationConfigs();
  const configMap = new Map(configs.map((c) => [c.id, c.name]));

  // Load latest run per aggregation
  const runs = await getLatestRunsForAggregations();

  if (runs.length === 0) {
    console.log(yellow('No aggregation backtest runs found in database.'));
    await closeDb();
    return;
  }

  console.log(`Found ${bold(String(runs.length))} aggregation run(s) with per-asset results.\n`);

  // Track summary data
  let totalAnalyzed = 0;
  const suspiciousHighROI: string[] = [];
  const removalRecommendations: RemovalRecommendation[] = [];

  for (const run of runs) {
    const aggName = run.aggregationId
      ? (configMap.get(run.aggregationId) ?? `Unknown (${run.aggregationId.slice(0, 8)})`)
      : `Standalone run ${run.id.slice(0, 8)}`;

    if (!run.perAssetResults) {
      continue;
    }

    totalAnalyzed++;

    const m = run.metrics;
    const returnPct = m.totalReturnPercent ?? 0;
    const sharpe = m.sharpeRatio ?? 0;
    const maxDDPct = m.maxDrawdownPercent ?? 0;
    const totalTrades = m.totalTrades ?? 0;
    const fundingIncome = (m as Record<string, unknown>).totalFundingIncome;
    const fundingUsd = typeof fundingIncome === 'number' ? fundingIncome : 0;
    const runDate = new Date(run.createdAt).toLocaleDateString();

    const isSuspicious = returnPct > 10000;
    if (isSuspicious) suspiciousHighROI.push(aggName);

    // Header
    console.log(separator('=', TABLE_WIDTH));
    const headerPrefix = isSuspicious ? red('[SUSPICIOUS] ') : '';
    console.log(bold(`${headerPrefix}${aggName}`));
    console.log(dim(`  Run ID: ${run.id}  |  Date: ${runDate}`));
    console.log('');

    // Overall metrics line
    const returnLabel = isSuspicious
      ? red(`Return: ${fmtPct(returnPct)}`)
      : (returnPct >= 0 ? green(`Return: ${fmtPct(returnPct)}`) : red(`Return: ${fmtPct(returnPct)}`));

    const sharpeLabel = sharpe >= 1
      ? green(`Sharpe: ${fmt(sharpe)}`)
      : (sharpe >= 0 ? yellow(`Sharpe: ${fmt(sharpe)}`) : red(`Sharpe: ${fmt(sharpe)}`));

    const maxDDLabel = maxDDPct > 50
      ? red(`MaxDD: ${maxDDPct.toFixed(1)}%`)
      : (maxDDPct > 25 ? yellow(`MaxDD: ${maxDDPct.toFixed(1)}%`) : green(`MaxDD: ${maxDDPct.toFixed(1)}%`));

    console.log(
      `  Overall:  ${returnLabel}   ${sharpeLabel}   ${maxDDLabel}   Trades: ${totalTrades}   Funding: $${fundingUsd.toFixed(0)}`,
    );
    console.log('');

    // Build and sort per-asset rows
    const assetRows = buildAssetRows(run.perAssetResults)
      .sort((a, b) => b.sharpe - a.sharpe);

    printTableHeader();
    for (const row of assetRows) {
      printAssetRow(row);
    }
    console.log(dim(separator('-', TABLE_WIDTH)));

    // Poor performer summary
    const poorRows = assetRows.filter((r) => r.isPoor);
    if (poorRows.length > 0) {
      console.log('');
      console.log(red(bold(`  Poor performers (${poorRows.length}/${assetRows.length} assets):`)));
      for (const p of poorRows) {
        console.log(red(`    - ${p.key}  [${p.poorReasons.join(', ')}]`));
      }

      // Theoretical improvement
      const improvement = theoreticalImprovement(assetRows);
      console.log('');
      console.log(yellow('  Theoretical improvement if poor performers removed (avg per-asset):'));
      console.log(
        `    Sharpe  : ${fmt(improvement.avgSharpeAll)} → ${green(fmt(improvement.avgSharpeGood))}` +
        ` (${improvement.avgSharpeGood >= improvement.avgSharpeAll ? '+' : ''}${fmt(improvement.avgSharpeGood - improvement.avgSharpeAll)} delta)`,
      );
      console.log(
        `    Return% : ${fmtPct(improvement.avgReturnAll)} → ${improvement.avgReturnGood >= 0 ? green(fmtPct(improvement.avgReturnGood)) : red(fmtPct(improvement.avgReturnGood))}` +
        ` (${fmtPct(improvement.avgReturnGood - improvement.avgReturnAll)} delta)`,
      );
      console.log(
        `    MaxDD%  : ${improvement.avgMaxDDAll.toFixed(1)}% → ${green(improvement.avgMaxDDGood.toFixed(1) + '%')}` +
        ` (${(improvement.avgMaxDDGood - improvement.avgMaxDDAll).toFixed(1)}% delta)`,
      );
      console.log(
        `    Assets  : ${assetRows.length} total → ${improvement.goodCount} remaining (removing ${improvement.poorCount})`,
      );

      // Record for final summary
      removalRecommendations.push({
        aggregationName: aggName,
        assets: poorRows.map((r) => r.key),
        currentSharpe: sharpe,
        currentReturn: returnPct,
        currentMaxDD: maxDDPct,
      });
    } else {
      console.log('');
      console.log(green('  No poor performers detected. All assets pass quality thresholds.'));
    }

    console.log('');
  }

  // ---------------------------------------------------------------------------
  // Final summary
  // ---------------------------------------------------------------------------

  console.log('');
  console.log(separator('=', TABLE_WIDTH));
  console.log(bold(cyan('SUMMARY')));
  console.log(separator('=', TABLE_WIDTH));
  console.log('');

  console.log(`  Total aggregations analyzed : ${bold(String(totalAnalyzed))}`);

  if (suspiciousHighROI.length > 0) {
    console.log('');
    console.log(red(bold(`  Suspicious (>10,000% ROI) — likely calculation bugs (${suspiciousHighROI.length}):`)));
    for (const name of suspiciousHighROI) {
      console.log(red(`    - ${name}`));
    }
  } else {
    console.log(green('  No aggregations with suspiciously high ROI (>10,000%).'));
  }

  console.log('');
  if (removalRecommendations.length > 0) {
    console.log(yellow(bold(`  Assets recommended for removal (${removalRecommendations.length} aggregation(s)):`)));
    for (const rec of removalRecommendations) {
      console.log('');
      console.log(bold(`    Aggregation: ${rec.aggregationName}`));
      console.log(dim(`      Current: Sharpe ${fmt(rec.currentSharpe)}  Return ${fmtPct(rec.currentReturn)}  MaxDD ${rec.currentMaxDD.toFixed(1)}%`));
      console.log(yellow('      Remove:'));
      for (const asset of rec.assets) {
        console.log(red(`        - ${asset}`));
      }
    }
  } else {
    console.log(green('  No removal recommendations — all assets look healthy across all aggregations.'));
  }

  console.log('');
  console.log(separator('=', TABLE_WIDTH));

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
