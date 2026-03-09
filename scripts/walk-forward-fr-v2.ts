#!/usr/bin/env node
/**
 * Walk-Forward Validation Script for FR Spike V2 Strategy
 *
 * Runs focused walk-forward testing on the funding-rate-spike-v2 strategy
 * using a carefully scoped parameter grid (3,750 combinations) across
 * the 5 most impactful parameters. With maxCombinations=500 the optimizer
 * samples evenly from that space.
 *
 * Usage:
 *   npx tsx scripts/walk-forward-fr-v2.ts \
 *     --symbol=LPT/USDT:USDT \
 *     --from=2024-01-01 \
 *     --to=2025-12-31 \
 *     [--exchange=bybit]
 *
 *   # Multiple symbols (run in sequence):
 *   npx tsx scripts/walk-forward-fr-v2.ts \
 *     --symbols=LPT/USDT:USDT,IOST/USDT:USDT,ZEC/USDT:USDT \
 *     --from=2024-01-01 \
 *     --to=2025-12-31 \
 *     [--exchange=bybit]
 *
 * Parameter grid (3,750 combinations total):
 *   holdingPeriods   : 2..6   step 1  (5 values)
 *   shortPercentile  : 90..98 step 2  (5 values)
 *   longPercentile   : 2..10  step 2  (5 values)
 *   atrStopMultiplier: 1.5..3.5 step 0.5 (5 values)
 *   atrTPMultiplier  : 2.5..5.0 step 0.5 (6 values)
 */

// Set default DATABASE_URL before any imports that read it
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import { runWalkForwardTest, type WalkForwardResult } from '../src/core/walk-forward.js';
import { initDb, closeDb, saveBacktestRun } from '../src/data/db.js';
import { v4 as uuidv4 } from 'uuid';
import type { BacktestResult } from '../src/core/types.js';

// ============================================================================
// Types
// ============================================================================

interface SummaryRow {
  symbol: string;
  symbolShort: string;
  trainSharpe: number;
  testSharpe: number;
  oosDegrade: number;
  isRobust: boolean;
  trainTrades: number;
  testTrades: number;
  trainReturn: number;
  testReturn: number;
  bestParams: Record<string, unknown>;
  hasError: boolean;
  error?: string;
}

// ============================================================================
// CLI argument parsing
// ============================================================================

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 2) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result[key] = value;
      }
    }
  }
  return result;
}

// ============================================================================
// Table formatting helpers
// ============================================================================

function pad(str: string, width: number, alignRight = false): string {
  const s = String(str);
  if (s.length >= width) return s.slice(0, width);
  const padding = ' '.repeat(width - s.length);
  return alignRight ? padding + s : s + padding;
}

function rpad(str: string, width: number): string {
  return pad(str, width, true);
}

