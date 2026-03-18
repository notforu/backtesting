#!/usr/bin/env node
/**
 * Edge Decay Analysis — FR V2, 7 WF-validated symbols, top_n mp=3
 *
 * Splits the backtest window into sub-periods and checks whether the
 * funding-rate edge is decaying (or improving) over time.
 *
 * Sub-periods:
 *   H1 2024  2024-01-01 → 2024-07-01
 *   H2 2024  2024-07-01 → 2025-01-01
 *   H1 2025  2025-01-01 → 2025-07-01
 *   H2 2025  2025-07-01 → 2026-01-01
 *   2026 YTD 2026-01-01 → 2026-03-01
 *
 * Plus a full-period run for reference.
 *
 * Results are NOT saved to DB — analysis only.
 *
 * Usage:
 *   npx tsx scripts/analyze-edge-decay.ts
 */

import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Period definitions
// ============================================================================

interface Period {
  label: string;
  startDate: number; // Unix ms
  endDate: number;   // Unix ms
}

const PERIODS: Period[] = [
  { label: 'H1 2024',  startDate: Date.UTC(2024, 0, 1),  endDate: Date.UTC(2024, 6, 1)  },
  { label: 'H2 2024',  startDate: Date.UTC(2024, 6, 1),  endDate: Date.UTC(2025, 0, 1)  },
  { label: 'H1 2025',  startDate: Date.UTC(2025, 0, 1),  endDate: Date.UTC(2025, 6, 1)  },
  { label: 'H2 2025',  startDate: Date.UTC(2025, 6, 1),  endDate: Date.UTC(2026, 0, 1)  },
  { label: '2026 YTD', startDate: Date.UTC(2026, 0, 1),  endDate: Date.UTC(2026, 2, 1)  },
];

const FULL_PERIOD: Period = {
  label: 'FULL PERIOD',
  startDate: Date.UTC(2024, 0, 1),
  endDate: Date.UTC(2026, 2, 1),
};

// ============================================================================
// Strategy config
// ============================================================================

const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;
const INITIAL_CAPITAL = 10_000;

