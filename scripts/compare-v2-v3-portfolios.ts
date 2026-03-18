#!/usr/bin/env node
/**
 * Compare FR V2 vs V3 across different sub-strategy SETS (portfolios).
 *
 * Portfolios:
 *   1. "13 sym default"     — all 13 symbols with default params
 *   2. "7 V2-WF optimized"  — 7 walk-forward validated symbols with V2 optimized params
 *   3. "3 V3-WF optimized"  — 3 walk-forward validated symbols with V3 optimized params
 *   4. "5 robust combined"  — 3 V3-validated + 2 remaining V2-validated
 *
 * Allocation modes per portfolio:
 *   - single_strongest, maxPositions=1
 *   - top_n, maxPositions=min(3, numSymbols)
 *
 * Versions per (portfolio × alloc mode):
 *   - V2 (funding-rate-spike-v2)
 *   - V3 (funding-rate-spike-v3) — adds regime filter params
 *
 * Total: 4 portfolios × 2 alloc modes × 2 versions = 16 runs
 *
 * Usage:
 *   npx tsx scripts/compare-v2-v3-portfolios.ts
 */

import { randomUUID } from 'crypto';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb, saveAggregationConfig, saveBacktestRun } from '../src/data/db.js';
import type { AggregationConfig } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig, AllocationMode } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Global config
// ============================================================================

const START_DATE = 1704067200000; // 2024-01-01
const END_DATE   = 1772323200000; // 2026-03-01
const INITIAL_CAPITAL = 10000;
const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;

// ============================================================================
// Default params shared by all sub-strategies unless overridden
// ============================================================================

const DEFAULT_PARAMS: Record<string, unknown> = {
  holdingPeriods: 3,
  shortPercentile: 95,
  longPercentile: 5,
  atrStopMultiplier: 2.5,
  atrTPMultiplier: 3.5,
  atrPeriod: 14,
  useATRStops: true,
  stopLossPct: 3,
  takeProfitPct: 4,
  usePercentile: true,
  percentileLookback: 90,
  useTrendFilter: true,
  trendSMAPeriod: 50,
  atrFilterEnabled: true,
  atrFilterThreshold: 1.5,
  positionSizePct: 50,
  positionSizeMethod: 'volAdjusted',
  kellyFraction: 0.5,
  kellySampleSize: 20,
  maxPositionPct: 50,
  minPositionPct: 15,
  useTrailingStop: false,
  trailDistanceATR: 2,
  trailActivationATR: 1,
  useFRVelocity: false,
  frVelocityBars: 1,
  fundingThresholdLong: -0.0003,
  fundingThresholdShort: 0.0005,
};

// Additional params applied to every V3 sub-strategy
const V3_REGIME_PARAMS: Record<string, unknown> = {
  useRegimeFilter: true,
  bearMode: 'block',
  regimeMAType: 'ema',
  regimeSMAPeriod: 200,
};

// ============================================================================
// Portfolio definitions
// ============================================================================

/** A single symbol + its per-symbol param overrides (on top of DEFAULT_PARAMS) */
interface SymbolEntry {
  symbol: string;
  overrides?: Record<string, unknown>;
}

interface Portfolio {
  /** Human-readable name for the table */
  name: string;
  /** Short DB-friendly label */
  dbLabel: string;
  entries: SymbolEntry[];
}

// ---------- Portfolio 1: 13 symbols, all default ----------
const P1_SYMBOLS = [
  'IOST', 'ZEC', 'ARB', 'IOTA', 'TRB', 'STG', 'COTI',
  'ENJ', 'KAVA', 'APT', 'COMP', 'RPL', 'BCH',
];

const PORTFOLIO_1: Portfolio = {
  name: '13 sym default',
  dbLabel: '13sym-default',
  entries: P1_SYMBOLS.map((s) => ({ symbol: `${s}/USDT:USDT` })),
};

// ---------- Portfolio 2: 7 V2-WF optimized ----------
const PORTFOLIO_2: Portfolio = {
  name: '7 V2-WF opt',
  dbLabel: '7sym-v2wf',
  entries: [
    {
      symbol: 'ZEC/USDT:USDT',
      overrides: { holdingPeriods: 2, shortPercentile: 98, longPercentile: 4, atrStopMultiplier: 2.5, atrTPMultiplier: 4.5 },
    },
    {
      symbol: 'LDO/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 96, longPercentile: 2, atrStopMultiplier: 3.5, atrTPMultiplier: 3.5 },
    },
    {
      symbol: 'TRB/USDT:USDT',
      overrides: { holdingPeriods: 2, shortPercentile: 98, longPercentile: 6, atrStopMultiplier: 2.5, atrTPMultiplier: 5 },
    },
    {
      symbol: 'XLM/USDT:USDT',
      overrides: { holdingPeriods: 6, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 3, atrTPMultiplier: 5 },
    },
    {
      symbol: 'IOST/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 94, longPercentile: 4, atrStopMultiplier: 3.5, atrTPMultiplier: 2.5 },
    },
    {
      symbol: 'NEAR/USDT:USDT',
      overrides: { holdingPeriods: 3, shortPercentile: 96, longPercentile: 6, atrStopMultiplier: 3, atrTPMultiplier: 2.5 },
    },
    {
      symbol: 'STG/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 1.5, atrTPMultiplier: 2.5 },
    },
  ],
};

