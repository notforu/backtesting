#!/usr/bin/env node
/**
 * Walk-Forward Validation — 10 New FR Symbol Candidates
 *
 * Runs walk-forward testing for 10 new symbols using funding-rate-spike-v2.
 * Results are NOT saved to DB — validation only.
 *
 * Usage:
 *   npx tsx scripts/wf-validate-new-candidates.ts
 *
 * Output: progress on stderr, final summary table on stdout
 */

import { runWalkForwardTest } from '../src/core/walk-forward.js';
import type { WalkForwardConfig } from '../src/core/walk-forward.js';
import { initDb, closeDb } from '../src/data/db.js';

// ============================================================================
// Configuration
// ============================================================================

const STRATEGY = 'funding-rate-spike-v2';
const TIMEFRAME = '4h' as const;
const EXCHANGE = 'bybit';
const MODE = 'futures' as const;
const START_DATE = new Date('2024-01-01').getTime();
const END_DATE = new Date('2026-03-01').getTime();
const TRAIN_RATIO = 0.7;
const INITIAL_CAPITAL = 10000;
const MAX_COMBINATIONS = 500;
const MIN_TRADES = 10;
const OOS_THRESHOLD = 60;
const MIN_TEST_SHARPE = 0.5;

// Parameter ranges for optimization — same as V2 standard ranges
const PARAM_RANGES: WalkForwardConfig['paramRanges'] = {
  holdingPeriods:  { min: 2, max: 8,  step: 1   },
  shortPercentile: { min: 90, max: 98, step: 2   },
  longPercentile:  { min: 2,  max: 14, step: 2   },
  atrStop:         { min: 2,  max: 5,  step: 0.5 },
  atrTP:           { min: 2,  max: 5,  step: 0.5 },
};

const SYMBOLS: string[] = [
  'DUSK/USDT:USDT',
  'DASH/USDT:USDT',
  'AXS/USDT:USDT',
  'XMR/USDT:USDT',
  'INJ/USDT:USDT',
  'SEI/USDT:USDT',
  'FLOW/USDT:USDT',
  '1000PEPE/USDT:USDT',
  'PAXG/USDT:USDT',
  'ATOM/USDT:USDT',
];

// ============================================================================
// Result types
// ============================================================================