function lpad(str: string, width: number): string {
  return pad(str, width, false);
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtSharpe(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(3)}`;
}

function printSummaryTable(rows: SummaryRow[]): void {
  const successRows = rows.filter(r => !r.hasError);

  if (successRows.length === 0) {
    console.log('\n(No successful results to display)');
    return;
  }

  const HDR = [
    lpad('Symbol', 16),
    rpad('TrainSharpe', 12),
    rpad('TestSharpe', 11),
    rpad('OOS Degrade', 12),
    lpad('Robust', 7),
    rpad('TrTrades', 9),
    rpad('TsTrades', 9),
    rpad('TrainRet%', 10),
    rpad('TestRet%', 9),
    lpad('Best Params (focused)', 40),
  ].join('  ');

  const SEP = '-'.repeat(HDR.length);

  console.log('\n=== WALK-FORWARD RESULTS SUMMARY ===');
  console.log(SEP);
  console.log(HDR);
  console.log(SEP);

  for (const r of successRows) {
    const robustStr = r.isRobust ? 'YES' : 'NO';
    const degradeStr = `${r.oosDegrade >= 0 ? '+' : ''}${r.oosDegrade.toFixed(1)}%`;

    // Format only the 5 focused best params for the table
    const focusedKeys = ['holdingPeriods', 'shortPercentile', 'longPercentile', 'atrStopMultiplier', 'atrTPMultiplier'];
    const paramStr = focusedKeys
      .filter(k => r.bestParams[k] !== undefined)
      .map(k => `${k.replace(/([A-Z])/g, c => c.toLowerCase())}=${r.bestParams[k]}`)
      .join(' ');

    const row = [
      lpad(r.symbolShort, 16),
      rpad(fmtSharpe(r.trainSharpe), 12),
      rpad(fmtSharpe(r.testSharpe), 11),
      rpad(degradeStr, 12),
      lpad(robustStr, 7),
      rpad(String(r.trainTrades), 9),
      rpad(String(r.testTrades), 9),
      rpad(fmtPct(r.trainReturn), 10),
      rpad(fmtPct(r.testReturn), 9),
      lpad(paramStr.slice(0, 40), 40),
    ].join('  ');
    console.log(row);
  }

  console.log(SEP);

  // Error rows
  const errorRows = rows.filter(r => r.hasError);
  if (errorRows.length > 0) {
    console.log(`\nErrors (${errorRows.length}):`);
    for (const r of errorRows) {
      const errMsg = (r.error ?? 'unknown').slice(0, 80);
      console.log(`  ${r.symbolShort.padEnd(18)} ${errMsg}`);
    }
  }
}

function printBestParams(rows: SummaryRow[]): void {
  const successRows = rows.filter(r => !r.hasError);
  if (successRows.length === 0) return;

  console.log('\n=== BEST PARAMS PER SYMBOL ===');
  for (const r of successRows) {
    console.log(`\n  ${r.symbolShort}`);
    const focusedKeys = ['holdingPeriods', 'shortPercentile', 'longPercentile', 'atrStopMultiplier', 'atrTPMultiplier'];
    for (const k of focusedKeys) {
      if (r.bestParams[k] !== undefined) {
        console.log(`    ${k.padEnd(22)}: ${r.bestParams[k]}`);
      }
    }
    console.log(`    ${'(train sharpe)'.padEnd(22)}: ${fmtSharpe(r.trainSharpe)}`);
    console.log(`    ${'(test sharpe)'.padEnd(22)}: ${fmtSharpe(r.testSharpe)}`);
    console.log(`    ${'(robust)'.padEnd(22)}: ${r.isRobust ? 'YES' : 'NO'}`);
  }
}

// ============================================================================
// Build a synthetic BacktestResult suitable for saveBacktestRun
// Walk-forward returns train/test metrics; we save them as two separate runs.
// ============================================================================

function buildBacktestResultFromWF(
  symbol: string,
  exchange: string,
  wfResult: WalkForwardResult,
  period: 'train' | 'test'
): BacktestResult {
  const isTrainPeriod = period === 'train';
  const metrics = isTrainPeriod ? wfResult.trainMetrics : wfResult.testMetrics;
  const periodDates = isTrainPeriod ? wfResult.trainPeriod : wfResult.testPeriod;

  return {
    id: uuidv4(),
    config: {
      id: uuidv4(),
      strategyName: 'funding-rate-spike-v2',
      params: wfResult.optimizedParams,
      symbol,
      timeframe: '4h',
      startDate: periodDates.start,
      endDate: periodDates.end,
      initialCapital: 10000,
      exchange,
      mode: 'futures',
    },
    trades: !isTrainPeriod && wfResult.testTrades ? wfResult.testTrades : [],
    equity: !isTrainPeriod && wfResult.testEquity ? wfResult.testEquity : [],
    metrics,
    rollingMetrics: !isTrainPeriod && wfResult.testRollingMetrics ? wfResult.testRollingMetrics : undefined,
    createdAt: Date.now(),
  };
}

// ============================================================================
// Focused parameter ranges for FR V2
// ============================================================================

// Pin ALL numeric params to defaults, vary only the 5 we care about.
// Without pinning, the optimizer uses strategy min/max/step for unpinned params,
// creating billions of combos and random sampling misses good regions entirely.
const PARAM_RANGES: Record<string, { min: number; max: number; step: number }> = {
  // ---- 5 FOCUSED PARAMETERS (varied) ----
  holdingPeriods:    { min: 2, max: 6, step: 1 },       // 5 values
  shortPercentile:   { min: 90, max: 98, step: 2 },     // 5 values
  longPercentile:    { min: 2, max: 10, step: 2 },      // 5 values
  atrStopMultiplier: { min: 1.5, max: 3.5, step: 0.5 }, // 5 values
  atrTPMultiplier:   { min: 2.5, max: 5.0, step: 0.5 }, // 6 values
  // Total: 5 * 5 * 5 * 5 * 6 = 3,750 combinations

  // ---- ALL OTHER NUMERIC PARAMS (pinned to defaults) ----
  positionSizePct:       { min: 50, max: 50, step: 1 },
  percentileLookback:    { min: 90, max: 90, step: 1 },
  fundingThresholdShort: { min: 0.0005, max: 0.0005, step: 0.0001 },
  fundingThresholdLong:  { min: -0.0003, max: -0.0003, step: 0.0001 },
  atrPeriod:             { min: 14, max: 14, step: 1 },
  stopLossPct:           { min: 3.0, max: 3.0, step: 0.5 },
  takeProfitPct:         { min: 4.0, max: 4.0, step: 0.5 },
  atrFilterThreshold:    { min: 1.5, max: 1.5, step: 0.1 },
  trendSMAPeriod:        { min: 50, max: 50, step: 10 },
  trailActivationATR:    { min: 1.0, max: 1.0, step: 0.5 },
  trailDistanceATR:      { min: 2.0, max: 2.0, step: 0.5 },
  kellyFraction:         { min: 0.5, max: 0.5, step: 0.1 },
  minPositionPct:        { min: 15, max: 15, step: 5 },
  maxPositionPct:        { min: 50, max: 50, step: 10 },
  kellySampleSize:       { min: 20, max: 20, step: 5 },
  frVelocityBars:        { min: 1, max: 1, step: 1 },
};

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  await initDb();

  const args = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!args.from || !args.to) {
    console.error('Error: --from and --to are required.');
    console.error('Example: --from=2024-01-01 --to=2025-12-31');
    process.exit(1);
  }

  if (!args.symbol && !args.symbols) {
    console.error('Error: --symbol or --symbols is required.');
    console.error('Example: --symbol=LPT/USDT:USDT');
    console.error('         --symbols=LPT/USDT:USDT,IOST/USDT:USDT,ZEC/USDT:USDT');
    process.exit(1);
  }

  const startDate = new Date(args.from).getTime();
  const endDate = new Date(args.to).getTime();

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error('Error: --from must be before --to');
    process.exit(1);
  }

  const exchange = args.exchange ?? 'bybit';

  // Parse symbols
  let symbols: string[];
  if (args.symbols) {
    symbols = args.symbols.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    symbols = [args.symbol.trim()];
  }

  const totalCombinations =
    5 * 5 * 5 * 5 * 6; // 3,750

  console.log('='.repeat(72));
  console.log('  FR SPIKE V2 - WALK-FORWARD VALIDATION');
  console.log('='.repeat(72));
  console.log(`  Strategy     : funding-rate-spike-v2`);
  console.log(`  Exchange     : ${exchange} (futures mode)`);
  console.log(`  Period       : ${args.from} to ${args.to}`);
  console.log(`  Timeframe    : 4h`);
  console.log(`  Train ratio  : 70% / Test: 30%`);
  console.log(`  Optimize for : sharpeRatio`);
  console.log(`  Min trades   : 5`);
  console.log(`  Capital      : $10,000`);
  console.log(`  Param space  : ${totalCombinations.toLocaleString()} combinations`);
  console.log(`  Max sampled  : 500`);
  console.log(`  Symbols      : ${symbols.join(', ')}`);
  console.log('  Focused params:');
  for (const [k, v] of Object.entries(PARAM_RANGES)) {
    const count = Math.round((v.max - v.min) / v.step) + 1;
    console.log(`    ${k.padEnd(22)}: ${v.min}..${v.max} step ${v.step} (${count} values)`);
  }
  console.log('='.repeat(72));
  console.log('');

  const summaryRows: SummaryRow[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const symbolShort = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    const prefix = `[${i + 1}/${symbols.length}] ${symbolShort}`;

    console.log(`\n${prefix} — starting walk-forward...`);

    try {
      const wfResult: WalkForwardResult = await runWalkForwardTest({
        strategyName: 'funding-rate-spike-v2',
        symbol,
        timeframe: '4h',
        startDate,
        endDate,
        trainRatio: 0.7,
        paramRanges: PARAM_RANGES,
        optimizeFor: 'sharpeRatio',
        exchange,
        initialCapital: 10000,
        maxCombinations: 500,
        minTrades: 5,
        mode: 'futures',
      });

      // Save train-period result to DB
      const trainResult = buildBacktestResultFromWF(symbol, exchange, wfResult, 'train');
      await saveBacktestRun(trainResult);

      // Save test-period result to DB
      const testResult = buildBacktestResultFromWF(symbol, exchange, wfResult, 'test');
      await saveBacktestRun(testResult);

      const row: SummaryRow = {
        symbol,
        symbolShort,
        trainSharpe: wfResult.trainMetrics.sharpeRatio,
        testSharpe: wfResult.testMetrics.sharpeRatio,
        oosDegrade: wfResult.oosDegrade,
        isRobust: wfResult.isRobust,
        trainTrades: wfResult.trainMetrics.totalTrades,
        testTrades: wfResult.testMetrics.totalTrades,
        trainReturn: wfResult.trainMetrics.totalReturnPercent,
        testReturn: wfResult.testMetrics.totalReturnPercent,
        bestParams: wfResult.optimizedParams,
        hasError: false,
      };
      summaryRows.push(row);

      const degradeStr = `${wfResult.oosDegrade >= 0 ? '+' : ''}${wfResult.oosDegrade.toFixed(1)}%`;
      console.log(
        `${prefix} -> TrainSharpe: ${fmtSharpe(wfResult.trainMetrics.sharpeRatio).padStart(7)}` +
        `  TestSharpe: ${fmtSharpe(wfResult.testMetrics.sharpeRatio).padStart(7)}` +
        `  OOS: ${degradeStr.padStart(8)}` +
        `  Robust: ${wfResult.isRobust ? 'YES' : 'NO'}` +
        `  Trades(tr/ts): ${wfResult.trainMetrics.totalTrades}/${wfResult.testMetrics.totalTrades}`
      );
      console.log(`${prefix} -> Saved train and test results to DB`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const displayMsg = msg.length > 90 ? msg.slice(0, 90) + '...' : msg;
      console.log(`${prefix} -> ERROR: ${displayMsg}`);
      summaryRows.push({
        symbol,
        symbolShort,
        trainSharpe: 0,
        testSharpe: 0,
        oosDegrade: 0,
        isRobust: false,
        trainTrades: 0,
        testTrades: 0,
        trainReturn: 0,
        testReturn: 0,
        bestParams: {},
        hasError: true,
        error: msg,
      });
    }
  }

  // ============================================================================
  // Final summary
  // ============================================================================

  printSummaryTable(summaryRows);
  printBestParams(summaryRows);

  const successRows = summaryRows.filter(r => !r.hasError);
  const robustRows = successRows.filter(r => r.isRobust);

  console.log('\n' + '='.repeat(72));
  console.log('  OVERALL SUMMARY');
  console.log('='.repeat(72));
  console.log(`  Symbols tested   : ${symbols.length}`);
  console.log(`  Successful runs  : ${successRows.length}`);
  console.log(`  Errors           : ${summaryRows.filter(r => r.hasError).length}`);
  console.log(`  Robust (passed)  : ${robustRows.length} / ${successRows.length}`);

  if (robustRows.length > 0) {
    const avgTrainSharpe = robustRows.reduce((s, r) => s + r.trainSharpe, 0) / robustRows.length;
    const avgTestSharpe = robustRows.reduce((s, r) => s + r.testSharpe, 0) / robustRows.length;
    const avgDegrade = robustRows.reduce((s, r) => s + r.oosDegrade, 0) / robustRows.length;
    console.log(`  Avg train Sharpe : ${fmt(avgTrainSharpe)} (robust symbols only)`);
    console.log(`  Avg test Sharpe  : ${fmt(avgTestSharpe)} (robust symbols only)`);
    console.log(`  Avg OOS degrade  : ${fmt(avgDegrade)}% (robust symbols only)`);
  }

  if (successRows.length > 0) {
    const avgTrainAll = successRows.reduce((s, r) => s + r.trainSharpe, 0) / successRows.length;
    const avgTestAll = successRows.reduce((s, r) => s + r.testSharpe, 0) / successRows.length;
    console.log(`  Avg train Sharpe : ${fmt(avgTrainAll)} (all successful)`);
    console.log(`  Avg test Sharpe  : ${fmt(avgTestAll)} (all successful)`);
  }

  console.log('='.repeat(72));

  await closeDb();
}

main().catch(error => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
