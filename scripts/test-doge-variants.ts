/**
 * DOGE Variants Test Script
 *
 * Tests 4 Hybrid Tiered V3 portfolio variants that all include DOGE (replacing or
 * supplementing NEAR), with weighted_multi allocation and maxPositions: 3.
 *
 * Variants:
 *   1. Hybrid 6 (DOGE for NEAR)    – ZEC, LDO(opt), XLM(opt), TRB, IOST, DOGE
 *   2. Hybrid 7 (DOGE+STG for NEAR)– ZEC, LDO(opt), XLM(opt), TRB, IOST, DOGE, STG
 *   3. Hybrid 7 (DOGE+COMP winner) – ZEC, LDO(opt), XLM(opt), TRB, IOST, DOGE, COMP
 *   4. Hybrid 8 (DOGE+STG+COMP)    – ZEC, LDO(opt), XLM(opt), TRB, IOST, DOGE, STG, COMP
 *
 * Usage:
 *   npx tsx scripts/test-doge-variants.ts
 */

import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

const START_DATE = new Date('2024-01-01').getTime();
const END_DATE = new Date('2026-03-01').getTime();
const TF = '4h' as Timeframe;

// ============================================================================
// Optimized params
// ============================================================================

const OPT_LDO = { holdingPeriods: 4, shortPercentile: 96, longPercentile: 2, atrStopMultiplier: 3.5, atrTPMultiplier: 3.5 };
const OPT_XLM = { holdingPeriods: 6, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 3, atrTPMultiplier: 5 };

// ============================================================================
// Helper: build a SubStrategyConfig
// ============================================================================

function sub(symbol: string, params: Record<string, unknown> = {}): SubStrategyConfig {
  return {
    strategyName: 'funding-rate-spike-v3',
    symbol: `${symbol}/USDT:USDT`,
    timeframe: TF,
    params,
    exchange: 'bybit',
  };
}

// ============================================================================
// Portfolio variants
// ============================================================================

interface PortfolioVariant {
  name: string;
  subStrategies: SubStrategyConfig[];
  maxPositions?: number;
}

const variants: PortfolioVariant[] = [
  // 1. DOGE replaces NEAR
  {
    name: 'Hybrid 6 (DOGE for NEAR)',
    subStrategies: [
      sub('ZEC'), sub('LDO', OPT_LDO), sub('XLM', OPT_XLM),
      sub('TRB'), sub('IOST'), sub('DOGE'),
    ],
  },
  // 2. DOGE + STG replace NEAR
  {
    name: 'Hybrid 7 (DOGE+STG for NEAR)',
    subStrategies: [
      sub('ZEC'), sub('LDO', OPT_LDO), sub('XLM', OPT_XLM),
      sub('TRB'), sub('IOST'), sub('DOGE'), sub('STG'),
    ],
  },
  // 3. DOGE + COMP replace NEAR (the winner from prior run — confirm)
  {
    name: 'Hybrid 7 (DOGE+COMP winner)',
    subStrategies: [
      sub('ZEC'), sub('LDO', OPT_LDO), sub('XLM', OPT_XLM),
      sub('TRB'), sub('IOST'), sub('DOGE'), sub('COMP'),
    ],
  },
  // 4. DOGE + STG + COMP (widest basket)
  {
    name: 'Hybrid 8 (DOGE+STG+COMP)',
    subStrategies: [
      sub('ZEC'), sub('LDO', OPT_LDO), sub('XLM', OPT_XLM),
      sub('TRB'), sub('IOST'), sub('DOGE'), sub('STG'), sub('COMP'),
    ],
  },
];

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number, decimals = 2): string {
  return isFinite(n) ? n.toFixed(decimals) : 'N/A';
}

function pad(s: string, width: number, right = false): string {
  return right ? s.padStart(width) : s.padEnd(width);
}

// ============================================================================
// Result container
// ============================================================================

interface VariantResult {
  variant: PortfolioVariant;
  result: AggregateBacktestResult;
}

// ============================================================================
// Output tables
// ============================================================================