interface WfSummaryRow {
  symbol: string;
  trainSharpe: number;
  testSharpe: number;
  degradePct: number;
  testReturnPct: number;
  testTrades: number;
  bestParams: {
    holdingPeriods: number;
    shortPercentile: number;
    longPercentile: number;
    atrStop: number;
    atrTP: number;
  };
  isRobust: boolean;
  hasError: boolean;
  errorMsg?: string;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function pad(s: string, width: number, rightAlign = false): string {
  const str = String(s);
  if (str.length >= width) return str.slice(0, width);
  const fill = ' '.repeat(width - str.length);
  return rightAlign ? fill + str : str + fill;
}

function lpad(s: string, w: number): string { return pad(s, w, false); }
function rpad(s: string, w: number): string { return pad(s, w, true); }

function fmtSharpe(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtDegradePct(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtInt(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return String(Math.round(n));
}

// ============================================================================
// Summary table printer (stdout)
// ============================================================================

function printSummaryTable(rows: WfSummaryRow[]): void {
  const C_SYM    = 16;
  const C_SHARPE = 8;
  const C_DEG    = 9;
  const C_RET    = 9;
  const C_TR     = 7;
  const C_PASS   = 7;

  const TOTAL_WIDTH =
    C_SYM + 2 + C_SHARPE + 2 + C_SHARPE + 2 + C_DEG + 2 +
    C_RET + 2 + C_TR + 2 + C_PASS;

  const header =
    lpad('Symbol',    C_SYM)    + '  ' +
    rpad('TrainSh',   C_SHARPE) + '  ' +
    rpad('TestSh',    C_SHARPE) + '  ' +
    rpad('Degrade%',  C_DEG)    + '  ' +
    rpad('TestRet%',  C_RET)    + '  ' +
    rpad('Trades',    C_TR)     + '  ' +
    lpad('Result',    C_PASS);

  console.log('\n' + '='.repeat(69));
  console.log('  WALK-FORWARD VALIDATION -- 10 New FR Candidates');
  console.log(`  Strategy: ${STRATEGY} | TF: ${TIMEFRAME} | ${new Date(START_DATE).toISOString().slice(0, 10)} to ${new Date(END_DATE).toISOString().slice(0, 10)}`);
  console.log(`  Train: ${(TRAIN_RATIO * 100).toFixed(0)}% | OOS threshold: ${OOS_THRESHOLD}% | Min test Sharpe: ${MIN_TEST_SHARPE}`);
  console.log('='.repeat(69));
  console.log(header);
  console.log('-'.repeat(69));

  for (const row of rows) {
    const symShort = row.symbol.replace('/USDT:USDT', '');

    if (row.hasError) {
      console.log(
        lpad(symShort, C_SYM) + '  ' +
        rpad('ERR',    C_SHARPE) + '  ' +
        rpad('ERR',    C_SHARPE) + '  ' +
        rpad('ERR',    C_DEG)    + '  ' +
        rpad('ERR',    C_RET)    + '  ' +
        rpad('ERR',    C_TR)     + '  ' +
        lpad('ERROR',  C_PASS)
      );
      continue;
    }

    const resultStr = row.isRobust ? 'PASS' : 'FAIL';

    console.log(
      lpad(symShort,                       C_SYM)    + '  ' +
      rpad(fmtSharpe(row.trainSharpe),     C_SHARPE) + '  ' +
      rpad(fmtSharpe(row.testSharpe),      C_SHARPE) + '  ' +
      rpad(fmtDegradePct(row.degradePct),  C_DEG)    + '  ' +
      rpad(fmtPct(row.testReturnPct),      C_RET)    + '  ' +
      rpad(fmtInt(row.testTrades),         C_TR)     + '  ' +
      lpad(resultStr,                      C_PASS)
    );
  }

  console.log('='.repeat(69));
}

function printPassFailSummary(rows: WfSummaryRow[]): void {
  const errors = rows.filter(r => r.hasError);
  const valid  = rows.filter(r => !r.hasError);
  const passed = valid.filter(r => r.isRobust);
  const failed = valid.filter(r => !r.isRobust);

  console.log(`\nTotal: ${rows.length}  |  Passed: ${passed.length}  |  Failed: ${failed.length}  |  Errors: ${errors.length}`);

  if (passed.length > 0) {
    console.log('\nPASSED:');
    for (const r of passed) {
      const s = r.symbol.replace('/USDT:USDT', '');
      const p = r.bestParams;
      console.log(
        `  ${s.padEnd(12)} trainSh=${fmtSharpe(r.trainSharpe)}  testSh=${fmtSharpe(r.testSharpe)}  ` +
        `degrade=${fmtDegradePct(r.degradePct)}  testRet=${fmtPct(r.testReturnPct)}  ` +
        `hp=${p.holdingPeriods} sp=${p.shortPercentile} lp=${p.longPercentile} as=${p.atrStop} at=${p.atrTP}`
      );
    }
  }

  if (failed.length > 0) {
    console.log('\nFAILED:');
    for (const r of failed) {
      const s = r.symbol.replace('/USDT:USDT', '');
      const reasons: string[] = [];
      if (r.degradePct >= OOS_THRESHOLD) reasons.push(`degrade=${fmtDegradePct(r.degradePct)} >= ${OOS_THRESHOLD}%`);
      if (r.testSharpe <= MIN_TEST_SHARPE) reasons.push(`testSh=${fmtSharpe(r.testSharpe)} <= ${MIN_TEST_SHARPE}`);
      console.log(`  ${s.padEnd(12)} ${reasons.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    console.log('\nERRORS:');
    for (const r of errors) {
      const s = r.symbol.replace('/USDT:USDT', '');
      console.log(`  ${s.padEnd(12)} ${r.errorMsg ?? 'unknown error'}`);
    }
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  await initDb();

  const totalSymbols = SYMBOLS.length;

  console.error('');
  console.error('='.repeat(70));
  console.error('  WALK-FORWARD VALIDATION -- 10 New FR Candidates');
  console.error('='.repeat(70));
  console.error(`  Strategy  : ${STRATEGY}`);
  console.error(`  Timeframe : ${TIMEFRAME}`);
  console.error(`  Exchange  : ${EXCHANGE}`);
  console.error(`  Period    : ${new Date(START_DATE).toISOString().slice(0, 10)} to ${new Date(END_DATE).toISOString().slice(0, 10)}`);
  console.error(`  Train     : ${(TRAIN_RATIO * 100).toFixed(0)}% / Test: ${((1 - TRAIN_RATIO) * 100).toFixed(0)}%`);
  console.error(`  OOS thresh: ${OOS_THRESHOLD}%  |  Min test Sharpe: ${MIN_TEST_SHARPE}`);
  console.error(`  Max combos: ${MAX_COMBINATIONS}  |  Min trades: ${MIN_TRADES}`);
  console.error(`  Symbols   : ${totalSymbols}`);
  console.error('='.repeat(70));
  console.error('');

  const summaryRows: WfSummaryRow[] = [];

  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    const symShort = symbol.replace('/USDT:USDT', '');
    const idx = `[${i + 1}/${totalSymbols}]`;

    console.error(`${idx} Starting WF for ${symShort} ...`);

    const wfConfig: WalkForwardConfig = {
      strategyName: STRATEGY,
      symbol,
      timeframe: TIMEFRAME,
      startDate: START_DATE,
      endDate: END_DATE,
      trainRatio: TRAIN_RATIO,
      paramRanges: PARAM_RANGES,
      optimizeFor: 'sharpeRatio',
      exchange: EXCHANGE,
      initialCapital: INITIAL_CAPITAL,
      maxCombinations: MAX_COMBINATIONS,
      minTrades: MIN_TRADES,
      oosThreshold: OOS_THRESHOLD,
      minTestSharpe: MIN_TEST_SHARPE,
      mode: MODE,
    };

    try {
      const result = await runWalkForwardTest(wfConfig);

      const bestParams = result.optimizedParams;

      summaryRows.push({
        symbol,
        trainSharpe:   result.trainMetrics.sharpeRatio,
        testSharpe:    result.testMetrics.sharpeRatio,
        degradePct:    result.oosDegrade,
        testReturnPct: result.testMetrics.totalReturnPercent,
        testTrades:    result.testMetrics.totalTrades,
        bestParams: {
          holdingPeriods:  Number(bestParams.holdingPeriods  ?? 0),
          shortPercentile: Number(bestParams.shortPercentile ?? 0),
          longPercentile:  Number(bestParams.longPercentile  ?? 0),
          atrStop:         Number(bestParams.atrStop         ?? 0),
          atrTP:           Number(bestParams.atrTP           ?? 0),
        },
        isRobust: result.isRobust,
        hasError: false,
      });

      const passLabel = result.isRobust ? 'PASS' : 'FAIL';
      console.error(
        `${idx} ${symShort.padEnd(10)} ${passLabel}  ` +
        `trainSh=${fmtSharpe(result.trainMetrics.sharpeRatio)}  ` +
        `testSh=${fmtSharpe(result.testMetrics.sharpeRatio)}  ` +
        `degrade=${fmtDegradePct(result.oosDegrade)}  ` +
        `testRet=${fmtPct(result.testMetrics.totalReturnPercent)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${idx} ${symShort.padEnd(10)} ERROR: ${msg}`);

      summaryRows.push({
        symbol,
        trainSharpe:   NaN,
        testSharpe:    NaN,
        degradePct:    NaN,
        testReturnPct: NaN,
        testTrades:    0,
        bestParams: {
          holdingPeriods:  0,
          shortPercentile: 0,
          longPercentile:  0,
          atrStop:         0,
          atrTP:           0,
        },
        isRobust:  false,
        hasError:  true,
        errorMsg:  msg,
      });
    }

    console.error('');
  }

  // Print final tables to stdout
  printSummaryTable(summaryRows);
  printPassFailSummary(summaryRows);

  await closeDb();
}

main().catch(err => {
  console.error('Fatal error:', err);
  void closeDb();
  process.exit(1);
});
