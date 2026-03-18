#!/usr/bin/env node
/**
 * Compare FR V2 vs V3 across MULTIPLE allocation configurations
 *
 * Runs 4 allocation configs × 2 strategy versions = 8 total aggregation backtests:
 *
 *   1. single_strongest, maxPositions=1
 *   2. top_n,            maxPositions=3
 *   3. top_n,            maxPositions=5
 *   4. weighted_multi,   maxPositions=3
 *
 * All configs share the same 13 symbols, params, date range (2024-01-01 – 2026-03-01),
 * bybit futures 4h, $10,000 initial capital.
 *
 * Results are saved to DB and a combined comparison table is printed to stdout.
 *
 * Usage:
 *   npx tsx scripts/compare-v2-v3-multi-config.ts
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
const END_DATE = 1772323200000;   // 2026-03-01
const INITIAL_CAPITAL = 10000;
const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;

const SYMBOLS = [
  'IOST/USDT:USDT',
  'ZEC/USDT:USDT',
  'ARB/USDT:USDT',
  'IOTA/USDT:USDT',
  'TRB/USDT:USDT',
  'STG/USDT:USDT',
  'COTI/USDT:USDT',
  'ENJ/USDT:USDT',
  'KAVA/USDT:USDT',
  'APT/USDT:USDT',
  'COMP/USDT:USDT',
  'RPL/USDT:USDT',
  'BCH/USDT:USDT',
];

const SHARED_PARAMS: Record<string, unknown> = {
  atrPeriod: 14,
  stopLossPct: 3,
  useATRStops: true,
  kellyFraction: 0.5,
  takeProfitPct: 4,
  useFRVelocity: false,
  usePercentile: true,
  frVelocityBars: 1,
  holdingPeriods: 3,
  longPercentile: 5,
  maxPositionPct: 50,
  minPositionPct: 15,
  trendSMAPeriod: 50,
  useTrendFilter: true,
  atrTPMultiplier: 3.5,
  kellySampleSize: 20,
  positionSizePct: 50,
  shortPercentile: 95,
  useTrailingStop: false,
  atrFilterEnabled: true,
  trailDistanceATR: 2,
  atrStopMultiplier: 2.5,
  atrFilterThreshold: 1.5,
  percentileLookback: 90,
  positionSizeMethod: 'volAdjusted',
  trailActivationATR: 1,
  fundingThresholdLong: -0.0003,
  fundingThresholdShort: 0.0005,
};

const V3_REGIME_PARAMS: Record<string, unknown> = {
  useRegimeFilter: true,
  bearMode: 'block',
  regimeMAType: 'ema',
  regimeSMAPeriod: 200,
};

// ============================================================================
// Allocation config definitions
// ============================================================================

interface AllocConfig {
  /** Human-readable label for the comparison table */
  label: string;
  /** Label used in DB run names */
  dbLabel: string;
  allocationMode: AllocationMode;
  maxPositions: number;
}

const ALLOC_CONFIGS: AllocConfig[] = [
  {
    label: 'SS mp=1',
    dbLabel: 'single_strongest mp=1',
    allocationMode: 'single_strongest',
    maxPositions: 1,
  },
  {
    label: 'top_n mp=3',
    dbLabel: 'top_n mp=3',
    allocationMode: 'top_n',
    maxPositions: 3,
  },
  {
    label: 'top_n mp=5',
    dbLabel: 'top_n mp=5',
    allocationMode: 'top_n',
    maxPositions: 5,
  },
  {
    label: 'weighted mp=3',
    dbLabel: 'weighted_multi mp=3',
    allocationMode: 'weighted_multi',
    maxPositions: 3,
  },
];

// ============================================================================
// Sub-strategy builder
// ============================================================================

function buildSubStrategies(
  strategyName: string,
  extraParams: Record<string, unknown> = {},
): SubStrategyConfig[] {
  return SYMBOLS.map((symbol) => ({
    strategyName,
    symbol,
    timeframe: TIMEFRAME,
    params: { ...SHARED_PARAMS, ...extraParams },
    exchange: EXCHANGE,
  }));
}

