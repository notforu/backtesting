/**
 * Position Sizing Sensitivity Analysis
 *
 * Tests how different position sizes affect portfolio performance for the
 * FR V2 7-sym WF-opt, top_n mp=3 configuration.
 *
 * In top_n mode the aggregate engine allocates:
 *   capitalPerPosition = initialCapital * positionSizeFraction / maxPositions
 *
 * With maxPositions=3 the effective per-position size as a % of total capital is:
 *   positionSizeFraction / 3
 *
 * The "positionSizePct" strategy param is NOT used by the aggregate engine —
 * it only applies in single-asset mode where the strategy calls context.openLong().
 * In aggregate mode, capital allocation is controlled entirely by the engine.
 *
 * Current default: positionSizeFraction=0.9 → each position gets 30% of capital.
 *
 * This script sweeps positionSizeFraction values to produce per-position sizes of:
 *   50% (aggressive), 30% (default), 20%, 15%, 10% (conservative)
 *
 * Strategy: funding-rate-spike-v2
 * Symbols: 7 WF-optimized (ZEC, LDO, TRB, XLM, IOST, NEAR, STG)
 * Period: 2024-01-01 to 2026-03-01
 * Capital: $10,000 | Exchange: bybit | TF: 4h | Mode: futures
 *
 * Progress is written to stderr; results table to stdout.
 * Does NOT save results to DB.
 *
 * Usage:
 *   npx tsx scripts/position-sizing-sensitivity.ts
 */

import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb } from '../src/data/db.js';
import type { SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// Config constants
// ============================================================================

const START_DATE = new Date('2024-01-01').getTime();
const END_DATE = new Date('2026-03-01').getTime();
const TF = '4h' as Timeframe;
const INITIAL_CAPITAL = 10_000;
const MAX_POSITIONS = 3;
const EXCHANGE = 'bybit';
const STRATEGY = 'funding-rate-spike-v2';

// ============================================================================
// WF-optimized params per symbol (V2, 7-symbol set)
// ============================================================================

// Common param overrides shared across all symbols (leave strategy defaults for
// unlisted params: usePercentile=true, percentileLookback=90, atrPeriod=14,
// useATRStops=true, useTrendFilter=true, atrFilterEnabled=true, etc.)
function commonParams(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    // Locked/shared params
    atrPeriod: 14,
    useATRStops: true,
    useTrendFilter: true,
    usePercentile: true,
    percentileLookback: 90,
    atrFilterEnabled: true,
    atrFilterThreshold: 1.5,
    useTrailingStop: false,
    useFRVelocity: false,
    positionSizeMethod: 'fixed',
    // Per-symbol WF-optimized overrides
    ...overrides,
  };
}

const SUB_STRATEGIES: SubStrategyConfig[] = [
  {
    strategyName: STRATEGY,
    symbol: 'ZEC/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 2,
      shortPercentile: 98,
      longPercentile: 4,
      atrStopMultiplier: 2.5,
      atrTPMultiplier: 4.5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'LDO/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 4,
      shortPercentile: 96,
      longPercentile: 2,
      atrStopMultiplier: 3.5,
      atrTPMultiplier: 3.5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'TRB/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 2,
      shortPercentile: 98,
      longPercentile: 6,
      atrStopMultiplier: 2.5,
      atrTPMultiplier: 5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'XLM/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 6,
      shortPercentile: 94,
      longPercentile: 10,
      atrStopMultiplier: 3,
      atrTPMultiplier: 5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'IOST/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 4,
      shortPercentile: 94,
      longPercentile: 4,
      atrStopMultiplier: 3.5,
      atrTPMultiplier: 2.5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'NEAR/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 3,
      shortPercentile: 96,
      longPercentile: 6,
      atrStopMultiplier: 3,
      atrTPMultiplier: 2.5,
    }),
  },
  {
    strategyName: STRATEGY,
    symbol: 'STG/USDT:USDT',
    timeframe: TF,
    exchange: EXCHANGE,
    params: commonParams({
      holdingPeriods: 4,
      shortPercentile: 94,
      longPercentile: 10,
      atrStopMultiplier: 1.5,
      atrTPMultiplier: 2.5,
    }),
  },
];

// ============================================================================
// Position size scenarios
//
// In top_n mode with maxPositions=3:
//   capitalPerPosition = initialCapital * positionSizeFraction / maxPositions
//   effectivePct = positionSizeFraction / maxPositions * 100
//
// To hit target effectivePct:
//   positionSizeFraction = targetPct / 100 * maxPositions
// ============================================================================

interface SizeScenario {
  /** Display label (as % of total capital per position) */
  label: string;
  /** positionSizeFraction passed to AggregateEngineConfig */
  positionSizeFraction: number;
  /** Effective % of capital per position (for display) */
  effectivePct: number;
}

const SCENARIOS: SizeScenario[] = [
  { label: '50%', effectivePct: 50, positionSizeFraction: (50 / 100) * MAX_POSITIONS },
  { label: '30%', effectivePct: 30, positionSizeFraction: (30 / 100) * MAX_POSITIONS },
  { label: '20%', effectivePct: 20, positionSizeFraction: (20 / 100) * MAX_POSITIONS },
  { label: '15%', effectivePct: 15, positionSizeFraction: (15 / 100) * MAX_POSITIONS },
  { label: '10%', effectivePct: 10, positionSizeFraction: (10 / 100) * MAX_POSITIONS },
];

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n)) return 'N/A';
  return n.toFixed(decimals);
}

