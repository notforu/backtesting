#!/usr/bin/env node
/**
 * Compare funding-rate-spike-v2 vs funding-rate-spike-v4
 *
 * Runs the top 3 aggregation configs twice — once with v2 and once with v4 —
 * then prints a side-by-side metrics comparison with deltas.
 *
 * Usage:
 *   npx tsx scripts/compare-v2-v4.ts
 */

import { initDb, closeDb, getAggregationConfig, saveBacktestRun, getPool } from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { Timeframe } from '../src/core/types.js';
import type { AggregateBacktestConfig } from '../src/core/signal-types.js';

// ---------------------------------------------------------------------------
// Default date range — used as fallback when no prior run is found.
// This matches the standard research window used across the codebase.
// ---------------------------------------------------------------------------

const DEFAULT_START_DATE = new Date('2024-01-01').getTime(); // 1704067200000
const DEFAULT_END_DATE   = new Date('2026-03-01').getTime(); // 1772323200000

/**
 * Look up the most recent backtest run linked to the given aggregation config ID
 * and return its start/end dates.  Falls back to the default window when no run
 * exists or the columns are null.
 */
async function getDateRangeForConfig(aggregationId: string): Promise<{ startDate: number; endDate: number }> {
  const p = getPool();
  const { rows } = await p.query<{ start_date: number | null; end_date: number | null }>(
    `SELECT start_date, end_date
     FROM backtest_runs
     WHERE aggregation_id = $1 AND start_date IS NOT NULL AND end_date IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [aggregationId]
  );

  if (rows.length > 0 && rows[0].start_date != null && rows[0].end_date != null) {
    return {
      startDate: Number(rows[0].start_date),
      endDate:   Number(rows[0].end_date),
    };
  }

  return { startDate: DEFAULT_START_DATE, endDate: DEFAULT_END_DATE };
}

// ---------------------------------------------------------------------------
// Aggregation config IDs to compare
// ---------------------------------------------------------------------------

const CONFIG_IDS = [
  'd1bc3a71-239c-427b-b007-178bde711248', // 7sym-v2wf top_n mp=3
  '8b4ab629-0428-486e-9b60-4382339c1c93', // 11 max top_n mp=5
  'bf5d8439-6986-4281-b9fe-1ce00322fe44', // V2 baseline 13 symbols SS
];

// ---------------------------------------------------------------------------
// Terminal color / formatting helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';

function bold(s: string): string  { return `${BOLD}${s}${RESET}`; }
function green(s: string): string { return `${GREEN}${s}${RESET}`; }
function red(s: string): string   { return `${RED}${s}${RESET}`; }
function cyan(s: string): string  { return `${CYAN}${s}${RESET}`; }
function dim(s: string): string   { return `${DIM}${s}${RESET}`; }

/** Strip ANSI escape codes to measure the visible length of a string. */
function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Left-pad a string so its visible width equals `width`. */
function lpad(s: string, width: number): string {
  const pad = Math.max(0, width - visLen(s));
  return ' '.repeat(pad) + s;
}

/** Right-pad a string so its visible width equals `width`. */
function rpad(s: string, width: number): string {
  const pad = Math.max(0, width - visLen(s));
  return s + ' '.repeat(pad);
}

function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

/** Format a delta as a coloured percentage string like "+1.23%" or "-4.56%". */
function fmtDelta(delta: number, decimals = 2, higherIsBetter = true): string {
  const sign = delta >= 0 ? '+' : '';
  const str  = `${sign}${delta.toFixed(decimals)}%`;
  const good = higherIsBetter ? delta >= 0 : delta <= 0;
  return good ? green(str) : red(str);
}

/** Format a delta in percentage-points (for win rate). */
function fmtDeltaPP(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  const str  = `${sign}${delta.toFixed(1)} pp`;
  return delta >= 0 ? green(str) : red(str);
}

// ---------------------------------------------------------------------------
// Main comparison logic
// ---------------------------------------------------------------------------

interface RunMetrics {
  sharpe:     number;
  returnPct:  number;
  maxDD:      number;
  trades:     number;
  winRate:    number;
  profitFact: number;
  engineSL:   number;
  engineTP:   number;
  pessimistic: number;
}

function extractMetrics(result: Awaited<ReturnType<typeof runAggregateBacktest>>): RunMetrics {
  const m = result.metrics as Record<string, number>;
  return {
    sharpe:      m['sharpeRatio']     ?? 0,
    returnPct:   m['totalReturnPercent']  ?? 0,
    maxDD:       m['maxDrawdownPercent']  ?? 0,
    trades:      m['totalTrades']     ?? 0,
    winRate:     m['winRate']         ?? 0,
    profitFact:  m['profitFactor']    ?? 0,
    engineSL:    m['engineStopLossCount']  ?? 0,
    engineTP:    m['engineTakeProfitCount'] ?? 0,
    pessimistic: m['pessimisticSlTpCount']  ?? 0,
  };
}

function printComparison(name: string, allocationMode: string, maxPositions: number, v2: RunMetrics, v4: RunMetrics): void {
  console.log('');
  console.log(bold(`=== Config: ${name} (${allocationMode} mp=${maxPositions}) ===`));

  // Column widths
  const COL_LABEL = 12;
  const COL_VAL   = 12;
  const COL_DELTA = 14;

  const header = rpad('', COL_LABEL) +
    lpad(bold('V2'), COL_VAL) +
    lpad(bold('V4'), COL_VAL) +
    lpad(bold('Delta'), COL_DELTA);
  console.log(header);
  console.log(dim('-'.repeat(COL_LABEL + COL_VAL + COL_VAL + COL_DELTA)));

  function row(label: string, v2Val: string, v4Val: string, delta: string): void {
    console.log(
      rpad(label, COL_LABEL) +
      lpad(v2Val, COL_VAL) +
      lpad(v4Val, COL_VAL) +
      lpad(delta, COL_DELTA)
    );
  }

  // Sharpe ratio — higher is better
  const sharpe2 = fmt(v2.sharpe);
  const sharpe4 = fmt(v4.sharpe);
  const sharpeDelta = v2.sharpe !== 0
    ? fmtDelta(((v4.sharpe - v2.sharpe) / Math.abs(v2.sharpe)) * 100, 2, true)
    : fmtDelta(v4.sharpe * 100, 2, true);
  row('Sharpe', sharpe2, sharpe4, sharpeDelta);

  // Return % — higher is better
  const ret2 = fmt(v2.returnPct, 2);
  const ret4 = fmt(v4.returnPct, 2);
  const retDelta = v2.returnPct !== 0
    ? fmtDelta(((v4.returnPct - v2.returnPct) / Math.abs(v2.returnPct)) * 100, 2, true)
    : fmtDelta(v4.returnPct * 100, 2, true);
  row('Return%', ret2, ret4, retDelta);

  // Max drawdown — lower is better
  const dd2 = fmt(v2.maxDD, 2);
  const dd4 = fmt(v4.maxDD, 2);
  const ddDelta = v2.maxDD !== 0
    ? fmtDelta(((v4.maxDD - v2.maxDD) / Math.abs(v2.maxDD)) * 100, 2, false)
    : fmtDelta(v4.maxDD * 100, 2, false);
  row('MaxDD%', dd2, dd4, ddDelta);

  // Trades (count, no colour)
  const tradeDelta = v4.trades - v2.trades;
  const tradeDeltaStr = `${tradeDelta >= 0 ? '+' : ''}${tradeDelta}`;
  row('Trades', String(v2.trades), String(v4.trades), tradeDeltaStr);

  // Win rate — higher is better (pp delta)
  // winRate from calculateMetrics() is a fraction (0-1). Guard against cases
  // where an older stored result has it as a percentage (0-100) already.
  const displayWR = (wr: number): number => (wr > 1 ? wr : wr * 100);
  const wr2 = `${fmt(displayWR(v2.winRate), 1)}%`;
  const wr4 = `${fmt(displayWR(v4.winRate), 1)}%`;
  const wrDeltaPP = displayWR(v4.winRate) - displayWR(v2.winRate);
  row('WinRate', wr2, wr4, fmtDeltaPP(wrDeltaPP));

  // Profit factor — higher is better
  const pf2 = fmt(v2.profitFact, 2);
  const pf4 = fmt(v4.profitFact, 2);
  const pfDelta = v2.profitFact !== 0
    ? fmtDelta(((v4.profitFact - v2.profitFact) / Math.abs(v2.profitFact)) * 100, 2, true)
    : fmtDelta(v4.profitFact * 100, 2, true);
  row('ProfitFact', pf2, pf4, pfDelta);

  // Engine SL/TP stats (v4 only)
  console.log('');
  console.log(cyan('Engine SL/TP Stats (v4 only):'));
  console.log(`  Engine SL exits:             ${v4.engineSL}`);
  console.log(`  Engine TP exits:             ${v4.engineTP}`);
  console.log(`  Pessimistic (SL won):        ${v4.pessimistic}`);
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

interface SummaryRow {
  name:       string;
  v2Sharpe:   number;
  v4Sharpe:   number;
  v2Return:   number;
  v4Return:   number;
  v2MaxDD:    number;
  v4MaxDD:    number;
}

function printSummary(rows: SummaryRow[]): void {
  console.log('');
  console.log(bold('================================================================'));
  console.log(bold('SUMMARY'));
  console.log(bold('================================================================'));

  const COL_NAME   = 40;
  const COL_VAL    = 10;

  console.log(
    rpad('Config', COL_NAME) +
    lpad('V2 Sharpe', COL_VAL) +
    lpad('V4 Sharpe', COL_VAL) +
    lpad('V2 Ret%', COL_VAL) +
    lpad('V4 Ret%', COL_VAL) +
    lpad('V2 MaxDD', COL_VAL) +
    lpad('V4 MaxDD', COL_VAL)
  );
  console.log(dim('-'.repeat(COL_NAME + COL_VAL * 6)));

  for (const r of rows) {
    const sharpeColor = r.v4Sharpe >= r.v2Sharpe ? green : red;
    const retColor    = r.v4Return >= r.v2Return  ? green : red;
    const ddColor     = r.v4MaxDD  <= r.v2MaxDD   ? green : red;

    console.log(
      rpad(r.name.slice(0, COL_NAME - 1), COL_NAME) +
      lpad(fmt(r.v2Sharpe), COL_VAL) +
      lpad(sharpeColor(fmt(r.v4Sharpe)), COL_VAL) +
      lpad(fmt(r.v2Return, 1), COL_VAL) +
      lpad(retColor(fmt(r.v4Return, 1)), COL_VAL) +
      lpad(fmt(r.v2MaxDD, 1), COL_VAL) +
      lpad(ddColor(fmt(r.v4MaxDD, 1)), COL_VAL)
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await initDb();
  console.log(bold('funding-rate-spike-v2 vs v4 — Aggregate Config Comparison'));
  console.log(dim(`Configs: ${CONFIG_IDS.length}`));

  const summaryRows: SummaryRow[] = [];

  for (const configId of CONFIG_IDS) {
    // -----------------------------------------------------------------------
    // Load config from DB
    // -----------------------------------------------------------------------
    let config;
    try {
      config = await getAggregationConfig(configId);
    } catch (err) {
      console.error(`Failed to load config ${configId}:`, err);
      continue;
    }

    if (!config) {
      console.warn(`Config ${configId} not found in DB — skipping`);
      continue;
    }

    console.log('');
    console.log(dim(`Loading config: ${config.name} (${configId})`));

    // -----------------------------------------------------------------------
    // Resolve date range: reuse dates from the most recent run for this config,
    // or fall back to the standard research window.
    // -----------------------------------------------------------------------
    const { startDate, endDate } = await getDateRangeForConfig(configId);
    console.log(dim(`  Date range: ${new Date(startDate).toISOString().slice(0, 10)} — ${new Date(endDate).toISOString().slice(0, 10)}`));

    // -----------------------------------------------------------------------
    // Build the aggregate config (v2 uses original strategy names)
    // -----------------------------------------------------------------------
    const baseAggConfig: AggregateBacktestConfig = {
      subStrategies: config.subStrategies.map(s => ({
        strategyName: s.strategyName,
        symbol:       s.symbol,
        timeframe:    s.timeframe as Timeframe,
        params:       s.params ?? {},
        exchange:     s.exchange ?? config.exchange,
      })),
      allocationMode: config.allocationMode as 'single_strongest' | 'top_n' | 'weighted_multi',
      maxPositions:   config.maxPositions,
      initialCapital: config.initialCapital,
      startDate,
      endDate,
      exchange:       config.exchange,
      mode:           (config.mode as 'spot' | 'futures') || 'futures',
    };

    // -----------------------------------------------------------------------
    // Run v2
    // -----------------------------------------------------------------------
    console.log(dim(`  Running v2...`));
    let v2Result;
    try {
      v2Result = await runAggregateBacktest(baseAggConfig, {
        enableLogging: false,
        saveResults:   false,
      });
    } catch (err) {
      console.error(`  v2 run failed for config ${config.name}:`, err);
      continue;
    }

    try {
      await saveBacktestRun(v2Result, config.id);
      console.log(dim(`  v2 result saved to DB`));
    } catch (err) {
      console.warn(`  Warning: failed to save v2 result: ${err}`);
    }

    // -----------------------------------------------------------------------
    // Build v4 config — swap strategy names
    // -----------------------------------------------------------------------
    const v4AggConfig: AggregateBacktestConfig = {
      ...baseAggConfig,
      subStrategies: baseAggConfig.subStrategies.map(s => ({
        ...s,
        strategyName: s.strategyName === 'funding-rate-spike-v2'
          ? 'funding-rate-spike-v4'
          : s.strategyName,
      })),
    };

    // -----------------------------------------------------------------------
    // Run v4
    // -----------------------------------------------------------------------
    console.log(dim(`  Running v4...`));
    let v4Result;
    try {
      v4Result = await runAggregateBacktest(v4AggConfig, {
        enableLogging: false,
        saveResults:   false,
      });
    } catch (err) {
      console.error(`  v4 run failed for config ${config.name}:`, err);
      // Still print v2 metrics if we have them
      const v2m = extractMetrics(v2Result);
      console.log(`  V2 Sharpe: ${fmt(v2m.sharpe)}  Return: ${fmt(v2m.returnPct, 2)}%  MaxDD: ${fmt(v2m.maxDD, 2)}%  Trades: ${v2m.trades}`);
      continue;
    }

    try {
      await saveBacktestRun(v4Result, config.id);
      console.log(dim(`  v4 result saved to DB`));
    } catch (err) {
      console.warn(`  Warning: failed to save v4 result: ${err}`);
    }

    // -----------------------------------------------------------------------
    // Compare
    // -----------------------------------------------------------------------
    const v2m = extractMetrics(v2Result);
    const v4m = extractMetrics(v4Result);

    printComparison(config.name, config.allocationMode, config.maxPositions, v2m, v4m);

    summaryRows.push({
      name:     config.name,
      v2Sharpe: v2m.sharpe,
      v4Sharpe: v4m.sharpe,
      v2Return: v2m.returnPct,
      v4Return: v4m.returnPct,
      v2MaxDD:  v2m.maxDD,
      v4MaxDD:  v4m.maxDD,
    });
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  if (summaryRows.length > 0) {
    printSummary(summaryRows);
  }

  await closeDb();
  console.log('');
  console.log(dim('Done.'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
