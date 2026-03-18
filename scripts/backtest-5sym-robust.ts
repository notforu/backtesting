#!/usr/bin/env node
/**
 * 5-Symbol Robust Portfolio Backtest — FR V2
 *
 * Runs the walk-forward-validated 5-symbol portfolio (ZEC, LDO, TRB, NEAR, STG)
 * with three allocation modes:
 *   1. single_strongest, maxPositions=1
 *   2. top_n, maxPositions=3
 *   3. weighted_multi, maxPositions=3
 *
 * XLM and IOST are excluded (confirmed overfitters in V3 walk-forward).
 * Each run uses per-symbol WF-validated params, saves to DB, and prints
 * a comparison table + per-asset breakdown.
 *
 * Usage:
 *   npx tsx scripts/backtest-5sym-robust.ts
 */

import { randomUUID } from 'crypto';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb, saveAggregationConfig, saveBacktestRun } from '../src/data/db.js';
import type { AggregationConfig } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig, AllocationMode } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Configuration
// ============================================================================

const START_DATE = 1704067200000; // 2024-01-01
const END_DATE   = 1772323200000; // 2026-03-01
const INITIAL_CAPITAL = 10000;
const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;

/** Params shared across ALL sub-strategies */
const COMMON_PARAMS: Record<string, unknown> = {
  atrPeriod: 14,
  stopLossPct: 3,
  useATRStops: true,
  kellyFraction: 0.5,
  takeProfitPct: 4,
  useFRVelocity: false,
  usePercentile: true,
  frVelocityBars: 1,
  maxPositionPct: 50,
  minPositionPct: 15,
  trendSMAPeriod: 50,
  useTrendFilter: true,
  atrFilterEnabled: true,
  atrFilterThreshold: 1.5,
  percentileLookback: 90,
  positionSizePct: 50,
  positionSizeMethod: 'volAdjusted',
  kellySampleSize: 20,
  useTrailingStop: false,
  trailDistanceATR: 2,
  trailActivationATR: 1,
  fundingThresholdLong: -0.0003,
  fundingThresholdShort: 0.0005,
};

/** Per-symbol WF-validated params (override/merge with COMMON_PARAMS) */
const SYMBOL_PARAMS: Record<string, Record<string, unknown>> = {
  'ZEC/USDT:USDT': {
    holdingPeriods: 2,
    shortPercentile: 98,
    longPercentile: 4,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 4.5,
  },
  'LDO/USDT:USDT': {
    holdingPeriods: 4,
    shortPercentile: 96,
    longPercentile: 2,
    atrStopMultiplier: 3.5,
    atrTPMultiplier: 3.5,
  },
  'TRB/USDT:USDT': {
    holdingPeriods: 2,
    shortPercentile: 98,
    longPercentile: 6,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 5,
  },
  'NEAR/USDT:USDT': {
    holdingPeriods: 3,
    shortPercentile: 96,
    longPercentile: 6,
    atrStopMultiplier: 3,
    atrTPMultiplier: 2.5,
  },
  'STG/USDT:USDT': {
    holdingPeriods: 4,
    shortPercentile: 94,
    longPercentile: 10,
    atrStopMultiplier: 1.5,
    atrTPMultiplier: 2.5,
  },
};

const SYMBOLS = Object.keys(SYMBOL_PARAMS);

// ============================================================================
// Build sub-strategy list
// ============================================================================

function buildSubStrategies(): SubStrategyConfig[] {
  return SYMBOLS.map((symbol) => ({
    strategyName: 'funding-rate-spike-v2',
    symbol,
    timeframe: TIMEFRAME,
    params: { ...COMMON_PARAMS, ...SYMBOL_PARAMS[symbol] },
    exchange: EXCHANGE,
  }));
}

const SUB_STRATEGIES = buildSubStrategies();

// ============================================================================
// DB helpers
// ============================================================================

