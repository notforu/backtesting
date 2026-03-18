#!/usr/bin/env node
/**
 * Slippage Sensitivity Analysis — FR V2, 7 sym WF-opt, top_n mp=3
 *
 * Tests how realistic slippage levels degrade the best V2 configuration.
 * Runs the same portfolio at 5 slippage levels (0% to 0.20%) and reports
 * the break-even point where Sharpe drops below 1.0.
 *
 * Results are NOT saved to DB — analysis only.
 *
 * Usage:
 *   npx tsx scripts/slippage-sensitivity.ts
 */

import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Configuration
// ============================================================================

const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;
const INITIAL_CAPITAL = 10_000;

const START_DATE = Date.UTC(2024, 0, 1);   // 2024-01-01
const END_DATE   = Date.UTC(2026, 2, 1);   // 2026-03-01

const SLIPPAGE_LEVELS = [0.00, 0.05, 0.10, 0.15, 0.20];

/**
 * Params shared by all symbols (common baseline).
 */
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

/**
 * WF-optimised per-symbol overrides (V2, 7 symbols).
 */
const PER_SYMBOL_PARAMS: Record<string, Record<string, unknown>> = {
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
  'XLM/USDT:USDT': {
    holdingPeriods: 6,
    shortPercentile: 94,
    longPercentile: 10,
    atrStopMultiplier: 3,
    atrTPMultiplier: 5,
  },
  'IOST/USDT:USDT': {
    holdingPeriods: 4,
    shortPercentile: 94,
    longPercentile: 4,
    atrStopMultiplier: 3.5,
    atrTPMultiplier: 2.5,
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

function buildSubStrategies(): SubStrategyConfig[] {
  return Object.entries(PER_SYMBOL_PARAMS).map(([symbol, overrides]) => ({
    strategyName: 'funding-rate-spike-v2',
    symbol,
    timeframe: TIMEFRAME,
    params: { ...COMMON_PARAMS, ...overrides },
    exchange: EXCHANGE,
  }));
}

// ============================================================================
// Run at a single slippage level
// ============================================================================

async function runAtSlippage(
  slippagePct: number,
  runIndex: number,
  totalRuns: number,
): Promise<AggregateBacktestResult> {
  const tag = `slippage=${slippagePct.toFixed(2)}%`;

  return runAggregateBacktest(
    {
      subStrategies: buildSubStrategies(),
      allocationMode: 'top_n',
      maxPositions: 3,
      initialCapital: INITIAL_CAPITAL,
      startDate: START_DATE,
      endDate: END_DATE,
      exchange: EXCHANGE,
      mode: 'futures',
      slippagePercent: slippagePct,
    },
    {
      enableLogging: false,
      saveResults: false,
      skipFundingRateValidation: false,
      skipCandleValidation: false,
      onProgress: ({ current, total, percent }) => {
        if (current % 200 === 0 || current === total) {
          process.stderr.write(
            `\r[slippage] run ${runIndex + 1}/${totalRuns} (${tag}): ${current}/${total} bars (${percent.toFixed(0)}%)  `,
          );
        }
      },
    },
  );
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return 'N/A'.padStart(decimals + 4);
  return n.toFixed(decimals);
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return 'N/A'.padStart(6);
  return n.toFixed(1) + '%';
}

function col(s: string, width: number): string {
  return s.padStart(width);
}

// ============================================================================
// Table printer
// ============================================================================

interface SlippageRow {
  slippagePct: number;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  pf: number;
}

function printTable(rows: SlippageRow[]): void {
  const SEP  = '=================================================================';
  const DASH = '-----------------------------------------------------------------';

  console.log('\n' + SEP);
  console.log('  SLIPPAGE SENSITIVITY — FR V2, 7 sym WF-opt, top_n mp=3');
  console.log(SEP);

  const header =
    col('Slippage', 9) + ' | ' +
    col('Sharpe', 6) + ' | ' +
    col('Return%', 8) + ' | ' +
    col('MaxDD%', 7) + ' | ' +
    col('Trades', 6) + ' | ' +
    col('WinRate', 7) + ' | ' +
    col('PF', 5);
  console.log(header);
  console.log(DASH);

  for (const r of rows) {
    const line =
      col(r.slippagePct.toFixed(2) + '%', 9) + ' | ' +
      col(fmt(r.sharpe), 6) + ' | ' +
      col(fmtPct(r.returnPct), 8) + ' | ' +
      col(fmtPct(r.maxDD), 7) + ' | ' +
      col(String(r.trades), 6) + ' | ' +
      col(fmtPct(r.winRate), 7) + ' | ' +
      col(fmt(r.pf), 5);
    console.log(line);
  }

  console.log(SEP);
}

// ============================================================================
// Break-even analysis
// ============================================================================

function analyseBreakEven(rows: SlippageRow[]): void {
  const SHARPE_THRESHOLD = 1.0;

  // Find the first slippage level where Sharpe drops below 1.0
  let breakEvenSlippage: number | null = null;

  for (let i = 0; i < rows.length - 1; i++) {
    const curr = rows[i];
    const next = rows[i + 1];

    if (curr.sharpe >= SHARPE_THRESHOLD && next.sharpe < SHARPE_THRESHOLD) {
      // Linear interpolation between the two levels
      const dSharpe = next.sharpe - curr.sharpe;
      const dSlippage = next.slippagePct - curr.slippagePct;
      if (Math.abs(dSharpe) > 0.0001) {
        const t = (SHARPE_THRESHOLD - curr.sharpe) / dSharpe;
        breakEvenSlippage = curr.slippagePct + t * dSlippage;
      } else {
        breakEvenSlippage = curr.slippagePct;
      }
      break;
    }
  }

  // Check if Sharpe is already below threshold at the first level
  if (rows.length > 0 && rows[0].sharpe < SHARPE_THRESHOLD) {
    console.log(`Break-even slippage: <${rows[0].slippagePct.toFixed(2)}% (Sharpe already below 1.0 at baseline)`);
    return;
  }

  // Check if Sharpe stays above threshold across all tested levels
  if (breakEvenSlippage === null) {
    const last = rows[rows.length - 1];
    if (last.sharpe >= SHARPE_THRESHOLD) {
      console.log(`Break-even slippage: >${last.slippagePct.toFixed(2)}% (Sharpe remains above 1.0 at all tested levels)`);
    } else {
      console.log(`Break-even slippage: between ${rows[rows.length - 2].slippagePct.toFixed(2)}% and ${last.slippagePct.toFixed(2)}%`);
    }
    return;
  }

  console.log(`Break-even slippage: ~${breakEvenSlippage.toFixed(2)}%`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[slippage] Initializing database...\n');
  await initDb();

  const rows: SlippageRow[] = [];

  for (let i = 0; i < SLIPPAGE_LEVELS.length; i++) {
    const slippage = SLIPPAGE_LEVELS[i];
    const tag = `${slippage.toFixed(2)}%`;

    process.stderr.write(`\n[slippage] === Run ${i + 1}/${SLIPPAGE_LEVELS.length}: slippage=${tag} ===\n`);

    const t0 = Date.now();
    let result: AggregateBacktestResult;
    try {
      result = await runAtSlippage(slippage, i, SLIPPAGE_LEVELS.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n[slippage] Run at ${tag} FAILED: ${msg}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(err.stack + '\n');
      }
      await closeDb();
      process.exit(1);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const m = result.metrics;

    process.stderr.write(
      `\n[slippage] slippage=${tag} done in ${elapsed}s — ` +
      `Sharpe=${fmt(m.sharpeRatio)}, Return=${fmtPct(m.totalReturnPercent)}, ` +
      `MaxDD=${fmtPct(m.maxDrawdownPercent)}, Trades=${m.totalTrades}\n`,
    );

    rows.push({
      slippagePct: slippage,
      sharpe: m.sharpeRatio,
      returnPct: m.totalReturnPercent,
      maxDD: m.maxDrawdownPercent,
      trades: m.totalTrades,
      winRate: m.winRate ?? 0,
      pf: m.profitFactor ?? 0,
    });
  }

  // Print results table
  printTable(rows);

  // Print break-even analysis
  analyseBreakEven(rows);

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(
    `\n[slippage] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