function rpad(s: string, w: number): string {
  return s.padEnd(w);
}

function lpad(s: string, w: number): string {
  return s.padStart(w);
}

// ============================================================================
// Result container
// ============================================================================

interface ScenarioResult {
  scenario: SizeScenario;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  fundingIncome: number;
  finalEquity: number;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('Initializing database...\n');
  await initDb();

  const results: ScenarioResult[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    const capitalPerPosition = INITIAL_CAPITAL * scenario.positionSizeFraction / MAX_POSITIONS;
    const totalDeployed = capitalPerPosition * MAX_POSITIONS;

    process.stderr.write(
      `\n[${i + 1}/${SCENARIOS.length}] Running position size ${scenario.label} ` +
      `(positionSizeFraction=${scenario.positionSizeFraction.toFixed(2)}, ` +
      `$${capitalPerPosition.toFixed(0)}/position, ` +
      `$${totalDeployed.toFixed(0)} max deployed of $${INITIAL_CAPITAL})\n`,
    );

    try {
      const result = await runAggregateBacktest(
        {
          subStrategies: SUB_STRATEGIES,
          allocationMode: 'top_n',
          maxPositions: MAX_POSITIONS,
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
          positionSizeFraction: scenario.positionSizeFraction,
          onProgress: ({ percent }) => {
            if (Math.round(percent) % 20 === 0) {
              process.stderr.write(`  Progress: ${percent.toFixed(0)}%\r`);
            }
          },
        },
      );

      process.stderr.write(`  Progress: 100%  \n`);

      const m = result.metrics;
      const equity = result.equity;
      const finalEquity = equity.length > 0 ? equity[equity.length - 1].equity : INITIAL_CAPITAL;
      const fundingIncome = (m as Record<string, unknown>).totalFundingIncome as number ?? 0;

      process.stderr.write(
        `  Done: Sharpe=${fmt(m.sharpeRatio)}  Return=${fmt(m.totalReturnPercent)}%  ` +
        `MaxDD=${fmt(m.maxDrawdownPercent)}%  Trades=${m.totalTrades}  ` +
        `WinRate=${fmt(m.winRate)}%  PF=${fmt(m.profitFactor)}\n`,
      );

      results.push({
        scenario,
        sharpe: m.sharpeRatio,
        returnPct: m.totalReturnPercent,
        maxDD: m.maxDrawdownPercent,
        trades: m.totalTrades,
        winRate: m.winRate,
        profitFactor: m.profitFactor,
        fundingIncome,
        finalEquity,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ERROR: ${msg}\n`);
      // Push a placeholder so we can still show the row
      results.push({
        scenario,
        sharpe: NaN,
        returnPct: NaN,
        maxDD: NaN,
        trades: 0,
        winRate: NaN,
        profitFactor: NaN,
        fundingIncome: NaN,
        finalEquity: NaN,
      });
    }
  }

  await closeDb();

  // ============================================================================
  // Print results table to stdout
  // ============================================================================

  const NOTE =
    'NOTE: "current default" (positionSizeFraction=0.9) gives 30% per position in top_n mp=3.\n' +
    'The strategy param positionSizePct=50 is NOT used by the aggregate engine.\n';

  const DIVIDER = '='.repeat(65);
  const SEPARATOR = '-'.repeat(65);

  console.log('\n' + DIVIDER);
  console.log('  POSITION SIZING SENSITIVITY -- FR V2, 7 sym WF-opt, top_n mp=3');
  console.log('  Period: 2024-01-01 to 2026-03-01  |  Capital: $10,000');
  console.log(DIVIDER);

  const header =
    rpad('PosSizePct', 12) +
    lpad('Sharpe', 8) +
    lpad('Return%', 9) +
    lpad('MaxDD%', 8) +
    lpad('Trades', 8) +
    lpad('WinRate', 9) +
    lpad('PF', 7) +
    lpad('FundingInc', 12) +
    lpad('FinalEq', 9);

  console.log(header);
  console.log(SEPARATOR);

  for (const r of results) {
    const label = r.scenario.label;
    const isDefault = r.scenario.effectivePct === 30;
    const marker = isDefault ? ' *' : '  ';

    const row =
      rpad(label + marker, 12) +
      lpad(fmt(r.sharpe), 8) +
      lpad(fmt(r.returnPct) + '%', 9) +
      lpad(fmt(r.maxDD) + '%', 8) +
      lpad(String(r.trades), 8) +
      lpad(fmt(r.winRate) + '%', 9) +
      lpad(fmt(r.profitFactor), 7) +
      lpad('$' + fmt(r.fundingIncome, 0), 12) +
      lpad('$' + fmt(r.finalEquity, 0), 9);

    console.log(row);
  }

  console.log(DIVIDER);
  console.log('* = current default (positionSizeFraction=0.9 → 30% per position)');
  console.log();
  console.log(NOTE);

  // Per-position capital breakdown
  console.log('Capital per position breakdown (maxPositions=3, initialCapital=$10,000):');
  for (const s of SCENARIOS) {
    const perPos = INITIAL_CAPITAL * s.positionSizeFraction / MAX_POSITIONS;
    const maxDeployed = perPos * MAX_POSITIONS;
    const deployedPct = (maxDeployed / INITIAL_CAPITAL) * 100;
    console.log(
      `  ${rpad(s.label, 5)} → $${perPos.toFixed(0)}/position` +
      ` (max deployed $${maxDeployed.toFixed(0)} = ${deployedPct.toFixed(0)}% of capital)`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
