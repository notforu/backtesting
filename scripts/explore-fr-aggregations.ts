#!/usr/bin/env node
/**
 * Explore FR Spike Aggregation Configurations
 *
 * Systematically runs many new funding-rate-spike aggregation configs that have
 * NOT been run before, exploring different asset groupings, allocation modes,
 * max-position sweeps, and strategy parameter variations.
 *
 * Usage:
 *   npx tsx scripts/explore-fr-aggregations.ts
 *   npx tsx scripts/explore-fr-aggregations.ts --from=2024-01-01 --to=2026-02-24
 *   npx tsx scripts/explore-fr-aggregations.ts --skip=5        # resume from config index 5
 *   npx tsx scripts/explore-fr-aggregations.ts --only=3        # run only config at index 3
 */

import { saveBacktestRun, closeDb, initDb } from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { AggregateBacktestConfig, SubStrategyConfig } from '../src/core/signal-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 2) {
        result[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        result[arg.slice(2)] = 'true';
      }
    }
  }
  return result;
}

/** Build a sub-strategy entry for funding-rate-spike */
function fr(
  symbol: string,
  timeframe: '1h' | '4h',
  params: Record<string, unknown> = {},
): SubStrategyConfig {
  return {
    strategyName: 'funding-rate-spike',
    symbol: `${symbol}/USDT:USDT`,
    timeframe,
    params,
    exchange: 'bybit',
  };
}

/** Expand a list of base symbols at a single timeframe */
function subs(
  symbols: string[],
  timeframe: '1h' | '4h',
  params: Record<string, unknown> = {},
): SubStrategyConfig[] {
  return symbols.map((s) => fr(s, timeframe, params));
}

/** Expand a list of base symbols at BOTH 1h and 4h */
function subsBoth(
  symbols: string[],
  params: Record<string, unknown> = {},
): SubStrategyConfig[] {
  return [
    ...symbols.map((s) => fr(s, '1h', params)),
    ...symbols.map((s) => fr(s, '4h', params)),
  ];
}

// ---------------------------------------------------------------------------
// Symbol groups
// ---------------------------------------------------------------------------

// The "Top 10" that scored Sharpe 2.31 (best known config)
const TOP10 = ['ADA', 'ATOM', 'DOT', 'ETC', 'HBAR', 'ICP', 'LINK', 'OP', 'XRP', 'INJ'];

// All 26 available Bybit symbols
const ALL26 = [
  'BTC', 'ETH', 'LTC', 'ADA', 'DOT', 'ETC', 'MANA', 'CRV', 'AXS', 'SNX',
  'IMX', 'LINK', 'VET', 'GRT', 'ICP', 'AAVE', 'HBAR', 'TRX', 'XLM', 'LDO',
  'XRP', 'PENDLE', 'WLD', 'NEAR', 'DOGE', 'WIF', 'OP', 'ATOM', 'INJ',
];

// Meme / high-noise coins
const MEMES = ['DOGE', 'WIF', 'WLD', 'NEAR'];

// ALL26 minus memes
const ALL26_NO_MEMES = ALL26.filter((s) => !MEMES.includes(s));

// Layer-1 base chains
const LAYER1S = ['BTC', 'ETH', 'ADA', 'DOT', 'XRP', 'ATOM', 'HBAR', 'TRX', 'XLM'];

// Mid-cap DeFi / volatile alts
const MID_CAP_VOLATILE = ['MANA', 'AXS', 'IMX', 'CRV', 'SNX', 'WLD', 'WIF', 'PENDLE'];

// Previously strong individual performers
const STABLE_PERFORMERS = ['DOT', 'ETC', 'LINK', 'XRP', 'AAVE', 'HBAR'];

// Top 5 by individual Sharpe (from prior single-asset grid searches)
const TOP5_INDIVIDUAL = ['ADA', 'INJ', 'OP', 'ATOM', 'DOT'];

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

interface ExploreConfig {
  name: string;
  allocationMode: 'top_n' | 'weighted_multi' | 'single_strongest';
  maxPositions: number;
  subStrategies: SubStrategyConfig[];
}

// ---------------------------------------------------------------------------
// All configs to explore (~28 total)
// ---------------------------------------------------------------------------

