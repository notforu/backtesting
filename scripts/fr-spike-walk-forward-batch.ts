#!/usr/bin/env node
/**
 * Batch walk-forward test: funding-rate-spike across multiple symbol/timeframe candidates
 *
 * Usage:
 *   npx tsx scripts/fr-spike-walk-forward-batch.ts \
 *     --from=2024-01-01 \
 *     --to=2026-02-22 \
 *     --train-ratio=0.7 \
 *     --max-combinations=150 \
 *     --candidates=ADA/USDT:USDT@1h,DOT/USDT:USDT@4h,ATOM/USDT:USDT@4h
 *
 * Options:
 *   --from=DATE              Start date YYYY-MM-DD (required)
 *   --to=DATE                End date YYYY-MM-DD (required)
 *   --train-ratio=RATIO      Train/test split ratio (default: 0.7)
 *   --max-combinations=N     Max grid search combinations per run (default: 150)
 *   --candidates=...         Comma-separated symbol@timeframe pairs (required)
 *
 * Output:
 *   - Progress printed to stdout as each run completes
 *   - Final ranked table printed to stdout
 *   - Full results saved to /workspace/data/fr-spike-wf-results.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runWalkForwardTest, type WalkForwardConfig } from '../src/core/walk-forward.js';
import { closeDb } from '../src/data/db.js';
import type { Timeframe } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Candidate {
  symbol: string;
  timeframe: string;
}

interface ResultRow {
  symbol: string;
  timeframe: string;
  trainSharpe: number;
  testSharpe: number;
  oosDegradePct: number;
  trainReturn: number;
  testReturn: number;
  trainTrades: number;
  testTrades: number;
  isRobust: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (key) result[key] = value;
      }
    }
  }
  return result;
}

function parseCandidates(raw: string): Candidate[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const atIdx = s.lastIndexOf('@');
      if (atIdx === -1) {
        throw new Error(
          `Invalid candidate format "${s}". Expected symbol@timeframe (e.g. ADA/USDT:USDT@1h)`
        );
      }
      const symbol = s.slice(0, atIdx);
      const timeframe = s.slice(atIdx + 1);
      if (!symbol || !timeframe) {
        throw new Error(
          `Invalid candidate format "${s}". Expected symbol@timeframe (e.g. ADA/USDT:USDT@1h)`
        );
      }
      return { symbol, timeframe };
    });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtSharpe(v: number): string {
  return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

function fmtPct(v: number): string {
  return v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
}

function pad(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function rpad(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function printTable(rows: ResultRow[]): void {
  const header = [
    'Rank',
    'Symbol',
    'TF',
    'TrainSharpe',
    'TestSharpe',
    'OOS%',
    'TrainRet%',
    'TestRet%',
    'TrnTrades',
    'TstTrades',
    'Status',
  ];

  const colWidths = [4, 20, 4, 11, 10, 9, 9, 8, 9, 9, 6];

  const sep = colWidths.map((w) => '-'.repeat(w + 2)).join('+');
  const headerLine = header.map((h, i) => pad(h, colWidths[i])).join(' | ');

  console.log('');
  console.log(sep);
  console.log(headerLine);
  console.log(sep);

  rows.forEach((r, idx) => {
    const rank = String(idx + 1);
    const status = r.error ? 'ERROR' : r.isRobust ? 'PASS' : 'FAIL';
    const shortSymbol = r.symbol.replace('/USDT:USDT', '').replace('/USDT', '');

    const cols = [
      rpad(rank, colWidths[0]),
      pad(shortSymbol, colWidths[1]),
      pad(r.timeframe, colWidths[2]),
      rpad(r.error ? 'n/a' : fmtSharpe(r.trainSharpe), colWidths[3]),
      rpad(r.error ? 'n/a' : fmtSharpe(r.testSharpe), colWidths[4]),
      rpad(r.error ? 'n/a' : fmtPct(r.oosDegradePct), colWidths[5]),
      rpad(r.error ? 'n/a' : fmtPct(r.trainReturn), colWidths[6]),
      rpad(r.error ? 'n/a' : fmtPct(r.testReturn), colWidths[7]),
      rpad(r.error ? 'n/a' : String(r.trainTrades), colWidths[8]),
      rpad(r.error ? 'n/a' : String(r.testTrades), colWidths[9]),
      pad(status, colWidths[10]),
    ];

    console.log(cols.join(' | '));
  });

  console.log(sep);
}

// ---------------------------------------------------------------------------
// Suppress / restore console.log during WF runs
// ---------------------------------------------------------------------------

function suppressConsoleLog(): () => void {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };
  return () => {
    console.log = originalLog;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate required args
  const missing: string[] = [];
  if (!args.from) missing.push('--from');
  if (!args.to) missing.push('--to');
  if (!args.candidates) missing.push('--candidates');

  if (missing.length > 0) {
    console.error(`Error: Missing required arguments: ${missing.join(', ')}`);
    console.error('');
    console.error('Usage:');
    console.error(
      '  npx tsx scripts/fr-spike-walk-forward-batch.ts --from=2024-01-01 --to=2026-02-22 --candidates=ADA/USDT:USDT@1h,DOT/USDT:USDT@4h'
    );
    process.exit(1);
  }

  const trainRatio = args['train-ratio'] ?? '0.7';
  const trainRatioNum = parseFloat(trainRatio);
  if (isNaN(trainRatioNum) || trainRatioNum <= 0 || trainRatioNum >= 1) {
    console.error('Error: --train-ratio must be a number between 0 and 1 (exclusive)');
    process.exit(1);
  }

  const maxCombinationsStr = args['max-combinations'] ?? '150';
  const maxCombinations = parseInt(maxCombinationsStr, 10);
  if (isNaN(maxCombinations) || maxCombinations < 1) {
    console.error('Error: --max-combinations must be a positive integer');
    process.exit(1);
  }

  // Validate dates
  const fromTs = new Date(args.from).getTime();
  const toTs = new Date(args.to).getTime();
  if (isNaN(fromTs) || isNaN(toTs)) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }
  if (fromTs >= toTs) {
    console.error('Error: --from must be before --to');
    process.exit(1);
  }

  // Parse candidates
  let candidates: Candidate[];
  try {
    candidates = parseCandidates(args.candidates);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (candidates.length === 0) {
    console.error('Error: No candidates specified');
    process.exit(1);
  }

  const total = candidates.length;
  console.log(`FR Spike Walk-Forward Batch`);
  console.log(
    `Period: ${args.from} to ${args.to}  |  Train ratio: ${trainRatio}  |  Max combinations: ${maxCombinations}`
  );
  console.log(`Candidates: ${total}`);
  console.log('');

  const results: ResultRow[] = [];

  // Run sequentially to avoid DB contention
  for (let i = 0; i < candidates.length; i++) {
    const { symbol, timeframe } = candidates[i];
    const label = `[${i + 1}/${total}] ${symbol}@${timeframe}`;

    process.stdout.write(`${label} -> running...\n`);

    const config: WalkForwardConfig = {
      strategyName: 'funding-rate-spike',
      symbol,
      timeframe: timeframe as Timeframe,
      startDate: fromTs,
      endDate: toTs,
      trainRatio: trainRatioNum,
      optimizeFor: 'sharpeRatio',
      exchange: 'bybit',
      initialCapital: 10000,
      maxCombinations,
      mode: 'futures',
    };

    // Redirect console.log to stderr so WF progress noise doesn't pollute our output
    const restoreLog = suppressConsoleLog();

    let wfResult: Awaited<ReturnType<typeof runWalkForwardTest>> | null = null;
    let errMsg: string | undefined;

    try {
      wfResult = await runWalkForwardTest(config);
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
    } finally {
      restoreLog();
    }

    if (errMsg !== undefined || wfResult === null) {
      const msg = errMsg ?? 'Unknown error';
      process.stdout.write(`${label} -> ERROR: ${msg}\n`);
      results.push({
        symbol,
        timeframe,
        trainSharpe: 0,
        testSharpe: 0,
        oosDegradePct: 0,
        trainReturn: 0,
        testReturn: 0,
        trainTrades: 0,
        testTrades: 0,
        isRobust: false,
        error: msg,
      });
      continue;
    }

    const trainSharpe = wfResult.trainMetrics.sharpeRatio;
    const testSharpe = wfResult.testMetrics.sharpeRatio;
    const trainReturn = wfResult.trainMetrics.totalReturnPercent;
    const testReturn = wfResult.testMetrics.totalReturnPercent;
    const trainTrades = wfResult.trainMetrics.totalTrades;
    const testTrades = wfResult.testMetrics.totalTrades;
    const oosDegradePct = wfResult.oosDegrade;
    const isRobust = wfResult.isRobust;

    const statusStr = isRobust ? 'PASSED' : 'FAILED';
    const line =
      `${label} -> ` +
      `Train: ${fmtSharpe(trainSharpe)}, ` +
      `Test: ${fmtSharpe(testSharpe)}, ` +
      `OOS: ${fmtPct(oosDegradePct)}, ` +
      `Trades: ${trainTrades}/${testTrades} ` +
      `(${statusStr})`;
    process.stdout.write(line + '\n');

    results.push({
      symbol,
      timeframe,
      trainSharpe,
      testSharpe,
      oosDegradePct,
      trainReturn,
      testReturn,
      trainTrades,
      testTrades,
      isRobust,
    });
  }

  // Sort: errors last, then by testSharpe descending among non-errors
  const sorted = [
    ...results
      .filter((r) => !r.error)
      .sort((a, b) => b.testSharpe - a.testSharpe),
    ...results.filter((r) => r.error),
  ];

  // Print table
  console.log('\n=== RESULTS (sorted by test Sharpe) ===');
  printTable(sorted);

  // Summary
  const nonError = sorted.filter((r) => !r.error);
  const passed = nonError.filter((r) => r.isRobust);
  const passRate = nonError.length > 0 ? (passed.length / nonError.length) * 100 : 0;
  const errorCount = sorted.filter((r) => r.error).length;

  console.log('\n=== SUMMARY ===');
  console.log(`Total tested:  ${total}`);
  console.log(`Errors:        ${errorCount}`);
  console.log(
    `Passed (robust): ${passed.length}/${nonError.length} (${passRate.toFixed(0)}%)`
  );

  if (passed.length > 0) {
    console.log('\nPASSED candidates:');
    passed.forEach((r) => {
      const shortSym = r.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
      console.log(
        `  ${shortSym}@${r.timeframe}  Train: ${fmtSharpe(r.trainSharpe)}  Test: ${fmtSharpe(r.testSharpe)}  OOS: ${fmtPct(r.oosDegradePct)}  Trades: ${r.trainTrades}/${r.testTrades}`
      );
    });
  }

  // Save full results to JSON
  const outputDir = '/workspace/data';
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'fr-spike-wf-results.json');
  const outputData = {
    generatedAt: new Date().toISOString(),
    config: {
      strategy: 'funding-rate-spike',
      from: args.from,
      to: args.to,
      trainRatio,
      maxCombinations,
      candidates,
    },
    summary: {
      total,
      errors: errorCount,
      passed: passed.length,
      failed: nonError.length - passed.length,
      passRate: parseFloat(passRate.toFixed(2)),
    },
    results: sorted,
  };

  writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nFull results saved to ${outputPath}`);

  // Close database connection
  await closeDb();
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  closeDb().catch(() => {}).finally(() => process.exit(1));
});
