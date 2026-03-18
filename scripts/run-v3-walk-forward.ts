#!/usr/bin/env node
/**
 * Walk-Forward Validation for V3 Sub-Strategies (Hybrid Tiered Portfolio)
 *
 * Runs walk-forward testing for 6 symbols that make up the best "Hybrid Tiered"
 * portfolio configuration. V3 uses a BTC SMA200 regime filter to block trades
 * during bear markets.
 *
 * The walk-forward module auto-detects V3 strategies and injects BTC daily candles
 * before both optimization and test phases.
 *
 * Usage:
 *   npx tsx scripts/run-v3-walk-forward.ts
 *
 * Output: progress on stderr, final comparison table on stdout
 */

import { runWalkForwardTest } from '../src/core/walk-forward.js';
import type { WalkForwardConfig } from '../src/core/walk-forward.js';
import { initDb, closeDb } from '../src/data/db.js';

// ============================================================================
// Configuration
// ============================================================================

const STRATEGY = 'funding-rate-spike-v3';
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

// Parameter ranges for optimization (numeric params only).
// V3 regime filter params (useRegimeFilter, bearMode, regimeMAType) are boolean/select —
// the optimizer doesn't touch them; they default from the strategy's defaults.
const PARAM_RANGES: WalkForwardConfig['paramRanges'] = {
  holdingPeriods:  { min: 2, max: 8,  step: 1   },
  shortPercentile: { min: 90, max: 98, step: 2   },
  longPercentile:  { min: 2,  max: 14, step: 2   },
  atrStop:         { min: 2,  max: 5,  step: 0.5 },
  atrTP:           { min: 2,  max: 5,  step: 0.5 },
  // Pin regimeSMAPeriod so optimizer doesn't search it (min=max=200)
  regimeSMAPeriod: { min: 200, max: 200, step: 1 },
};

interface SymbolConfig {
  symbol: string;
  note: string;
}