// ---------- Portfolio 3: 3 V3-WF optimized ----------
const PORTFOLIO_3: Portfolio = {
  name: '3 V3-WF opt',
  dbLabel: '3sym-v3wf',
  entries: [
    {
      symbol: 'ZEC/USDT:USDT',
      overrides: { holdingPeriods: 2, shortPercentile: 98, longPercentile: 6, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
    {
      symbol: 'LDO/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 94, longPercentile: 2, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
    {
      symbol: 'DOGE/USDT:USDT',
      overrides: { holdingPeriods: 8, shortPercentile: 98, longPercentile: 12, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
  ],
};

// ---------- Portfolio 4: 5 robust combined ----------
const PORTFOLIO_4: Portfolio = {
  name: '5 robust combined',
  dbLabel: '5sym-robust',
  entries: [
    // V3-validated (no ATR stops)
    {
      symbol: 'ZEC/USDT:USDT',
      overrides: { holdingPeriods: 2, shortPercentile: 98, longPercentile: 6, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
    {
      symbol: 'LDO/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 94, longPercentile: 2, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
    {
      symbol: 'DOGE/USDT:USDT',
      overrides: { holdingPeriods: 8, shortPercentile: 98, longPercentile: 12, atrStopMultiplier: 2.5, atrTPMultiplier: 3.5, useATRStops: false },
    },
    // V2-validated (with ATR stops)
    {
      symbol: 'NEAR/USDT:USDT',
      overrides: { holdingPeriods: 3, shortPercentile: 96, longPercentile: 6, atrStopMultiplier: 3, atrTPMultiplier: 2.5 },
    },
    {
      symbol: 'STG/USDT:USDT',
      overrides: { holdingPeriods: 4, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 1.5, atrTPMultiplier: 2.5 },
    },
  ],
};

const PORTFOLIOS: Portfolio[] = [PORTFOLIO_1, PORTFOLIO_2, PORTFOLIO_3, PORTFOLIO_4];

// ============================================================================
// Allocation modes
// ============================================================================

interface AllocConfig {
  /** Short label for table column (will be combined with portfolio name) */
  label: string;
  allocationMode: AllocationMode;
  /** maxPositions will be resolved per portfolio: min(requested, numSymbols) */
  requestedMaxPositions: number;
}

const ALLOC_CONFIGS: AllocConfig[] = [
  { label: 'SS mp=1',     allocationMode: 'single_strongest', requestedMaxPositions: 1 },
  { label: 'top_n mp=3',  allocationMode: 'top_n',            requestedMaxPositions: 3 },
];

// ============================================================================
// Sub-strategy builder
// ============================================================================

/**
 * Build sub-strategies for a given portfolio, merging DEFAULT_PARAMS → per-symbol
 * overrides → extra params (e.g. V3 regime filter).
 */
function buildSubStrategies(
  portfolio: Portfolio,
  strategyName: string,
  extraParams: Record<string, unknown> = {},
): SubStrategyConfig[] {
  return portfolio.entries.map((entry) => ({
    strategyName,
    symbol: entry.symbol,
    timeframe: TIMEFRAME,
    params: { ...DEFAULT_PARAMS, ...(entry.overrides ?? {}), ...extraParams },
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
// Single run
// ============================================================================

interface RunResult {
  portfolioName: string;
  allocLabel: string;
  version: 'V2' | 'V3';
  result: AggregateBacktestResult;
  aggConfigId: string;
  durationSec: string;
}

async function runOne(
  portfolio: Portfolio,
  alloc: AllocConfig,
  version: 'V2' | 'V3',
  ts: string,
): Promise<RunResult> {
  const strategyName = version === 'V2' ? 'funding-rate-spike-v2' : 'funding-rate-spike-v3';
  const extraParams = version === 'V3' ? V3_REGIME_PARAMS : {};

  const numSymbols = portfolio.entries.length;
  const maxPositions = Math.min(alloc.requestedMaxPositions, numSymbols);

  const subStrategies = buildSubStrategies(portfolio, strategyName, extraParams);

  const runName = `FR V2v3 Portfolios — ${portfolio.dbLabel} — ${alloc.label} — ${version} ${ts}`;
  const aggConfig = makeAggregationConfig(
    runName,
    subStrategies,
    alloc.allocationMode,
    maxPositions,
  );

  process.stderr.write(
    `\n[portfolios] === ${portfolio.name} | ${alloc.label} | ${version} (${strategyName}) ===\n`,
  );
  process.stderr.write(
    `[portfolios] Symbols: ${numSymbols}, Mode: ${alloc.allocationMode}, maxPositions=${maxPositions}\n`,
  );
  if (version === 'V3') {
    process.stderr.write(
      `[portfolios] Regime: useRegimeFilter=true, bearMode=block, regimeMAType=ema, regimeSMAPeriod=200\n`,
    );
  }

  await saveAggregationConfig(aggConfig);
  process.stderr.write(`[portfolios] Saved aggregation config: ${aggConfig.id}\n`);

  const startTime = Date.now();
  let result: AggregateBacktestResult;

  try {
    result = await runAggregateBacktest(
      {
        subStrategies,
        allocationMode: alloc.allocationMode,
        maxPositions,
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
              `[portfolios] ${portfolio.name} | ${alloc.label} | ${version} progress: ${current}/${total} (${percent.toFixed(0)}%)\r`,
            );
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[portfolios] ${portfolio.name} | ${alloc.label} | ${version} FAILED: ${msg}\n`);
    await closeDb();
    process.exit(1);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(
    `\n[portfolios] ${portfolio.name} | ${alloc.label} | ${version} done in ${durationSec}s — ` +
    `Sharpe=${result.metrics.sharpeRatio.toFixed(2)}, ` +
    `Return=${result.metrics.totalReturnPercent.toFixed(1)}%, ` +
    `MaxDD=${result.metrics.maxDrawdownPercent.toFixed(1)}%, ` +
    `Trades=${result.metrics.totalTrades}\n`,
  );

  await saveBacktestRun(result, aggConfig.id);
  process.stderr.write(`[portfolios] Saved backtest run: ${result.id}\n`);

  return {
    portfolioName: portfolio.name,
    allocLabel: alloc.label,
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
  const PORTFOLIO_W = 20;
  const ALLOC_W = 12;
  const COL_W = 11;

  const totalWidth = PORTFOLIO_W + ALLOC_W + COL_W * 8;

  const header =
    pad('Portfolio', PORTFOLIO_W) +
    pad('Alloc', ALLOC_W) +
    rpad('V2 Sharpe', COL_W) +
    rpad('V3 Sharpe', COL_W) +
    rpad('V2 Return', COL_W) +
    rpad('V3 Return', COL_W) +
    rpad('V2 MaxDD', COL_W) +
    rpad('V3 MaxDD', COL_W) +
    rpad('V2 Trades', COL_W) +
    rpad('V3 Trades', COL_W);

  const divider = '='.repeat(totalWidth);

  console.log('\n' + divider);
  console.log('  COMBINED V2 vs V3 COMPARISON ACROSS PORTFOLIO SETS');
  console.log(divider);
  console.log(header);
  console.log('-'.repeat(totalWidth));

  // Group by portfolioName + allocLabel
  const grouped = new Map<string, { v2?: RunResult; v3?: RunResult }>();
  for (const run of allRuns) {
    const key = `${run.portfolioName}|||${run.allocLabel}`;
    const entry = grouped.get(key) ?? {};
    if (run.version === 'V2') entry.v2 = run;
    else entry.v3 = run;
    grouped.set(key, entry);
  }

  // Print in canonical order
  for (const portfolio of PORTFOLIOS) {
    for (const alloc of ALLOC_CONFIGS) {
      const key = `${portfolio.name}|||${alloc.label}`;
      const entry = grouped.get(key);
      if (!entry) continue;

      const v2m = entry.v2?.result.metrics;
      const v3m = entry.v3?.result.metrics;

      const row =
        pad(portfolio.name, PORTFOLIO_W) +
        pad(alloc.label, ALLOC_W) +
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
  }

  console.log(divider);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[portfolios] Initializing database...\n');
  await initDb();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const totalRuns = PORTFOLIOS.length * ALLOC_CONFIGS.length * 2;
  process.stderr.write(
    `[portfolios] Starting ${totalRuns} runs ` +
    `(${PORTFOLIOS.length} portfolios × ${ALLOC_CONFIGS.length} alloc modes × V2+V3)\n`,
  );
  process.stderr.write(
    `[portfolios] Period: 2024-01-01 to 2026-03-01, initialCapital=$${INITIAL_CAPITAL}\n`,
  );
  process.stderr.write(
    `[portfolios] Estimated time: ~${totalRuns * 80}s (~${Math.ceil((totalRuns * 80) / 60)} min)\n`,
  );

  const allRuns: RunResult[] = [];
  let runIndex = 0;

  for (const portfolio of PORTFOLIOS) {
    for (const alloc of ALLOC_CONFIGS) {
      for (const version of ['V2', 'V3'] as const) {
        runIndex++;
        process.stderr.write(
          `\n[portfolios] --- Run ${runIndex}/${totalRuns}: ${portfolio.name} | ${alloc.label} | ${version} ---\n`,
        );

        const run = await runOne(portfolio, alloc, version, ts);
        allRuns.push(run);
      }
    }
  }

  // Print the final combined table
  printCombinedTable(allRuns);

  console.log('\nAll runs saved to database.');
  console.log('\nRun details:');
  for (const run of allRuns) {
    console.log(
      `  ${run.portfolioName} | ${run.allocLabel} | ${run.version}: ` +
      `aggConfig=${run.aggConfigId}, run=${run.result.id}, time=${run.durationSec}s`,
    );
  }

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(
    `\n[portfolios] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
