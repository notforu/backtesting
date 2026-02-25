#!/usr/bin/env node
/**
 * Tuned parameter scan: funding-rate-spike-v2 across all cached Bybit symbols
 *
 * Runs 5 parameter variants at 4h only (145 runs total: 5 variants × 29 symbols).
 * The goal is to recover performance on assets that degraded in v2 due to the
 * trend filter (ATOM, ADA, DOT, INJ, OP were strong in v1 but fell in v2).
 *
 * Usage:
 *   npx tsx scripts/scan-fr-v2-tuned.ts [options]
 *
 * Options:
 *   --from=YYYY-MM-DD        Start date (default: 2024-01-01)
 *   --to=YYYY-MM-DD          End date   (default: 2026-02-01)
 *   --capital=AMOUNT         Initial capital per run (default: 10000)
 *   --variant=1,2,3          Comma-separated variant numbers to run (default: all)
 *   --skip=SYM1,SYM2         Comma-separated base symbols to skip (e.g. BTC,ETH)
 *   --only=SYM1,SYM2         Comma-separated base symbols to run exclusively
 *
 * Variants:
 *   1 - No Trend Filter      (useTrendFilter: false)
 *   2 - Loose Trend Filter   (useTrendFilter: true, trendSMAPeriod: 100)
 *   3 - No ATR Filter        (atrFilterEnabled: false)
 *   4 - Wider Entry          (shortPercentile: 90, longPercentile: 10)
 *   5 - Aggressive Sizing    (positionSizePct: 70, useTrailingStop: true,
 *                             trailActivationATR: 1.5, trailDistanceATR: 1.5)
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb, saveBacktestRun } from '../src/data/db.js';
import type { Timeframe, PerformanceMetrics, BacktestResult } from '../src/core/types.js';

// ============================================================================
// Constants
// ============================================================================

const BASE_SYMBOLS = [
  'BTC', 'ETH', 'LTC', 'ADA', 'DOT', 'ETC', 'MANA', 'CRV', 'AXS', 'SNX',
  'IMX', 'LINK', 'VET', 'GRT', 'ICP', 'AAVE', 'HBAR', 'TRX', 'XLM', 'LDO',
  'XRP', 'PENDLE', 'WLD', 'NEAR', 'DOGE', 'WIF', 'OP', 'ATOM', 'INJ',
];

const TIMEFRAME: Timeframe = '4h';

const STRATEGY = 'funding-rate-spike-v2';
const EXCHANGE = 'bybit';
const DEFAULT_FROM = '2024-01-01';
const DEFAULT_TO = '2026-02-01';
const DEFAULT_CAPITAL = 10000;

// Bybit taker fee for futures
const FEE_RATE = 0.00055;

// ============================================================================
// Variant Definitions
// ============================================================================

interface VariantDef {
  id: number;
  label: string;
  description: string;
  params: Record<string, unknown>;
}

const VARIANTS: VariantDef[] = [
  {
    id: 1,
    label: 'No Trend Filter',
    description: 'useTrendFilter: false — removes trend alignment gate entirely',
    params: {
      useTrendFilter: false,
    },
  },
  {
    id: 2,
    label: 'Loose Trend Filter',
    description: 'useTrendFilter: true, trendSMAPeriod: 100 — longer SMA = softer trend gate',
    params: {
      useTrendFilter: true,
      trendSMAPeriod: 100,
    },
  },
  {
    id: 3,
    label: 'No ATR Filter',
    description: 'atrFilterEnabled: false — entries allowed during high-volatility periods',
    params: {
      atrFilterEnabled: false,
    },
  },
  {
    id: 4,
    label: 'Wider Entry',
    description: 'shortPercentile: 90, longPercentile: 10 — lower bar for entries, more trades',
    params: {
      shortPercentile: 90,
      longPercentile: 10,
    },
  },
  {
    id: 5,
    label: 'Aggressive Sizing + Trailing',
    description: 'positionSizePct: 70, useTrailingStop: true, trailActivationATR: 1.5, trailDistanceATR: 1.5',
    params: {
      positionSizePct: 70,
      useTrailingStop: true,
      trailActivationATR: 1.5,
      trailDistanceATR: 1.5,
    },
  },
];

// ============================================================================
// Types
// ============================================================================

interface ScanRow {
  variantId: number;
  variantLabel: string;
  symbol: string;
  timeframe: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  fundingIncome: number;
  tradingPnl: number;
  sortino: number;
  profitFactor: number;
  saved: boolean;
  error?: string;
}

// ============================================================================
// Arg parsing
// ============================================================================

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result[key] = value;
      }
    }
  }
  return result;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function sharpeStr(sharpe: number): string {
  if (!isFinite(sharpe)) return 'N/A';
  return sharpe >= 0 ? `+${fmt(sharpe)}` : fmt(sharpe);
}

function sharpeHighlight(sharpe: number): string {
  if (!isFinite(sharpe)) return '';
  if (sharpe > 1.5) return ' ***';
  if (sharpe > 1.0) return ' **';
  if (sharpe > 0.5) return ' *';
  return '';
}

/**
 * Print a single result row.
 * columns: rank | variant | symbol | sharpe | return% | maxDD% | trades | winRate% | funding$
 */