function makeAggregationConfig(
  name: string,
  allocationMode: AllocationMode,
  maxPositions: number,
): AggregationConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    allocationMode,
    maxPositions,
    subStrategies: SUB_STRATEGIES,
    subStrategyConfigIds: [],
    initialCapital: INITIAL_CAPITAL,
    exchange: EXCHANGE,
    mode: 'futures',
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return 'N/A';
  return n.toFixed(decimals);
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return 'N/A';
  return n.toFixed(2) + '%';
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function rpad(s: string, width: number): string {
  return s.padStart(width);
}

// ============================================================================
// Run one allocation mode
// ============================================================================

interface RunSpec {
  label: string;
  allocationMode: AllocationMode;
  maxPositions: number;
}

const RUN_SPECS: RunSpec[] = [
  { label: 'SS mp=1',       allocationMode: 'single_strongest', maxPositions: 1 },
  { label: 'top_n mp=3',    allocationMode: 'top_n',            maxPositions: 3 },
  { label: 'weighted mp=3', allocationMode: 'weighted_multi',   maxPositions: 3 },
];

async function runOne(spec: RunSpec, ts: string): Promise<{ result: AggregateBacktestResult; configId: string }> {
  const allocLabel = spec.allocationMode === 'single_strongest'
    ? `single_strongest`
    : `${spec.allocationMode} mp=${spec.maxPositions}`;
  const name = `FR V2 5-sym robust — ${allocLabel} ${ts}`;

  const aggConfig = makeAggregationConfig(name, spec.allocationMode, spec.maxPositions);

  process.stderr.write(`\n[5sym-robust] === ${spec.label}: ${name} ===\n`);
  process.stderr.write(`[5sym-robust] Symbols: ${SYMBOLS.join(', ')}\n`);
  process.stderr.write(`[5sym-robust] Period:  2024-01-01 to 2026-03-01\n`);
  process.stderr.write(`[5sym-robust] Mode:    ${spec.allocationMode}, maxPositions=${spec.maxPositions}\n`);

  await saveAggregationConfig(aggConfig);
  process.stderr.write(`[5sym-robust] Saved aggregation config: ${aggConfig.id}\n`);

  const startTime = Date.now();
  let result: AggregateBacktestResult;

  try {
    result = await runAggregateBacktest(
      {
        subStrategies: SUB_STRATEGIES,
        allocationMode: spec.allocationMode,
        maxPositions: spec.maxPositions,
        initialCapital: INITIAL_CAPITAL,
        startDate: START_DATE,
        endDate: END_DATE,
        exchange: EXCHANGE,
        mode: 'futures',
      },
      {
        enableLogging: false,
        saveResults: false,
        skipFundingRateValidation: false,
        skipCandleValidation: false,
        onProgress: ({ current, total, percent }) => {
          if (current % 500 === 0) {
            process.stderr.write(`[5sym-robust] ${spec.label} progress: ${current}/${total} (${percent.toFixed(0)}%)\r`);
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[5sym-robust] ${spec.label} FAILED: ${msg}\n`);
    throw err;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(`\n[5sym-robust] ${spec.label} done in ${duration}s\n`);
  process.stderr.write(
    `[5sym-robust] Result: Sharpe=${result.metrics.sharpeRatio.toFixed(2)}, ` +
    `Return=${result.metrics.totalReturnPercent.toFixed(1)}%, ` +
    `MaxDD=${result.metrics.maxDrawdownPercent.toFixed(1)}%, ` +
    `Trades=${result.metrics.totalTrades}\n`,
  );

  await saveBacktestRun(result, aggConfig.id);
  process.stderr.write(`[5sym-robust] Backtest run saved: ${result.id}\n`);

  return { result, configId: aggConfig.id };
}

// ============================================================================
// Print comparison table
// ============================================================================

function printComparisonTable(
  runs: Array<{ spec: RunSpec; result: AggregateBacktestResult }>,
): void {
  const W = 65;
  console.log('\n' + '='.repeat(W));
  console.log('  5-SYMBOL ROBUST PORTFOLIO — FR V2 (ZEC, LDO, TRB, NEAR, STG)');
  console.log('='.repeat(W));

  const COL = 9;
  const LABEL = 16;
  console.log(
    pad('Alloc Mode', LABEL) +
    rpad('Sharpe', COL) +
    rpad('Return%', COL) +
    rpad('MaxDD%', COL) +
    rpad('Trades', COL) +
    rpad('WinRate', COL) +
    rpad('PF', COL),
  );
  console.log('-'.repeat(W));

  for (const { spec, result } of runs) {
    const m = result.metrics;
    console.log(
      pad(spec.label, LABEL) +
      rpad(fmt(m.sharpeRatio), COL) +
      rpad(fmtPct(m.totalReturnPercent), COL) +
      rpad(fmtPct(m.maxDrawdownPercent), COL) +
      rpad(String(m.totalTrades), COL) +
      rpad(fmtPct(m.winRate), COL) +
      rpad(fmt(m.profitFactor), COL),
    );
  }

  console.log('='.repeat(W));
}

// ============================================================================
// Print per-asset breakdown for a specific run
// ============================================================================

function printPerAssetBreakdown(
  result: AggregateBacktestResult,
  label: string,
): void {
  const W = 57;
  console.log(`\nPer-asset breakdown (${label}):`);
  console.log(
    pad('Symbol', 10) +
    rpad('Sharpe', 10) +
    rpad('Return%', 10) +
    rpad('MaxDD%', 10) +
    rpad('Trades', 10),
  );
  console.log('-'.repeat(W));

  const rows: Array<{
    sym: string;
    sharpe: number;
    ret: number;
    dd: number;
    trades: number;
  }> = [];

  for (const [symbol, assetResult] of Object.entries(result.perAssetResults)) {
    const shortSym = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    rows.push({
      sym: shortSym,
      sharpe: assetResult.metrics.sharpeRatio ?? 0,
      ret: assetResult.metrics.totalReturnPercent ?? 0,
      dd: assetResult.metrics.maxDrawdownPercent ?? 0,
      trades: assetResult.metrics.totalTrades ?? 0,
    });
  }

  rows.sort((a, b) => b.sharpe - a.sharpe);

  for (const r of rows) {
    console.log(
      pad(r.sym, 10) +
      rpad(fmt(r.sharpe), 10) +
      rpad(fmtPct(r.ret), 10) +
      rpad(fmtPct(r.dd), 10) +
      rpad(String(r.trades), 10),
    );
  }

  console.log('='.repeat(W));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[5sym-robust] Initializing database...\n');
  await initDb();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const completedRuns: Array<{ spec: RunSpec; result: AggregateBacktestResult; configId: string }> = [];

  for (const spec of RUN_SPECS) {
    try {
      const { result, configId } = await runOne(spec, ts);
      completedRuns.push({ spec, result, configId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[5sym-robust] Skipping ${spec.label} due to error: ${msg}\n`);
    }
  }

  if (completedRuns.length === 0) {
    process.stderr.write('[5sym-robust] All runs failed — nothing to display.\n');
    await closeDb();
    process.exit(1);
  }

  // Print comparison table
  printComparisonTable(completedRuns.map(({ spec, result }) => ({ spec, result })));

  // Print per-asset breakdown for top_n mp=3 (or fall back to first completed)
  const topNRun = completedRuns.find((r) => r.spec.allocationMode === 'top_n') ?? completedRuns[0];
  printPerAssetBreakdown(topNRun.result, topNRun.spec.label);

  // Summary IDs
  console.log('\nDatabase IDs:');
  for (const { spec, result, configId } of completedRuns) {
    console.log(`  ${spec.label}:`);
    console.log(`    Aggregation config: ${configId}`);
    console.log(`    Backtest run:       ${result.id}`);
  }

  console.log('\nDone. All runs saved to database.');

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(
    `\n[5sym-robust] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
