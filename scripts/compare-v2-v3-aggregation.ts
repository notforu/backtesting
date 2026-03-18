#!/usr/bin/env node
/**
 * Compare FR V2 vs V3 Aggregation Backtest
 *
 * Runs two identical 13-symbol aggregation backtests (single_strongest, 4h)
 * and compares results side-by-side:
 *   - funding-rate-spike-v2 (baseline)
 *   - funding-rate-spike-v3 (with regime filter: useRegimeFilter=true, bearMode=block)
 *
 * Both runs use exactly the same symbols, timeframe, capital, and date range.
 * Results are saved to DB and a comparison table is printed to stdout.
 *
 * Usage:
 *   npx tsx scripts/compare-v2-v3-aggregation.ts
 */

import { randomUUID } from 'crypto';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb, saveAggregationConfig, saveBacktestRun } from '../src/data/db.js';
import type { AggregationConfig } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Configuration
// ============================================================================

const START_DATE = 1704067200000; // 2024-01-01
const END_DATE = 1772323200000;   // 2026-03-01
const INITIAL_CAPITAL = 10000;
const EXCHANGE = 'bybit';
const TIMEFRAME = '4h' as Timeframe;

/** The 13 symbols to trade */
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

/** Params shared by all sub-strategies (both V2 and V3) */
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

/** Additional params for V3 regime filter */
const V3_REGIME_PARAMS: Record<string, unknown> = {
  useRegimeFilter: true,
  bearMode: 'block',
  regimeMAType: 'ema',
  regimeSMAPeriod: 200,
};

// ============================================================================
// Build sub-strategy lists
// ============================================================================

function buildSubStrategies(strategyName: string, extraParams: Record<string, unknown> = {}): SubStrategyConfig[] {
  return SYMBOLS.map((symbol) => ({
    strategyName,
    symbol,
    timeframe: TIMEFRAME,
    params: { ...SHARED_PARAMS, ...extraParams },
    exchange: EXCHANGE,
  }));
}

const v2SubStrategies = buildSubStrategies('funding-rate-spike-v2');
const v3SubStrategies = buildSubStrategies('funding-rate-spike-v3', V3_REGIME_PARAMS);

// ============================================================================
// DB aggregation config factory
// ============================================================================

function makeAggregationConfig(
  name: string,
  subStrategies: SubStrategyConfig[],
): AggregationConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    allocationMode: 'single_strongest',
    maxPositions: 1,
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
// Comparison table printers
// ============================================================================

function printPortfolioComparison(
  v2Result: AggregateBacktestResult,
  v3Result: AggregateBacktestResult,
): void {
  const v2m = v2Result.metrics;
  const v3m = v3Result.metrics;

  const v2Funding = (v2m as Record<string, unknown>).totalFundingIncome;
  const v3Funding = (v3m as Record<string, unknown>).totalFundingIncome;
  const v2FundingUsd = typeof v2Funding === 'number' ? v2Funding : 0;
  const v3FundingUsd = typeof v3Funding === 'number' ? v3Funding : 0;

  const COL = 14;
  const LABEL = 16;

  console.log('\n' + '='.repeat(70));
  console.log('  PORTFOLIO-LEVEL COMPARISON: V2 vs V3 (regime filter: block bear)');
  console.log('='.repeat(70));
  console.log(
    pad('Metric', LABEL) +
    rpad('V2', COL) +
    rpad('V3', COL) +
    rpad('Delta', COL),
  );
  console.log('-'.repeat(70));

  const rows: Array<[string, string, string, string]> = [
    [
      'Sharpe',
      fmt(v2m.sharpeRatio),
      fmt(v3m.sharpeRatio),
      fmt(v3m.sharpeRatio - v2m.sharpeRatio),
    ],
    [
      'Return%',
      fmtPct(v2m.totalReturnPercent),
      fmtPct(v3m.totalReturnPercent),
      fmtPct(v3m.totalReturnPercent - v2m.totalReturnPercent),
    ],
    [
      'MaxDD%',
      fmtPct(v2m.maxDrawdownPercent),
      fmtPct(v3m.maxDrawdownPercent),
      fmtPct(v3m.maxDrawdownPercent - v2m.maxDrawdownPercent),
    ],
    [
      'Trades',
      String(v2m.totalTrades),
      String(v3m.totalTrades),
      String(v3m.totalTrades - v2m.totalTrades),
    ],
    [
      'WinRate',
      fmtPct(v2m.winRate),
      fmtPct(v3m.winRate),
      fmtPct((v3m.winRate ?? 0) - (v2m.winRate ?? 0)),
    ],
    [
      'ProfitFactor',
      fmt(v2m.profitFactor),
      fmt(v3m.profitFactor),
      fmt((v3m.profitFactor ?? 0) - (v2m.profitFactor ?? 0)),
    ],
    [
      'Sortino',
      fmt(v2m.sortinoRatio),
      fmt(v3m.sortinoRatio),
      fmt((v3m.sortinoRatio ?? 0) - (v2m.sortinoRatio ?? 0)),
    ],
    [
      'Funding $',
      '$' + v2FundingUsd.toFixed(0),
      '$' + v3FundingUsd.toFixed(0),
      '$' + (v3FundingUsd - v2FundingUsd).toFixed(0),
    ],
  ];

  for (const [metric, v2val, v3val, delta] of rows) {
    console.log(
      pad(metric, LABEL) +
      rpad(v2val, COL) +
      rpad(v3val, COL) +
      rpad(delta, COL),
    );
  }

  console.log('='.repeat(70));
}