function printRow(
  rank: string,
  variant: string,
  sym: string,
  sharpe: string,
  ret: string,
  dd: string,
  trades: string,
  wr: string,
  funding: string
): void {
  console.log(
    `${pad(rank, 5)} ${pad(variant, 30)} ${pad(sym, 7)} ${pad(sharpe, 10, true)} ${pad(ret, 9, true)} ${pad(dd, 8, true)} ${pad(trades, 6, true)} ${pad(wr, 8, true)} ${pad(funding, 10, true)}`
  );
}

function printHeader(): void {
  printRow('Rank', 'Variant', 'Symbol', 'Sharpe', 'Return%', 'MaxDD%', 'Trades', 'WinRate%', 'Funding$');
  console.log('-'.repeat(100));
}

// ============================================================================
// Per-variant summary table (narrower: no variant column)
// ============================================================================

function printVariantRow(
  rank: string,
  sym: string,
  sharpe: string,
  ret: string,
  dd: string,
  trades: string,
  wr: string,
  funding: string
): void {
  console.log(
    `${pad(rank, 5)} ${pad(sym, 7)} ${pad(sharpe, 10, true)} ${pad(ret, 9, true)} ${pad(dd, 8, true)} ${pad(trades, 6, true)} ${pad(wr, 8, true)} ${pad(funding, 10, true)}`
  );
}

function printVariantHeader(): void {
  printVariantRow('Rank', 'Symbol', 'Sharpe', 'Return%', 'MaxDD%', 'Trades', 'WinRate%', 'Funding$');
  console.log('-'.repeat(70));
}

// ============================================================================
// Run a single backtest for a variant + symbol
// ============================================================================