const CONFIGS: ExploreConfig[] = [
  // -------------------------------------------------------------------------
  // 1. Allocation mode variations on the best Top-10 config
  // -------------------------------------------------------------------------
  {
    name: 'Top 10 weighted_multi maxPos=5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 single_strongest',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(TOP10, '4h'),
  },

  // -------------------------------------------------------------------------
  // 2. Max-positions sweep on Top 10 (top_n, 4h)
  // -------------------------------------------------------------------------
  {
    name: 'Top 10 top_n maxPos=2',
    allocationMode: 'top_n',
    maxPositions: 2,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 top_n maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 top_n maxPos=4',
    allocationMode: 'top_n',
    maxPositions: 4,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 top_n maxPos=6',
    allocationMode: 'top_n',
    maxPositions: 6,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 top_n maxPos=7',
    allocationMode: 'top_n',
    maxPositions: 7,
    subStrategies: subs(TOP10, '4h'),
  },
  {
    name: 'Top 10 top_n maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subs(TOP10, '4h'),
  },

  // -------------------------------------------------------------------------
  // 3. New asset groupings - themed portfolios
  // -------------------------------------------------------------------------
  {
    name: 'Layer 1s 4h maxPos=4',
    allocationMode: 'top_n',
    maxPositions: 4,
    subStrategies: subs(LAYER1S, '4h'),
  },
  {
    name: 'Layer 1s 1h maxPos=4',
    allocationMode: 'top_n',
    maxPositions: 4,
    subStrategies: subs(LAYER1S, '1h'),
  },
  {
    name: 'Mid-caps volatile 1h maxPos=4',
    allocationMode: 'top_n',
    maxPositions: 4,
    subStrategies: subs(MID_CAP_VOLATILE, '1h'),
  },
  {
    name: 'Mid-caps volatile 4h maxPos=4',
    allocationMode: 'top_n',
    maxPositions: 4,
    subStrategies: subs(MID_CAP_VOLATILE, '4h'),
  },
  {
    name: 'Stable performers 4h maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(STABLE_PERFORMERS, '4h'),
  },
  {
    name: 'Full universe 1h maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(ALL26, '1h'),
  },
  {
    name: 'Full universe 1h maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subs(ALL26, '1h'),
  },
  {
    name: 'Full universe 1h maxPos=10',
    allocationMode: 'top_n',
    maxPositions: 10,
    subStrategies: subs(ALL26, '1h'),
  },
  {
    name: 'Full universe 4h maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(ALL26, '4h'),
  },
  {
    name: 'Full universe 4h maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subs(ALL26, '4h'),
  },
  {
    name: 'Full universe 4h maxPos=10',
    allocationMode: 'top_n',
    maxPositions: 10,
    subStrategies: subs(ALL26, '4h'),
  },
  {
    name: 'Full universe mixed 1h+4h maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subsBoth(ALL26),
  },
  {
    name: 'Full universe mixed 1h+4h maxPos=12',
    allocationMode: 'top_n',
    maxPositions: 12,
    subStrategies: subsBoth(ALL26),
  },
  {
    name: 'Top 5 individual Sharpe maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      fr('ADA', '1h'),
      fr('INJ', '4h'),
      fr('OP', '1h'),
      fr('ATOM', '4h'),
      fr('DOT', '4h'),
    ],
  },
  {
    name: 'Meme coins only 1h maxPos=2',
    allocationMode: 'top_n',
    maxPositions: 2,
    subStrategies: subs(MEMES, '1h'),
  },
  {
    name: 'Without memes 4h maxPos=6',
    allocationMode: 'top_n',
    maxPositions: 6,
    subStrategies: subs(ALL26_NO_MEMES, '4h'),
  },

  // -------------------------------------------------------------------------
  // 4. Parameter variations on Top 10 (top_n, 4h, maxPos=5)
  // -------------------------------------------------------------------------
  {
    name: 'Top 10 4h maxPos=5 tighter thresholds',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(TOP10, '4h', {
      fundingThresholdShort: 0.001,
      fundingThresholdLong: -0.0006,
    }),
  },
  {
    name: 'Top 10 4h maxPos=5 holdingPeriods=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(TOP10, '4h', {
      holdingPeriods: 5,
    }),
  },
  {
    name: 'Top 10 4h maxPos=5 zScore mode',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(TOP10, '4h', {
      useZScore: true,
      zScoreThreshold: 2.0,
    }),
  },
];

// ---------------------------------------------------------------------------
// Summary row type
// ---------------------------------------------------------------------------

interface SummaryRow {
  index: number;
  name: string;
  sharpe: number;
  returnPct: number;
  maxDDPct: number;
  trades: number;
  fundingUsd: number;
  status: 'ok' | 'error';
  error?: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const from = args.from ?? '2024-01-01';
  const to = args.to ?? '2026-02-24';
  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();

  const skipN = args.skip !== undefined ? parseInt(args.skip, 10) : 0;
  const onlyN = args.only !== undefined ? parseInt(args.only, 10) : -1;