function printPerAssetComparison(
  v2Result: AggregateBacktestResult,
  v3Result: AggregateBacktestResult,
): void {
  console.log('\n' + '='.repeat(90));
  console.log('  PER-ASSET COMPARISON: V2 vs V3');
  console.log('='.repeat(90));

  const SYMCOL = 14;
  const VALCOL = 10;

  // Header
  console.log(
    pad('Symbol', SYMCOL) +
    rpad('V2 Sharpe', VALCOL) +
    rpad('V3 Sharpe', VALCOL) +
    rpad('V2 Ret%', VALCOL) +
    rpad('V3 Ret%', VALCOL) +
    rpad('V2 Trades', VALCOL) +
    rpad('V3 Trades', VALCOL) +
    rpad('V2 DD%', VALCOL) +
    rpad('V3 DD%', VALCOL),
  );
  console.log('-'.repeat(90));

  // Collect all symbols from both results
  const allSymbols = new Set([
    ...Object.keys(v2Result.perAssetResults),
    ...Object.keys(v3Result.perAssetResults),
  ]);

  const rows: Array<{
    sym: string;
    v2Sharpe: number;
    v3Sharpe: number;
    v2Ret: number;
    v3Ret: number;
    v2Trades: number;
    v3Trades: number;
    v2DD: number;
    v3DD: number;
  }> = [];

  for (const symbol of allSymbols) {
    const v2Asset = v2Result.perAssetResults[symbol];
    const v3Asset = v3Result.perAssetResults[symbol];
    const shortSym = symbol.replace('/USDT:USDT', '').replace('/USDT', '');

    rows.push({
      sym: shortSym,
      v2Sharpe: v2Asset?.metrics.sharpeRatio ?? 0,
      v3Sharpe: v3Asset?.metrics.sharpeRatio ?? 0,
      v2Ret: v2Asset?.metrics.totalReturnPercent ?? 0,
      v3Ret: v3Asset?.metrics.totalReturnPercent ?? 0,
      v2Trades: v2Asset?.metrics.totalTrades ?? 0,
      v3Trades: v3Asset?.metrics.totalTrades ?? 0,
      v2DD: v2Asset?.metrics.maxDrawdownPercent ?? 0,
      v3DD: v3Asset?.metrics.maxDrawdownPercent ?? 0,
    });
  }

  // Sort by V2 Sharpe descending
  rows.sort((a, b) => b.v2Sharpe - a.v2Sharpe);

  for (const r of rows) {
    console.log(
      pad(r.sym, SYMCOL) +
      rpad(fmt(r.v2Sharpe), VALCOL) +
      rpad(fmt(r.v3Sharpe), VALCOL) +
      rpad(fmtPct(r.v2Ret), VALCOL) +
      rpad(fmtPct(r.v3Ret), VALCOL) +
      rpad(String(r.v2Trades), VALCOL) +
      rpad(String(r.v3Trades), VALCOL) +
      rpad(fmtPct(r.v2DD), VALCOL) +
      rpad(fmtPct(r.v3DD), VALCOL),
    );
  }

  console.log('='.repeat(90));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[compare-v2-v3] Initializing database...\n');
  await initDb();

  // -------------------------------------------------------------------------
  // Run V2
  // -------------------------------------------------------------------------
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const v2Config = makeAggregationConfig(`FR V2 vs V3 Comparison — V2 baseline (13 symbols, SS) ${ts}`, v2SubStrategies);

  process.stderr.write(`\n[compare-v2-v3] === Running V2 (funding-rate-spike-v2) ===\n`);
  process.stderr.write(`[compare-v2-v3] Symbols: ${SYMBOLS.length}\n`);
  process.stderr.write(`[compare-v2-v3] Period:  2024-01-01 to 2026-03-01\n`);
  process.stderr.write(`[compare-v2-v3] Mode:    single_strongest, maxPositions=1\n`);

  await saveAggregationConfig(v2Config);
  process.stderr.write(`[compare-v2-v3] Saved aggregation config: ${v2Config.id}\n`);

  const v2StartTime = Date.now();
  let v2Result: AggregateBacktestResult;
  try {
    v2Result = await runAggregateBacktest(
      {
        subStrategies: v2SubStrategies,
        allocationMode: 'single_strongest',
        maxPositions: 1,
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
            process.stderr.write(`[compare-v2-v3] V2 progress: ${current}/${total} (${percent.toFixed(0)}%)\r`);
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[compare-v2-v3] V2 FAILED: ${msg}\n`);
    await closeDb();
    process.exit(1);
  }

  const v2Duration = ((Date.now() - v2StartTime) / 1000).toFixed(1);
  process.stderr.write(`\n[compare-v2-v3] V2 done in ${v2Duration}s\n`);
  process.stderr.write(
    `[compare-v2-v3] V2 result: Sharpe=${v2Result.metrics.sharpeRatio.toFixed(2)}, ` +
    `Return=${v2Result.metrics.totalReturnPercent.toFixed(1)}%, ` +
    `MaxDD=${v2Result.metrics.maxDrawdownPercent.toFixed(1)}%, ` +
    `Trades=${v2Result.metrics.totalTrades}\n`,
  );

  await saveBacktestRun(v2Result, v2Config.id);
  process.stderr.write(`[compare-v2-v3] V2 backtest run saved: ${v2Result.id}\n`);

  // -------------------------------------------------------------------------
  // Run V3
  // -------------------------------------------------------------------------
  const v3Config = makeAggregationConfig(`FR V2 vs V3 Comparison — V3 regime filter block (13 symbols, SS) ${ts}`, v3SubStrategies);

  process.stderr.write(`\n[compare-v2-v3] === Running V3 (funding-rate-spike-v3 + regime filter: block bear) ===\n`);
  process.stderr.write(`[compare-v2-v3] Symbols: ${SYMBOLS.length}\n`);
  process.stderr.write(`[compare-v2-v3] Period:  2024-01-01 to 2026-03-01\n`);
  process.stderr.write(`[compare-v2-v3] Mode:    single_strongest, maxPositions=1\n`);
  process.stderr.write(`[compare-v2-v3] Regime:  useRegimeFilter=true, bearMode=block, regimeMAType=ema, regimeSMAPeriod=200\n`);

  await saveAggregationConfig(v3Config);
  process.stderr.write(`[compare-v2-v3] Saved aggregation config: ${v3Config.id}\n`);

  const v3StartTime = Date.now();
  let v3Result: AggregateBacktestResult;
  try {
    v3Result = await runAggregateBacktest(
      {
        subStrategies: v3SubStrategies,
        allocationMode: 'single_strongest',
        maxPositions: 1,
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
            process.stderr.write(`[compare-v2-v3] V3 progress: ${current}/${total} (${percent.toFixed(0)}%)\r`);
          }
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[compare-v2-v3] V3 FAILED: ${msg}\n`);
    await closeDb();
    process.exit(1);
  }

  const v3Duration = ((Date.now() - v3StartTime) / 1000).toFixed(1);
  process.stderr.write(`\n[compare-v2-v3] V3 done in ${v3Duration}s\n`);
  process.stderr.write(
    `[compare-v2-v3] V3 result: Sharpe=${v3Result.metrics.sharpeRatio.toFixed(2)}, ` +
    `Return=${v3Result.metrics.totalReturnPercent.toFixed(1)}%, ` +
    `MaxDD=${v3Result.metrics.maxDrawdownPercent.toFixed(1)}%, ` +
    `Trades=${v3Result.metrics.totalTrades}\n`,
  );

  await saveBacktestRun(v3Result, v3Config.id);
  process.stderr.write(`[compare-v2-v3] V3 backtest run saved: ${v3Result.id}\n`);

  // -------------------------------------------------------------------------
  // Print comparison tables
  // -------------------------------------------------------------------------
  printPortfolioComparison(v2Result, v3Result);
  printPerAssetComparison(v2Result, v3Result);

  console.log('\nDone. Both runs saved to database.');
  console.log(`V2 aggregation config ID: ${v2Config.id}`);
  console.log(`V3 aggregation config ID: ${v3Config.id}`);
  console.log(`V2 backtest run ID:       ${v2Result.id}`);
  console.log(`V3 backtest run ID:       ${v3Result.id}`);

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(`\n[compare-v2-v3] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