async function runVariantSymbol(
  variant: VariantDef,
  sym: string,
  startDate: number,
  endDate: number,
  capital: number,
  label: string
): Promise<ScanRow> {
  const fullSymbol = `${sym}/USDT:USDT`;

  try {
    const config = createBacktestConfig({
      strategyName: STRATEGY,
      symbol: fullSymbol,
      timeframe: TIMEFRAME,
      startDate,
      endDate,
      initialCapital: capital,
      exchange: EXCHANGE,
      params: variant.params,
      mode: 'futures',
    });

    const result: BacktestResult = await runBacktest(config, {
      enableLogging: false,
      saveResults: false,
      skipFeeFetch: true,
      broker: {
        feeRate: FEE_RATE,
        slippagePercent: 0.05,
      },
    });

    const m: PerformanceMetrics = result.metrics;
    const mAny = m as Record<string, unknown>;

    const row: ScanRow = {
      variantId: variant.id,
      variantLabel: variant.label,
      symbol: sym,
      timeframe: TIMEFRAME,
      sharpe: m.sharpeRatio,
      returnPct: m.totalReturnPercent,
      maxDD: m.maxDrawdownPercent,
      trades: m.totalTrades,
      winRate: m.winRate,
      fundingIncome: typeof mAny['totalFundingIncome'] === 'number' ? mAny['totalFundingIncome'] : 0,
      tradingPnl: typeof mAny['tradingPnl'] === 'number' ? mAny['tradingPnl'] : 0,
      sortino: m.sortinoRatio,
      profitFactor: m.profitFactor,
      saved: false,
    };

    // Save to DB
    try {
      await saveBacktestRun(result);
      row.saved = true;
    } catch (saveErr) {
      const saveMsg = saveErr instanceof Error ? saveErr.message : 'unknown save error';
      console.error(`  [WARN] Could not save ${sym}@${TIMEFRAME} (v${variant.id}) to DB: ${saveMsg}`);
    }

    const sh = m.sharpeRatio >= 0
      ? `+${m.sharpeRatio.toFixed(2)}`
      : m.sharpeRatio.toFixed(2);
    const savedStr = row.saved ? ' [saved]' : ' [not saved]';
    console.log(
      `${label} -> Sharpe ${sh}, Return ${m.totalReturnPercent.toFixed(1)}%, Trades ${m.totalTrades}, Funding $${row.fundingIncome.toFixed(1)}${savedStr}`
    );

    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.log(`${label} -> ERROR: ${msg}`);
    return {
      variantId: variant.id,
      variantLabel: variant.label,
      symbol: sym,
      timeframe: TIMEFRAME,
      sharpe: -Infinity,
      returnPct: 0,
      maxDD: 0,
      trades: 0,
      winRate: 0,
      fundingIncome: 0,
      tradingPnl: 0,
      sortino: 0,
      profitFactor: 0,
      saved: false,
      error: msg,
    };
  }
}

// ============================================================================
// Print per-variant summary
// ============================================================================

