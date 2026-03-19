#!/usr/bin/env node
/**
 * Test expanded portfolio combinations with all WF-validated symbols
 *
 * Tests 4 portfolio compositions × 2 allocation modes (top_n mp=3 and top_n mp=5)
 * = 8 total runs.
 *
 * Symbol pools:
 *   5 core    : ZEC, LDO, TRB, NEAR, STG  (V2 WF-optimized params)
 *   8 expanded: 5 core + DUSK, 1000PEPE, PAXG  (Phase B WF pass, default params)
 *   9 w/ DOGE : 8 expanded + DOGE  (V3 WF pass, default params)
 *   11 max    : 9 + XLM, IOST  (V2 WF pass but V3 failed — included for comparison)
 *
 * Period: 2024-01-01 to 2026-03-01
 * Capital: $10,000
 * Strategy: funding-rate-spike-v2, bybit, 4h, futures
 *
 * Usage:
 *   npx tsx scripts/test-expanded-portfolios.ts
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
const STRATEGY = 'funding-rate-spike-v2';

// ============================================================================
// Common params for all symbols
// ============================================================================

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

// ============================================================================
// Per-symbol WF-optimized params (override COMMON_PARAMS where needed)
// ============================================================================

const SYMBOL_PARAMS: Record<string, Record<string, unknown>> = {
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
  // DOGE — V3 WF pass, default params
  'DOGE/USDT:USDT': {
    holdingPeriods: 3,
    shortPercentile: 95,
    longPercentile: 5,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 3.5,
  },
  // DUSK, 1000PEPE, PAXG — Phase B WF pass, default params
  'DUSK/USDT:USDT': {
    holdingPeriods: 3,
    shortPercentile: 95,
    longPercentile: 5,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 3.5,
  },
  '1000PEPE/USDT:USDT': {
    holdingPeriods: 3,
    shortPercentile: 95,
    longPercentile: 5,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 3.5,
  },
  'PAXG/USDT:USDT': {
    holdingPeriods: 3,
    shortPercentile: 95,
    longPercentile: 5,
    atrStopMultiplier: 2.5,
    atrTPMultiplier: 3.5,
  },
};

// ============================================================================
// Portfolio symbol lists
// ============================================================================

const PORTFOLIOS: Record<string, string[]> = {
  '5 core': [
    'ZEC/USDT:USDT',
    'LDO/USDT:USDT',
    'TRB/USDT:USDT',
    'NEAR/USDT:USDT',
    'STG/USDT:USDT',
  ],
  '8 expanded': [
    'ZEC/USDT:USDT',
    'LDO/USDT:USDT',
    'TRB/USDT:USDT',
    'NEAR/USDT:USDT',
    'STG/USDT:USDT',
    'DUSK/USDT:USDT',
    '1000PEPE/USDT:USDT',
    'PAXG/USDT:USDT',
  ],
  '9 with DOGE': [
    'ZEC/USDT:USDT',
    'LDO/USDT:USDT',
    'TRB/USDT:USDT',
    'NEAR/USDT:USDT',
    'STG/USDT:USDT',
    'DUSK/USDT:USDT',
    '1000PEPE/USDT:USDT',
    'PAXG/USDT:USDT',
    'DOGE/USDT:USDT',
  ],
  '11 max': [
    'ZEC/USDT:USDT',
    'LDO/USDT:USDT',
    'TRB/USDT:USDT',
    'NEAR/USDT:USDT',
    'STG/USDT:USDT',
    'DUSK/USDT:USDT',
    '1000PEPE/USDT:USDT',
    'PAXG/USDT:USDT',
    'DOGE/USDT:USDT',
    'XLM/USDT:USDT',
    'IOST/USDT:USDT',
  ],
};

// ============================================================================
// Helpers
// ============================================================================

function buildSubStrategies(symbols: string[]): SubStrategyConfig[] {
  return symbols.map((symbol) => {
    const symbolOverrides = SYMBOL_PARAMS[symbol];
    if (!symbolOverrides) {
      throw new Error(`No per-symbol params defined for ${symbol}`);
    }
    return {
      strategyName: STRATEGY,
      symbol,
      timeframe: TIMEFRAME,
      params: { ...COMMON_PARAMS, ...symbolOverrides },
      exchange: EXCHANGE,
    };
  });
}

function makeAggregationConfig(
  name: string,
  subStrategies: SubStrategyConfig[],
  maxPositions: number,
): AggregationConfig {
  const now = Date.now();
  return {
    id: randomUUID(),
    name,
    allocationMode: 'top_n',
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
// Result row type
// ============================================================================

interface ResultRow {
  portfolioName: string;
  allocMode: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number | undefined;
  profitFactor: number | undefined;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('[expanded-portfolios] Initializing database...\n');
  await initDb();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const maxPositionsList = [3, 5];
  const portfolioNames = Object.keys(PORTFOLIOS) as Array<keyof typeof PORTFOLIOS>;

  const results: ResultRow[] = [];

  let runIndex = 0;
  const totalRuns = portfolioNames.length * maxPositionsList.length;

  for (const portfolioName of portfolioNames) {
    const symbols = PORTFOLIOS[portfolioName];
    const subStrategies = buildSubStrategies(symbols);

    for (const maxPositions of maxPositionsList) {
      runIndex++;
      const allocLabel = `top_n mp=${maxPositions}`;
      const runName = `Expanded Portfolio Test — ${portfolioName} — ${allocLabel} ${ts}`;

      process.stderr.write(
        `\n[expanded-portfolios] === Run ${runIndex}/${totalRuns}: ${portfolioName} | ${allocLabel} ===\n`,
      );
      process.stderr.write(`[expanded-portfolios] Symbols (${symbols.length}): ${symbols.map(s => s.replace('/USDT:USDT', '')).join(', ')}\n`);
      process.stderr.write(`[expanded-portfolios] Period: 2024-01-01 to 2026-03-01\n`);

      const aggConfig = makeAggregationConfig(runName, subStrategies, maxPositions);
      await saveAggregationConfig(aggConfig);
      process.stderr.write(`[expanded-portfolios] Saved aggregation config: ${aggConfig.id}\n`);

      const t0 = Date.now();
      let result: AggregateBacktestResult;

      try {
        result = await runAggregateBacktest(
          {
            subStrategies,
            allocationMode: 'top_n',
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
                  `[expanded-portfolios] Progress: ${current}/${total} (${percent.toFixed(0)}%)\r`,
                );
              }
            },
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n[expanded-portfolios] FAILED: ${msg}\n`);
        await closeDb();
        process.exit(1);
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const m = result.metrics;
      process.stderr.write(
        `\n[expanded-portfolios] Done in ${elapsed}s — ` +
        `Sharpe=${fmt(m.sharpeRatio)}, Return=${fmtPct(m.totalReturnPercent)}, ` +
        `MaxDD=${fmtPct(m.maxDrawdownPercent)}, Trades=${m.totalTrades}\n`,
      );

      await saveBacktestRun(result, aggConfig.id);
      process.stderr.write(`[expanded-portfolios] Saved backtest run: ${result.id}\n`);

      results.push({
        portfolioName,
        allocMode: allocLabel,
        sharpe: m.sharpeRatio,
        returnPct: m.totalReturnPercent,
        maxDD: m.maxDrawdownPercent,
        trades: m.totalTrades,
        winRate: m.winRate,
        profitFactor: m.profitFactor,
      });
    }
  }

  // ============================================================================
  // Print comparison table
  // ============================================================================

  const SEP = '='.repeat(74);
  const DIV = '-'.repeat(74);

  console.log('\n' + SEP);
  console.log('  EXPANDED PORTFOLIO COMPARISON — All WF-Validated Symbols');
  console.log(SEP);

  const hdr = [
    pad('Portfolio', 14),
    pad('Alloc', 10),
    rpad('Sharpe', 8),
    rpad('Return%', 9),
    rpad('MaxDD%', 8),
    rpad('Trades', 8),
    rpad('WinRate', 9),
    rpad('PF', 6),
  ].join(' | ');
  console.log(hdr);
  console.log(DIV);

  for (const r of results) {
    const line = [
      pad(r.portfolioName, 14),
      pad(r.allocMode, 10),
      rpad(fmt(r.sharpe), 8),
      rpad(fmtPct(r.returnPct), 9),
      rpad(fmtPct(r.maxDD), 8),
      rpad(String(r.trades), 8),
      rpad(fmtPct(r.winRate), 9),
      rpad(fmt(r.profitFactor), 6),
    ].join(' | ');
    console.log(line);
  }

  console.log(SEP);
  console.log(`\nAll ${totalRuns} runs saved to database.`);

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(
    `\n[expanded-portfolios] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