/**
 * Params shared by all symbols (common baseline).
 * Per-symbol overrides are merged in PER_SYMBOL_PARAMS below.
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

const SUB_STRATEGIES = buildSubStrategies();

// ============================================================================
// Run one period
// ============================================================================

async function runPeriod(period: Period): Promise<AggregateBacktestResult> {
  const result = await runAggregateBacktest(
    {
      subStrategies: SUB_STRATEGIES,
      allocationMode: 'top_n',
      maxPositions: 3,
      initialCapital: INITIAL_CAPITAL,
      startDate: period.startDate,
      endDate: period.endDate,
      exchange: EXCHANGE,
      mode: 'futures',
    },
    {
      enableLogging: false,
      saveResults: false,
      skipFundingRateValidation: false,
      skipCandleValidation: false,
      onProgress: ({ current, total, percent }) => {
        if (current % 200 === 0 || current === total) {
          process.stderr.write(
            `[edge-decay] ${period.label}: ${current}/${total} (${percent.toFixed(0)}%)\r`,
          );
        }
      },
    },
  );
  return result;
}

// ============================================================================
// Formatting
// ============================================================================

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n === undefined || n === null || isNaN(n)) return ' N/A  ';
  return n.toFixed(decimals);
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '  N/A  ';
  return n.toFixed(1) + '%';
}

function col(s: string, width: number): string {
  return s.padStart(width);
}

// ============================================================================
// Table printer
// ============================================================================

interface PeriodRow {
  label: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  pf: number;
}

function printTable(rows: PeriodRow[], fullRow: PeriodRow): void {
  const SEP = '=================================================================';
  const DASH = '-----------------------------------------------------------------';

  console.log('\n' + SEP);
  console.log('  EDGE DECAY ANALYSIS — FR V2, 7 sym WF-opt, top_n mp=3');
  console.log(SEP);

  const header =
    col('Period', 12) + ' | ' +
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
      col(r.label, 12) + ' | ' +
      col(fmt(r.sharpe), 6) + ' | ' +
      col(fmtPct(r.returnPct), 8) + ' | ' +
      col(fmtPct(r.maxDD), 7) + ' | ' +
      col(String(r.trades), 6) + ' | ' +
      col(fmtPct(r.winRate), 7) + ' | ' +
      col(fmt(r.pf), 5);
    console.log(line);
  }

  console.log(DASH);

  const fl =
    col(fullRow.label, 12) + ' | ' +
    col(fmt(fullRow.sharpe), 6) + ' | ' +
    col(fmtPct(fullRow.returnPct), 8) + ' | ' +
    col(fmtPct(fullRow.maxDD), 7) + ' | ' +
    col(String(fullRow.trades), 6) + ' | ' +
    col(fmtPct(fullRow.winRate), 7) + ' | ' +
    col(fmt(fullRow.pf), 5);
  console.log(fl);
  console.log(SEP);
}

// ============================================================================
// Trend analysis
// ============================================================================

function analyseTrend(rows: PeriodRow[]): void {
  // Use first-3 vs last-2 comparison (since we have unequal period lengths)
  const sharpes = rows.map((r) => r.sharpe);
  const trades = rows.map((r) => r.trades);
  const winRates = rows.map((r) => r.winRate);

  // Linear regression slope on sharpe values
  function slope(values: number[]): number {
    const n = values.length;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (values[i] - yMean);
      den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  const sharpeSlope = slope(sharpes);
  const tradeSlope = slope(trades);
  const winRateSlope = slope(winRates);

  // Determine trend label
  let trendLabel: string;
  if (sharpeSlope < -0.15) {
    trendLabel = 'DECAYING';
  } else if (sharpeSlope > 0.15) {
    trendLabel = 'IMPROVING';
  } else {
    trendLabel = 'STABLE';
  }

  console.log(`\nTrend: [${trendLabel}]`);
  console.log('');

  // Sharpe trend
  const sharpeDir = sharpeSlope > 0.05 ? 'rising' : sharpeSlope < -0.05 ? 'falling' : 'flat';
  console.log(`Sharpe over time:   ${sharpes.map((s) => fmt(s)).join('  →  ')}  (slope: ${sharpeSlope.toFixed(3)}, ${sharpeDir})`);

  // Trade count trend
  const tradeDir = tradeSlope > 1 ? 'increasing' : tradeSlope < -1 ? 'dropping' : 'stable';
  console.log(`Trades over time:   ${trades.join('  →  ')}  (slope: ${tradeSlope.toFixed(1)}, ${tradeDir})`);

  // Win rate trend
  const wrDir = winRateSlope > 0.5 ? 'rising' : winRateSlope < -0.5 ? 'falling' : 'stable';
  console.log(`Win rate over time: ${winRates.map((w) => fmtPct(w)).join('  →  ')}  (slope: ${winRateSlope.toFixed(3)}, ${wrDir})`);

  console.log('');

  // Specific checks
  const sharpeDrop = sharpeSlope < -0.15;
  const tradesDrop = tradeSlope < -2;
  const winRateUnstable = Math.max(...winRates) - Math.min(...winRates) > 15;

  console.log(`Is Sharpe trending down?        ${sharpeDrop ? 'YES — edge may be decaying' : 'No — edge appears persistent'}`);
  console.log(`Is trade count dropping?        ${tradesDrop ? 'YES — fewer signals being generated' : 'No — signal frequency is stable'}`);
  console.log(`Is win rate stable (<15% range)? ${winRateUnstable ? 'NO — high variance in win rate' : 'Yes — win rate is consistent'}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[edge-decay] Initializing database...\n');
  await initDb();

  const periodResults: PeriodRow[] = [];

  // Run sub-periods sequentially (to avoid DB/memory contention)
  for (const period of PERIODS) {
    process.stderr.write(`\n[edge-decay] === Running ${period.label} ===\n`);
    process.stderr.write(`[edge-decay] ${new Date(period.startDate).toISOString().slice(0, 10)} → ${new Date(period.endDate).toISOString().slice(0, 10)}\n`);

    const t0 = Date.now();
    let result: AggregateBacktestResult;
    try {
      result = await runPeriod(period);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n[edge-decay] ${period.label} FAILED: ${msg}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(err.stack + '\n');
      }
      await closeDb();
      process.exit(1);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const m = result.metrics;
    process.stderr.write(
      `\n[edge-decay] ${period.label} done in ${elapsed}s — ` +
      `Sharpe=${fmt(m.sharpeRatio)}, Return=${fmtPct(m.totalReturnPercent)}, ` +
      `MaxDD=${fmtPct(m.maxDrawdownPercent)}, Trades=${m.totalTrades}\n`,
    );

    periodResults.push({
      label: period.label,
      sharpe: m.sharpeRatio,
      returnPct: m.totalReturnPercent,
      maxDD: m.maxDrawdownPercent,
      trades: m.totalTrades,
      winRate: m.winRate ?? 0,
      pf: m.profitFactor ?? 0,
    });
  }

  // Run full period
  process.stderr.write(`\n[edge-decay] === Running FULL PERIOD ===\n`);
  process.stderr.write(`[edge-decay] ${new Date(FULL_PERIOD.startDate).toISOString().slice(0, 10)} → ${new Date(FULL_PERIOD.endDate).toISOString().slice(0, 10)}\n`);

  const t0Full = Date.now();
  let fullResult: AggregateBacktestResult;
  try {
    fullResult = await runPeriod(FULL_PERIOD);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[edge-decay] FULL PERIOD FAILED: ${msg}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    await closeDb();
    process.exit(1);
  }

  const elapsedFull = ((Date.now() - t0Full) / 1000).toFixed(1);
  const mf = fullResult.metrics;
  process.stderr.write(
    `\n[edge-decay] FULL PERIOD done in ${elapsedFull}s — ` +
    `Sharpe=${fmt(mf.sharpeRatio)}, Return=${fmtPct(mf.totalReturnPercent)}, ` +
    `MaxDD=${fmtPct(mf.maxDrawdownPercent)}, Trades=${mf.totalTrades}\n`,
  );

  const fullRow: PeriodRow = {
    label: 'FULL PERIOD',
    sharpe: mf.sharpeRatio,
    returnPct: mf.totalReturnPercent,
    maxDD: mf.maxDrawdownPercent,
    trades: mf.totalTrades,
    winRate: mf.winRate ?? 0,
    pf: mf.profitFactor ?? 0,
  };

  // Print results table
  printTable(periodResults, fullRow);

  // Print trend analysis
  analyseTrend(periodResults);

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(`\n[edge-decay] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