function printVariantSummary(variant: VariantDef, rows: ScanRow[]): void {
  const successful = rows.filter((r) => !r.error);
  const errors = rows.filter((r) => r.error);
  const sorted = [...successful].sort((a, b) => b.sharpe - a.sharpe);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`VARIANT ${variant.id}: ${variant.label}`);
  console.log(`  ${variant.description}`);
  console.log(`${'='.repeat(70)}`);
  console.log('');

  printVariantHeader();
  sorted.forEach((r, i) => {
    const sh = sharpeStr(r.sharpe);
    const highlight = sharpeHighlight(r.sharpe);
    printVariantRow(
      `${i + 1}.`,
      r.symbol,
      sh + highlight,
      fmt(r.returnPct, 1),
      fmt(r.maxDD, 1),
      r.trades.toString(),
      fmt(r.winRate, 1),
      fmt(r.fundingIncome, 1)
    );
  });

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach((r) => console.log(`  ${r.symbol}: ${r.error}`));
  }

  const profitable = sorted.filter((r) => r.returnPct > 0);
  const positiveSharpe = sorted.filter((r) => r.sharpe > 0);
  const goodSharpe = sorted.filter((r) => r.sharpe > 0.5);
  const greatSharpe = sorted.filter((r) => r.sharpe > 1.0);

  console.log('');
  if (sorted.length > 0) {
    console.log(`  Profitable   : ${profitable.length}/${sorted.length} (${((profitable.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`  Sharpe > 0   : ${positiveSharpe.length}/${sorted.length} (${((positiveSharpe.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`  Sharpe > 0.5 : ${goodSharpe.length}/${sorted.length} (${((goodSharpe.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`  Sharpe > 1.0 : ${greatSharpe.length}/${sorted.length} (${((greatSharpe.length / sorted.length) * 100).toFixed(0)}%)`);
    const avgFunding = sorted.reduce((s, r) => s + r.fundingIncome, 0) / sorted.length;
    console.log(`  Avg funding  : $${avgFunding.toFixed(1)} per run`);
    const best = sorted[0];
    if (best) {
      console.log(`  Best symbol  : ${best.symbol} (Sharpe ${sharpeStr(best.sharpe)}, Return ${fmt(best.returnPct, 1)}%, Trades ${best.trades})`);
    }
  }
  console.log(`  * Sharpe > 0.5  ** Sharpe > 1.0  *** Sharpe > 1.5`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const from = args.from ?? DEFAULT_FROM;
  const to = args.to ?? DEFAULT_TO;
  const capital = Number(args.capital ?? DEFAULT_CAPITAL);
  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();

  // Build symbol filter sets
  const skipSet = new Set(
    (args.skip ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
  const onlySet = new Set(
    (args.only ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );

  const symbols = BASE_SYMBOLS.filter((sym) => {
    if (onlySet.size > 0 && !onlySet.has(sym)) return false;
    if (skipSet.has(sym)) return false;
    return true;
  });

  // Build variant filter
  const variantFilter = new Set(
    (args.variant ?? '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 1 && n <= 5)
  );
  const activeVariants = variantFilter.size > 0
    ? VARIANTS.filter((v) => variantFilter.has(v.id))
    : VARIANTS;

  const totalRuns = activeVariants.length * symbols.length;

  console.log(`${'='.repeat(70)}`);
  console.log(`FR-v2 Tuned Parameter Scan`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Strategy  : ${STRATEGY}`);
  console.log(`Period    : ${from} -> ${to}`);
  console.log(`Capital   : $${capital.toLocaleString()}`);
  console.log(`Timeframe : ${TIMEFRAME} only`);
  console.log(`Symbols   : ${symbols.length} (${symbols.join(', ')})`);
  console.log(`Variants  : ${activeVariants.length} (${activeVariants.map((v) => `${v.id}:${v.label}`).join(', ')})`);
  console.log(`Total runs: ${totalRuns}`);
  console.log('');

  console.log('Variant overrides (params that differ from v2 defaults):');
  activeVariants.forEach((v) => {
    const overrides = Object.entries(v.params)
      .map(([k, val]) => `${k}=${JSON.stringify(val)}`)
      .join(', ');
    console.log(`  V${v.id} [${v.label}]: ${overrides}`);
  });
  console.log('');

  // Map from variantId -> rows collected during that variant's run
  const variantRows = new Map<number, ScanRow[]>();
  const allRows: ScanRow[] = [];

  let completedTotal = 0;

  // ============================================================================
  // Run variants sequentially, symbols within each variant sequentially
  // ============================================================================

  for (const variant of activeVariants) {
    const vRows: ScanRow[] = [];
    variantRows.set(variant.id, vRows);

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Starting Variant ${variant.id}: ${variant.label}`);
    console.log(`  ${variant.description}`);
    console.log(`${'─'.repeat(70)}`);

    let completedVariant = 0;

    for (const sym of symbols) {
      completedTotal++;
      completedVariant++;
      const label = `[${completedTotal}/${totalRuns}] V${variant.id} ${sym}@${TIMEFRAME}`;

      const row = await runVariantSymbol(variant, sym, startDate, endDate, capital, label);
      vRows.push(row);
      allRows.push(row);
    }

    // Print per-variant summary immediately after it finishes
    printVariantSummary(variant, vRows);
  }

  // ============================================================================
  // Cross-variant comparison: Top 20 overall
  // ============================================================================

  const allSuccessful = allRows.filter((r) => !r.error);
  const allSorted = [...allSuccessful].sort((a, b) => b.sharpe - a.sharpe);
  const top20 = allSorted.slice(0, 20);

  console.log(`\n\n${'='.repeat(100)}`);
  console.log(`CROSS-VARIANT TOP 20 BY SHARPE`);
  console.log(`${'='.repeat(100)}`);
  console.log('');
  printHeader();

  top20.forEach((r, i) => {
    const sh = sharpeStr(r.sharpe);
    const highlight = sharpeHighlight(r.sharpe);
    printRow(
      `${i + 1}.`,
      `V${r.variantId}:${r.variantLabel}`,
      r.symbol,
      sh + highlight,
      fmt(r.returnPct, 1),
      fmt(r.maxDD, 1),
      r.trades.toString(),
      fmt(r.winRate, 1),
      fmt(r.fundingIncome, 1)
    );
  });

  console.log('\n  * Sharpe > 0.5  ** Sharpe > 1.0  *** Sharpe > 1.5');

  // ============================================================================
  // Cross-variant comparison matrix for key assets
  // ============================================================================

  const keyAssets = ['ATOM', 'ADA', 'DOT', 'INJ', 'OP'];
  const trackedAssets = keyAssets.filter((a) => symbols.includes(a));

  if (trackedAssets.length > 0 && activeVariants.length > 1) {
    console.log(`\n\n${'='.repeat(70)}`);
    console.log('KEY ASSETS ACROSS VARIANTS (Sharpe comparison)');
    console.log(`${'='.repeat(70)}`);

    // Header row: variants as columns
    const variantCols = activeVariants.map((v) => `V${v.id}`);
    const headerParts = [pad('Asset', 8), ...variantCols.map((c) => pad(c, 9, true))];
    console.log(headerParts.join(' '));
    console.log('-'.repeat(8 + activeVariants.length * 10));

    for (const asset of trackedAssets) {
      const cells = [pad(asset, 8)];
      for (const variant of activeVariants) {
        const vRows = variantRows.get(variant.id) ?? [];
        const r = vRows.find((row) => row.symbol === asset && !row.error);
        if (r) {
          const sh = isFinite(r.sharpe) ? (r.sharpe >= 0 ? `+${fmt(r.sharpe)}` : fmt(r.sharpe)) : 'N/A';
          cells.push(pad(sh, 9, true));
        } else {
          cells.push(pad('ERR', 9, true));
        }
      }
      console.log(cells.join(' '));
    }

    console.log('');
    console.log('  V1=NoTrendFilter  V2=LooseTrend  V3=NoATRFilter  V4=WiderEntry  V5=AggSizing');
  }

  // ============================================================================
  // Overall summary stats across all variants
  // ============================================================================

  console.log(`\n\n${'='.repeat(70)}`);
  console.log('OVERALL SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`Total runs      : ${allRows.length} (${allSuccessful.length} successful, ${allRows.filter((r) => r.error).length} errors)`);
  console.log(`Saved to DB     : ${allSuccessful.filter((r) => r.saved).length}/${allSuccessful.length}`);

  if (allSorted.length > 0) {
    const profitable = allSorted.filter((r) => r.returnPct > 0);
    const positiveSharpe = allSorted.filter((r) => r.sharpe > 0);
    const goodSharpe = allSorted.filter((r) => r.sharpe > 0.5);
    const greatSharpe = allSorted.filter((r) => r.sharpe > 1.0);

    console.log(`Profitable      : ${profitable.length}/${allSorted.length} (${((profitable.length / allSorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 0      : ${positiveSharpe.length}/${allSorted.length} (${((positiveSharpe.length / allSorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 0.5    : ${goodSharpe.length}/${allSorted.length} (${((goodSharpe.length / allSorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 1.0    : ${greatSharpe.length}/${allSorted.length} (${((greatSharpe.length / allSorted.length) * 100).toFixed(0)}%)`);
  }

  // Best result per variant
  console.log('');
  console.log('Best result per variant:');
  for (const variant of activeVariants) {
    const vRows = (variantRows.get(variant.id) ?? []).filter((r) => !r.error);
    const vSorted = [...vRows].sort((a, b) => b.sharpe - a.sharpe);
    if (vSorted.length > 0) {
      const best = vSorted[0];
      console.log(
        `  V${variant.id} [${variant.label}]: ${best.symbol} -> Sharpe ${sharpeStr(best.sharpe)}, Return ${fmt(best.returnPct, 1)}%, Trades ${best.trades}`
      );
    }
  }

  console.log('\nDone.');

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb().catch(() => undefined);
  process.exit(1);
});