// ============================================================================
// DB aggregation config factory
// ============================================================================

function makeAggregationConfig(
  name: string,
  subStrategies: SubStrategyConfig[],
  allocationMode: AllocationMode,
  maxPositions: number,
): AggregationConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    allocationMode,
    maxPositions,
    subStrategies,
    subStrategyConfigIds: [],
    initialCapital: INITIAL_CAPITAL,
    exchange: EXCHANGE,
    mode: 'futures',
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Run a single aggregation backtest and save to DB
// ============================================================================

interface RunResult {
  configLabel: string;
  version: 'V2' | 'V3';
  result: AggregateBacktestResult;
  aggConfigId: string;
  durationSec: string;
}

async function runOne(
  alloc: AllocConfig,
  version: 'V2' | 'V3',
  subStrategies: SubStrategyConfig[],
  ts: string,
): Promise<RunResult> {
  const strategyName = version === 'V2' ? 'funding-rate-spike-v2' : 'funding-rate-spike-v3';
  const runName = `FR V2v3 Compare — ${alloc.dbLabel} — ${version} ${ts}`;

  const aggConfig = makeAggregationConfig(
    runName,
    subStrategies,
    alloc.allocationMode,
    alloc.maxPositions,
  );

  process.stderr.write(
    `\n[multi-config] === ${alloc.label} | ${version} (${strategyName}) ===\n`,
  );
  process.stderr.write(
    `[multi-config] Mode: ${alloc.allocationMode}, maxPositions=${alloc.maxPositions}\n`,
  );
  if (version === 'V3') {
    process.stderr.write(
      `[multi-config] Regime: useRegimeFilter=true, bearMode=block, regimeMAType=ema, regimeSMAPeriod=200\n`,
    );
  }

  await saveAggregationConfig(aggConfig);
  process.stderr.write(`[multi-config] Saved aggregation config: ${aggConfig.id}\n`);

  const startTime = Date.now();
  let result: AggregateBacktestResult;

  try {
    result = await runAggregateBacktest(
      {
        subStrategies,
        allocationMode: alloc.allocationMode,
        maxPositions: alloc.maxPositions,
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
            process.stderr.write(
              `[multi-config] ${alloc.label} ${version} progress: ${current}/${total} (${percent.toFixed(0)}%)\r`,
            );
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[multi-config] ${alloc.label} ${version} FAILED: ${msg}\n`);
    await closeDb();
    process.exit(1);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(
    `\n[multi-config] ${alloc.label} ${version} done in ${durationSec}s — ` +
    `Sharpe=${result.metrics.sharpeRatio.toFixed(2)}, ` +
    `Return=${result.metrics.totalReturnPercent.toFixed(1)}%, ` +
    `MaxDD=${result.metrics.maxDrawdownPercent.toFixed(1)}%, ` +
    `Trades=${result.metrics.totalTrades}\n`,
  );

  await saveBacktestRun(result, aggConfig.id);
  process.stderr.write(`[multi-config] Saved backtest run: ${result.id}\n`);

  return {
    configLabel: alloc.label,
    version,
    result,
    aggConfigId: aggConfig.id,
    durationSec,
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
  return n.toFixed(1) + '%';
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function rpad(s: string, width: number): string {
  return s.padStart(width);
}

// ============================================================================
// Print combined comparison table
// ============================================================================

function printCombinedTable(allRuns: RunResult[]): void {
  // Column widths
  const LABEL_W = 16;
  const COL_W = 11;

  const header =
    pad('Config', LABEL_W) +
    rpad('V2 Sharpe', COL_W) +
    rpad('V3 Sharpe', COL_W) +
    rpad('V2 Return', COL_W) +
    rpad('V3 Return', COL_W) +
    rpad('V2 MaxDD', COL_W) +
    rpad('V3 MaxDD', COL_W) +
    rpad('V2 Trades', COL_W) +
    rpad('V3 Trades', COL_W);

  const divider = '='.repeat(LABEL_W + COL_W * 8);

  console.log('\n' + divider);
  console.log('  COMBINED V2 vs V3 COMPARISON ACROSS ALLOCATION CONFIGS');
  console.log(divider);
  console.log(header);
  console.log('-'.repeat(LABEL_W + COL_W * 8));

  // Group by config label
  const byLabel = new Map<string, { v2?: RunResult; v3?: RunResult }>();
  for (const run of allRuns) {
    const entry = byLabel.get(run.configLabel) ?? {};
    if (run.version === 'V2') entry.v2 = run;
    else entry.v3 = run;
    byLabel.set(run.configLabel, entry);
  }

  // Print in the order of ALLOC_CONFIGS
  for (const alloc of ALLOC_CONFIGS) {
    const entry = byLabel.get(alloc.label);
    if (!entry) continue;

    const v2m = entry.v2?.result.metrics;
    const v3m = entry.v3?.result.metrics;

    const row =
      pad(alloc.label, LABEL_W) +
      rpad(v2m ? fmt(v2m.sharpeRatio) : 'N/A', COL_W) +
      rpad(v3m ? fmt(v3m.sharpeRatio) : 'N/A', COL_W) +
      rpad(v2m ? fmtPct(v2m.totalReturnPercent) : 'N/A', COL_W) +
      rpad(v3m ? fmtPct(v3m.totalReturnPercent) : 'N/A', COL_W) +
      rpad(v2m ? fmtPct(v2m.maxDrawdownPercent) : 'N/A', COL_W) +
      rpad(v3m ? fmtPct(v3m.maxDrawdownPercent) : 'N/A', COL_W) +
      rpad(v2m ? String(v2m.totalTrades) : 'N/A', COL_W) +
      rpad(v3m ? String(v3m.totalTrades) : 'N/A', COL_W);

    console.log(row);
  }

  console.log(divider);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[multi-config] Initializing database...\n');
  await initDb();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const totalRuns = ALLOC_CONFIGS.length * 2;

  process.stderr.write(
    `[multi-config] Starting ${totalRuns} runs (${ALLOC_CONFIGS.length} configs × V2 + V3)\n`,
  );
  process.stderr.write(
    `[multi-config] Symbols: ${SYMBOLS.length}, Period: 2024-01-01 to 2026-03-01\n`,
  );
  process.stderr.write(
    `[multi-config] Estimated time: ~${totalRuns * 85}s (~${Math.ceil((totalRuns * 85) / 60)} minutes)\n`,
  );

  const v2SubStrategies = buildSubStrategies('funding-rate-spike-v2');
  const v3SubStrategies = buildSubStrategies('funding-rate-spike-v3', V3_REGIME_PARAMS);

  const allRuns: RunResult[] = [];
  let runIndex = 0;

  for (const alloc of ALLOC_CONFIGS) {
    // V2 first, then V3
    for (const version of ['V2', 'V3'] as const) {
      runIndex++;
      process.stderr.write(
        `\n[multi-config] --- Run ${runIndex}/${totalRuns}: ${alloc.label} ${version} ---\n`,
      );

      const subStrategies = version === 'V2' ? v2SubStrategies : v3SubStrategies;
      const run = await runOne(alloc, version, subStrategies, ts);
      allRuns.push(run);
    }
  }

  // Print the final combined table
  printCombinedTable(allRuns);

  console.log('\nAll runs saved to database.');
  console.log('\nRun details:');
  for (const run of allRuns) {
    console.log(
      `  ${run.configLabel} ${run.version}: ` +
      `aggConfig=${run.aggConfigId}, ` +
      `run=${run.result.id}, ` +
      `time=${run.durationSec}s`,
    );
  }

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(
    `\n[multi-config] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