const SYMBOLS: SymbolConfig[] = [
  {
    symbol: 'ZEC/USDT:USDT',
    note: 'default V3 params',
  },
  {
    symbol: 'LDO/USDT:USDT',
    note: 'known optimized: holdingPeriods=4, shortPerc=96, longPerc=2, atrStop=3.5, atrTP=3.5',
  },
  {
    symbol: 'XLM/USDT:USDT',
    note: 'known optimized: holdingPeriods=6, shortPerc=94, longPerc=10, atrStop=3, atrTP=5',
  },
  {
    symbol: 'TRB/USDT:USDT',
    note: 'default V3 params',
  },
  {
    symbol: 'IOST/USDT:USDT',
    note: 'default V3 params',
  },
  {
    symbol: 'DOGE/USDT:USDT',
    note: 'KEY TEST: failed WF on V2, should pass with V3 regime filter',
  },
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
  testMaxDdPct: number;
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
  // Positive degradation = performance got worse; show as red flag
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtInt(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return String(Math.round(n));
}

function sep(len: number): string { return '-'.repeat(len); }

// ============================================================================
// Summary table printer
// ============================================================================

function printSummaryTable(rows: WfSummaryRow[]): void {
  // Column widths
  const C_SYM    = 16;
  const C_SHARPE = 8;
  const C_DEG    = 9;
  const C_RET    = 9;
  const C_DD     = 9;
  const C_TR     = 7;
  const C_PARAMS = 36;  // "hp=X sp=XX lp=XX as=X.X at=X.X"
  const C_PASS   = 7;

  const TOTAL_WIDTH =
    C_SYM + 2 + C_SHARPE + 2 + C_SHARPE + 2 + C_DEG + 2 +
    C_RET + 2 + C_DD + 2 + C_TR + 2 + C_PARAMS + 2 + C_PASS;

  const header =
    lpad('Symbol',      C_SYM)    + '  ' +
    rpad('TrainSh',     C_SHARPE) + '  ' +
    rpad('TestSh',      C_SHARPE) + '  ' +
    rpad('Degrade%',    C_DEG)    + '  ' +
    rpad('TestRet%',    C_RET)    + '  ' +
    rpad('TestDD%',     C_DD)     + '  ' +
    rpad('Trades',      C_TR)     + '  ' +
    lpad('BestParams',  C_PARAMS) + '  ' +
    lpad('Result',      C_PASS);

  console.log('\n' + '='.repeat(TOTAL_WIDTH));
  console.log('  V3 WALK-FORWARD VALIDATION -- Hybrid Tiered Portfolio Symbols');
  console.log(`  Strategy: ${STRATEGY} | TF: ${TIMEFRAME} | ${new Date(START_DATE).toISOString().slice(0, 10)} to ${new Date(END_DATE).toISOString().slice(0, 10)}`);
  console.log(`  Train: ${(TRAIN_RATIO * 100).toFixed(0)}% | OOS threshold: ${OOS_THRESHOLD}% | Min test Sharpe: ${MIN_TEST_SHARPE}`);
  console.log('='.repeat(TOTAL_WIDTH));
  console.log(header);
  console.log(sep(TOTAL_WIDTH));

  for (const row of rows) {
    const symShort = row.symbol.replace('/USDT:USDT', '');

    if (row.hasError) {
      console.log(
        lpad(symShort, C_SYM) + '  ' +
        rpad('ERR', C_SHARPE) + '  ' +
        rpad('ERR', C_SHARPE) + '  ' +
        rpad('ERR', C_DEG)    + '  ' +
        rpad('ERR', C_RET)    + '  ' +
        rpad('ERR', C_DD)     + '  ' +
        rpad('ERR', C_TR)     + '  ' +
        lpad((row.errorMsg ?? 'unknown error').slice(0, C_PARAMS), C_PARAMS) + '  ' +
        lpad('ERROR', C_PASS)
      );
      continue;
    }

    const p = row.bestParams;
    const paramsStr = `hp=${p.holdingPeriods} sp=${p.shortPercentile} lp=${p.longPercentile} as=${p.atrStop} at=${p.atrTP}`;
    const resultStr = row.isRobust ? 'PASS' : 'FAIL';

    console.log(
      lpad(symShort,                    C_SYM)    + '  ' +
      rpad(fmtSharpe(row.trainSharpe),  C_SHARPE) + '  ' +
      rpad(fmtSharpe(row.testSharpe),   C_SHARPE) + '  ' +
      rpad(fmtDegradePct(row.degradePct), C_DEG)  + '  ' +
      rpad(fmtPct(row.testReturnPct),   C_RET)    + '  ' +
      rpad(fmtPct(row.testMaxDdPct),    C_DD)     + '  ' +
      rpad(fmtInt(row.testTrades),      C_TR)     + '  ' +
      lpad(paramsStr,                   C_PARAMS) + '  ' +
      lpad(resultStr,                   C_PASS)
    );
  }

  console.log('='.repeat(TOTAL_WIDTH));
}

function printPassFailSummary(rows: WfSummaryRow[]): void {
  const errors = rows.filter(r => r.hasError);
  const valid  = rows.filter(r => !r.hasError);
  const passed = valid.filter(r => r.isRobust);
  const failed = valid.filter(r => !r.isRobust);

  console.log('\n--- Pass/Fail Summary ---');
  console.log(`Total: ${rows.length}  |  Passed: ${passed.length}  |  Failed: ${failed.length}  |  Errors: ${errors.length}`);

  if (passed.length > 0) {
    console.log('\nPASSED:');
    for (const r of passed) {
      const symShort = r.symbol.replace('/USDT:USDT', '');
      console.log(`  ${symShort.padEnd(12)} trainSh=${fmtSharpe(r.trainSharpe)}  testSh=${fmtSharpe(r.testSharpe)}  degrade=${fmtDegradePct(r.degradePct)}  testRet=${fmtPct(r.testReturnPct)}`);
    }
  }

  if (failed.length > 0) {
    console.log('\nFAILED:');
    for (const r of failed) {
      const symShort = r.symbol.replace('/USDT:USDT', '');
      const reasons: string[] = [];
      if (r.degradePct >= OOS_THRESHOLD) reasons.push(`degrade=${fmtDegradePct(r.degradePct)} >= ${OOS_THRESHOLD}%`);
      if (r.testSharpe <= MIN_TEST_SHARPE) reasons.push(`testSh=${fmtSharpe(r.testSharpe)} <= ${MIN_TEST_SHARPE}`);
      console.log(`  ${symShort.padEnd(12)} ${reasons.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    console.log('\nERRORS:');
    for (const r of errors) {
      const symShort = r.symbol.replace('/USDT:USDT', '');
      console.log(`  ${symShort.padEnd(12)} ${r.errorMsg ?? 'unknown error'}`);
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
  console.error('  V3 WALK-FORWARD VALIDATION -- Hybrid Tiered Portfolio');
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
    const { symbol, note } = SYMBOLS[i];
    const symShort = symbol.replace('/USDT:USDT', '');
    const idx = `[${i + 1}/${totalSymbols}]`;

    console.error(`${idx} Starting WF for ${symShort} (${note})`);

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
        testMaxDdPct:  result.testMetrics.maxDrawdownPercent,
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
        `${idx} ${symShort.padEnd(8)} ${passLabel}  ` +
        `trainSh=${fmtSharpe(result.trainMetrics.sharpeRatio)}  ` +
        `testSh=${fmtSharpe(result.testMetrics.sharpeRatio)}  ` +
        `degrade=${fmtDegradePct(result.oosDegrade)}  ` +
        `testRet=${fmtPct(result.testMetrics.totalReturnPercent)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${idx} ${symShort.padEnd(8)} ERROR: ${msg}`);

      summaryRows.push({
        symbol,
        trainSharpe:   NaN,
        testSharpe:    NaN,
        degradePct:    NaN,
        testReturnPct: NaN,
        testMaxDdPct:  NaN,
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

  // ============================================================================
  // Print final comparison tables
  // ============================================================================

  printSummaryTable(summaryRows);
  printPassFailSummary(summaryRows);

  await closeDb();
}

main().catch(err => {
  console.error('Fatal error:', err);
  void closeDb();
  process.exit(1);
});