  console.log('=== EXPLORE FR AGGREGATIONS ===');
  console.log(`Period : ${from} to ${to}`);
  console.log(`Configs: ${CONFIGS.length} defined`);
  if (onlyN >= 0) {
    console.log(`Mode   : --only=${onlyN} (single config)`);
  } else if (skipN > 0) {
    console.log(`Mode   : --skip=${skipN} (resume from index ${skipN})`);
  }
  console.log('');

  await initDb();

  const summaryRows: SummaryRow[] = [];

  // Determine which configs to run
  let toRun: Array<{ index: number; config: ExploreConfig }> = CONFIGS.map((c, i) => ({
    index: i,
    config: c,
  }));

  if (onlyN >= 0) {
    if (onlyN >= CONFIGS.length) {
      console.error(`--only=${onlyN} is out of range. Valid range: 0-${CONFIGS.length - 1}`);
      await closeDb();
      process.exit(1);
    }
    toRun = [{ index: onlyN, config: CONFIGS[onlyN] }];
  } else if (skipN > 0) {
    toRun = toRun.slice(skipN);
  }

  console.log(`Running ${toRun.length} config(s).\n`);

  for (const { index, config } of toRun) {
    const label = `[${index + 1}/${CONFIGS.length}] ${config.name}`;
    console.log(`${label}`);
    console.log(
      `  mode=${config.allocationMode}, maxPos=${config.maxPositions}, ` +
      `subStrategies=${config.subStrategies.length}`,
    );

    try {
      const aggregateConfig: AggregateBacktestConfig = {
        subStrategies: config.subStrategies,
        allocationMode: config.allocationMode,
        maxPositions: config.maxPositions,
        initialCapital: 10000,
        startDate,
        endDate,
        exchange: 'bybit',
        mode: 'futures',
      };

      const startTime = Date.now();
      const result = await runAggregateBacktest(aggregateConfig, {
        saveResults: false,
        enableLogging: false,
      });
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      await saveBacktestRun(result);

      const m = result.metrics;
      const fundingIncome = (m as Record<string, unknown>).totalFundingIncome;
      const fundingUsd = typeof fundingIncome === 'number' ? fundingIncome : 0;

      console.log(
        `  Done in ${duration}s` +
        ` | Sharpe ${m.sharpeRatio.toFixed(2)}` +
        ` | Return ${m.totalReturnPercent.toFixed(1)}%` +
        ` | MaxDD ${m.maxDrawdownPercent.toFixed(1)}%` +
        ` | Trades ${m.totalTrades}` +
        ` | Funding $${fundingUsd.toFixed(0)}`,
      );

      summaryRows.push({
        index,
        name: config.name,
        sharpe: m.sharpeRatio,
        returnPct: m.totalReturnPercent,
        maxDDPct: m.maxDrawdownPercent,
        trades: m.totalTrades,
        fundingUsd,
        status: 'ok',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED: ${msg}`);
      summaryRows.push({
        index,
        name: config.name,
        sharpe: 0,
        returnPct: 0,
        maxDDPct: 0,
        trades: 0,
        fundingUsd: 0,
        status: 'error',
        error: msg,
      });
    }

    console.log('');
  }

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------

  const succeeded = summaryRows.filter((r) => r.status === 'ok');
  const failed = summaryRows.filter((r) => r.status === 'error');

  console.log('='.repeat(110));
  console.log('SUMMARY TABLE (sorted by Sharpe desc)');
  console.log('='.repeat(110));

  const header = [
    '#'.padStart(3),
    'Name'.padEnd(52),
    'Sharpe'.padStart(7),
    'Return%'.padStart(8),
    'MaxDD%'.padStart(7),
    'Trades'.padStart(7),
    'Funding$'.padStart(9),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(110));

  const sorted = [...succeeded].sort((a, b) => b.sharpe - a.sharpe);

  for (const row of sorted) {
    const line = [
      String(row.index + 1).padStart(3),
      row.name.slice(0, 52).padEnd(52),
      row.sharpe.toFixed(2).padStart(7),
      row.returnPct.toFixed(1).padStart(8),
      row.maxDDPct.toFixed(1).padStart(7),
      String(row.trades).padStart(7),
      row.fundingUsd.toFixed(0).padStart(9),
    ].join('  ');
    console.log(line);
  }

  if (failed.length > 0) {
    console.log('');
    console.log('FAILED CONFIGS:');
    for (const row of failed) {
      console.log(`  [${row.index + 1}] ${row.name}: ${row.error ?? 'unknown error'}`);
    }
  }

  console.log('-'.repeat(110));
  console.log(`Succeeded: ${succeeded.length}  |  Failed: ${failed.length}  |  Total: ${summaryRows.length}`);
  console.log('='.repeat(110));

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb().catch(() => {});
  process.exit(1);
});