function printSummaryTable(rows: VariantResult[]): void {
  const sorted = [...rows].sort((a, b) => b.result.metrics.sharpeRatio - a.result.metrics.sharpeRatio);

  const COL = {
    rank: 4,
    name: 32,
    sharpe: 8,
    ret: 9,
    dd: 8,
    trades: 8,
    wr: 9,
    pf: 6,
    syms: 7,
  };

  const header =
    pad('#', COL.rank) +
    pad('Variant', COL.name) +
    pad('Sharpe', COL.sharpe) +
    pad('Return%', COL.ret) +
    pad('MaxDD%', COL.dd) +
    pad('Trades', COL.trades) +
    pad('WinRate', COL.wr) +
    pad('PF', COL.pf) +
    'Symbols';

  const divider = '='.repeat(header.length + 4);
  const separator = '-'.repeat(header.length + 4);

  console.log('\n' + divider);
  console.log('  DOGE VARIANTS — HYBRID TIERED V3 PORTFOLIO');
  console.log('  Period: 2024-01-01 to 2026-03-01, weighted_multi, maxPositions=3');
  console.log(divider);
  console.log(header);
  console.log(separator);

  for (let i = 0; i < sorted.length; i++) {
    const { variant, result } = sorted[i];
    const m = result.metrics;
    console.log(
      pad(`${i + 1}.`, COL.rank) +
      pad(variant.name, COL.name) +
      pad(fmt(m.sharpeRatio), COL.sharpe) +
      pad(fmt(m.totalReturnPercent) + '%', COL.ret) +
      pad(fmt(m.maxDrawdownPercent) + '%', COL.dd) +
      pad(String(m.totalTrades), COL.trades) +
      pad(fmt(m.winRate) + '%', COL.wr) +
      pad(fmt(m.profitFactor), COL.pf) +
      variant.subStrategies.length,
    );
  }

  console.log(divider + '\n');
}

function printPerAssetTable(rows: VariantResult[]): void {
  // Collect all unique symbols across all variants
  const allSymbols = new Set<string>();
  for (const { variant } of rows) {
    for (const s of variant.subStrategies) {
      allSymbols.add(s.symbol);
    }
  }
  const symbols = Array.from(allSymbols).sort();
  const shortSymbols = symbols.map(s => s.replace('/USDT:USDT', '').replace('/USDT', ''));

  console.log('--- Per-asset Sharpe (all variants, sorted by portfolio Sharpe) ---');

  const nameWidth = 32;
  const colWidth = 7;

  let header = pad('Variant', nameWidth);
  for (const sym of shortSymbols) {
    header += pad(sym, colWidth);
  }
  console.log(header);
  console.log('-'.repeat(nameWidth + colWidth * shortSymbols.length));

  // Sort by Sharpe before printing
  const sorted = [...rows].sort((a, b) => b.result.metrics.sharpeRatio - a.result.metrics.sharpeRatio);

  for (const { variant, result } of sorted) {
    let row = pad(variant.name, nameWidth);
    for (const sym of symbols) {
      const assetResult = result.perAssetResults[sym];
      if (assetResult) {
        row += pad(fmt(assetResult.metrics.sharpeRatio), colWidth);
      } else {
        row += pad('-', colWidth);
      }
    }
    console.log(row);
  }

  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Initializing database...');
  await initDb();

  const successfulResults: VariantResult[] = [];
  const failedVariants: Array<{ name: string; error: string }> = [];

  for (const variant of variants) {
    const maxPositions = variant.maxPositions ?? 3;
    const symbolList = variant.subStrategies.map(s => s.symbol.replace('/USDT:USDT', '')).join(', ');

    console.log(`\n========================================`);
    console.log(`Running: ${variant.name}`);
    console.log(`  Mode: weighted_multi, maxPositions: ${maxPositions}`);
    console.log(`  Symbols (${variant.subStrategies.length}): ${symbolList}`);
    console.log(`  Period: 2024-01-01 to 2026-03-01`);
    console.log(`========================================`);

    try {
      const result = await runAggregateBacktest(
        {
          subStrategies: variant.subStrategies,
          allocationMode: 'weighted_multi',
          maxPositions,
          initialCapital: 10000,
          startDate: START_DATE,
          endDate: END_DATE,
          exchange: 'bybit',
          mode: 'futures',
        },
        {
          enableLogging: false,
          saveResults: false,
          skipFundingRateValidation: false,
          skipCandleValidation: false,
        },
      );

      const m = result.metrics;
      console.log(
        `  Result: Sharpe=${fmt(m.sharpeRatio)}  Return=${fmt(m.totalReturnPercent)}%  ` +
        `MaxDD=${fmt(m.maxDrawdownPercent)}%  Trades=${m.totalTrades}  ` +
        `WinRate=${fmt(m.winRate)}%  PF=${fmt(m.profitFactor)}`,
      );

      successfulResults.push({ variant, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${message}`);
      failedVariants.push({ name: variant.name, error: message });
    }
  }

  if (successfulResults.length > 0) {
    printSummaryTable(successfulResults);
    printPerAssetTable(successfulResults);
  } else {
    console.log('\nNo variants completed successfully.');
  }

  if (failedVariants.length > 0) {
    console.log('--- Failed variants ---');
    for (const { name, error } of failedVariants) {
      const truncated = error.length > 120 ? error.slice(0, 120) + '...' : error;
      console.log(`  ${name}: ${truncated}`);
    }
    console.log();
  }

  await closeDb();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
