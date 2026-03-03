#!/usr/bin/env node
/**
 * Explore FR Spike V2 Aggregation Configurations
 *
 * Systematically runs funding-rate-spike-v2 aggregation configs covering
 * v2-top performers, v1-top performers with useTrendFilter:false, mixed
 * hybrid portfolios, and the full v2 universe.
 *
 * Usage:
 *   npx tsx scripts/explore-fr-v2-aggregations.ts
 *   npx tsx scripts/explore-fr-v2-aggregations.ts --from=2024-01-01 --to=2026-02-24
 *   npx tsx scripts/explore-fr-v2-aggregations.ts --skip=5        # resume from config index 5
 *   npx tsx scripts/explore-fr-v2-aggregations.ts --only=3        # run only config at index 3
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

/** Build a sub-strategy entry for funding-rate-spike-v2 */
function fr(
  symbol: string,
  timeframe: '1h' | '4h',
  params: Record<string, unknown> = {},
): SubStrategyConfig {
  return {
    strategyName: 'funding-rate-spike-v2',
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

// Top v2 performers (Sharpe > 0.5 at 4h with defaults)
const V2_TOP7 = ['LDO', 'DOGE', 'IMX', 'GRT', 'ICP', 'XLM', 'NEAR'];

// v1 top performers (trend filter off to recover v1-like behaviour)
const V1_TOPS_NOTF = ['ATOM', 'ADA', 'DOT', 'INJ', 'OP'];

// Mixed: best from both versions
const BEST_MIXED = ['LDO', 'ATOM', 'DOGE', 'IMX', 'ICP', 'INJ', 'ADA'];

// Safe/stable (low drawdown in v2)
const LOW_DD = ['LDO', 'DOGE', 'ICP', 'HBAR', 'TRX'];

// All that were profitable in v2 (Sharpe > 0)
const V2_PROFITABLE = ['LDO', 'DOGE', 'IMX', 'GRT', 'ICP', 'XLM', 'NEAR', 'HBAR', 'LINK', 'TRX', 'VET', 'ETC'];

// Full 29-symbol universe for v2
const ALL29 = [
  'BTC', 'ETH', 'LTC', 'ADA', 'DOT', 'ETC', 'MANA', 'CRV', 'AXS', 'SNX',
  'IMX', 'LINK', 'VET', 'GRT', 'ICP', 'AAVE', 'HBAR', 'TRX', 'XLM', 'LDO',
  'XRP', 'PENDLE', 'WLD', 'NEAR', 'DOGE', 'WIF', 'OP', 'ATOM', 'INJ',
];

// New V2 scan discoveries (Sharpe > 0.5)
const V2_DISCOVERIES = ['RPL', 'ENS', 'ARB', 'TIA', 'APT', 'COMP', 'JTO', 'BCH'];

// Extended top performers: original V2 Top7 + top 3 discoveries
const V2_EXTENDED_TOP10 = ['LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'RPL', 'ENS', 'ARB'];

// Low-drawdown portfolio (MaxDD < 10% in scan)
const V2_LOW_DD = ['LDO', 'DOGE', 'ARB', 'ICP', 'COMP', 'TRX', 'XLM'];

// Ultra-low drawdown (MaxDD < 5% individually)
const ULTRA_LOW_DD = ['LDO', 'DOGE', 'ARB', 'TRX'];

// High Sharpe core (individual Sharpe > 1.0)
const HIGH_SHARPE = ['LDO', 'DOGE', 'ARB']; // 4h only, all > 1.0 Sharpe

// Funding income focus (highest funding earners)
const FUNDING_FOCUS = ['TIA', 'COMP', 'RPL', 'JTO'];

// Top 12 profitable V2 assets at best timeframe
const WIDE12 = ['LDO', 'DOGE', 'ARB', 'IMX', 'ICP', 'XLM', 'GRT', 'TIA', 'APT', 'NEAR', 'COMP', 'BCH'];

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
// All configs to explore (47 total)
// ---------------------------------------------------------------------------

const CONFIGS: ExploreConfig[] = [
  // -------------------------------------------------------------------------
  // 1-4. V2 Top 7 — allocation mode / maxPos sweep
  // -------------------------------------------------------------------------
  {
    name: 'V2 Top7 4h top_n maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(V2_TOP7, '4h'),
  },
  {
    name: 'V2 Top7 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(V2_TOP7, '4h'),
  },
  {
    name: 'V2 Top7 4h weighted_multi maxPos=5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: subs(V2_TOP7, '4h'),
  },
  {
    name: 'V2 Top7 4h single_strongest',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(V2_TOP7, '4h'),
  },

  // -------------------------------------------------------------------------
  // 5-7. V1 tops with useTrendFilter:false (recover v1 signals under v2 code)
  // -------------------------------------------------------------------------
  {
    name: 'V1 Tops noTF 4h top_n maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(V1_TOPS_NOTF, '4h', { useTrendFilter: false }),
  },
  {
    name: 'V1 Tops noTF 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(V1_TOPS_NOTF, '4h', { useTrendFilter: false }),
  },
  {
    name: 'V1 Tops noTF 4h single_strongest',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(V1_TOPS_NOTF, '4h', { useTrendFilter: false }),
  },

  // -------------------------------------------------------------------------
  // 8-10. Mixed best (v1 + v2 performers)
  // -------------------------------------------------------------------------
  {
    name: 'Mixed Best 4h top_n maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(BEST_MIXED, '4h'),
  },
  {
    name: 'Mixed Best 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(BEST_MIXED, '4h'),
  },
  {
    name: 'Mixed Best 4h weighted_multi maxPos=5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: subs(BEST_MIXED, '4h'),
  },

  // -------------------------------------------------------------------------
  // 11-12. Low-drawdown safe portfolio
  // -------------------------------------------------------------------------
  {
    name: 'Low DD Safe 4h top_n maxPos=3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: subs(LOW_DD, '4h'),
  },
  {
    name: 'Low DD Safe 4h single_strongest',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(LOW_DD, '4h'),
  },

  // -------------------------------------------------------------------------
  // 13-15. All v2-profitable (Sharpe > 0)
  // -------------------------------------------------------------------------
  {
    name: 'V2 Profitable 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(V2_PROFITABLE, '4h'),
  },
  {
    name: 'V2 Profitable 4h top_n maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subs(V2_PROFITABLE, '4h'),
  },
  {
    name: 'V2 Profitable 4h weighted_multi maxPos=5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: subs(V2_PROFITABLE, '4h'),
  },

  // -------------------------------------------------------------------------
  // 16-17. Hybrid: V1-tops (noTF) + V2-tops (defaults) mixed
  // -------------------------------------------------------------------------
  {
    name: 'Hybrid V1noTF+V2top 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: [
      // V1 tops with trend filter disabled
      ...subs(V1_TOPS_NOTF, '4h', { useTrendFilter: false }),
      // V2 tops with default params
      ...subs(['LDO', 'DOGE', 'IMX', 'GRT', 'ICP'], '4h'),
    ],
  },
  {
    name: 'Hybrid V1noTF+V2top 4h weighted_multi maxPos=5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: [
      ...subs(V1_TOPS_NOTF, '4h', { useTrendFilter: false }),
      ...subs(['LDO', 'DOGE', 'IMX', 'GRT', 'ICP'], '4h'),
    ],
  },

  // -------------------------------------------------------------------------
  // 18. V2 Top7 with wider entry percentiles
  // -------------------------------------------------------------------------
  {
    name: 'V2 Top7 4h wider entry top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(V2_TOP7, '4h', {
      shortPercentile: 90,
      longPercentile: 10,
    }),
  },

  // -------------------------------------------------------------------------
  // 19-20. Full 29-symbol v2 universe
  // -------------------------------------------------------------------------
  {
    name: 'All29 v2 4h top_n maxPos=5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: subs(ALL29, '4h'),
  },
  {
    name: 'All29 v2 4h top_n maxPos=8',
    allocationMode: 'top_n',
    maxPositions: 8,
    subStrategies: subs(ALL29, '4h'),
  },

  // -------------------------------------------------------------------------
  // 21-26. Tournament: V1 Tops vs V2 Tops vs Hybrid (Experiment 1)
  // -------------------------------------------------------------------------
  {
    name: 'V1 Tops+MANA NoTF 4h SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(['ADA', 'DOT', 'ATOM', 'ETC', 'MANA'], '4h', { useTrendFilter: false }),
  },
  {
    name: 'V1 Tops+MANA NoTF 1h SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(['ADA', 'DOT', 'ATOM', 'ETC', 'MANA'], '1h', { useTrendFilter: false }),
  },
  {
    name: 'V1 Tops MixedTF NoTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      fr('ADA', '1h', { useTrendFilter: false }),
      ...subs(['DOT', 'ATOM', 'ETC', 'MANA'], '4h', { useTrendFilter: false }),
    ],
  },
  {
    name: 'V1+V2 Hybrid MixedTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      fr('ADA', '1h', { useTrendFilter: false }),
      ...subs(['DOT', 'ATOM'], '4h', { useTrendFilter: false }),
      ...subs(['LDO', 'DOGE', 'IMX'], '4h'),
    ],
  },
  {
    name: 'Top10 Mixed TF4h SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(['ADA', 'DOT', 'ATOM', 'ETC', 'MANA'], '4h', { useTrendFilter: false }),
      ...subs(['LDO', 'DOGE', 'IMX', 'ICP', 'XLM'], '4h'),
    ],
  },
  {
    name: 'Top10 Mixed TF4h TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(['ADA', 'DOT', 'ATOM', 'ETC', 'MANA'], '4h', { useTrendFilter: false }),
      ...subs(['LDO', 'DOGE', 'IMX', 'ICP', 'XLM'], '4h'),
    ],
  },

  // -------------------------------------------------------------------------
  // 27-32. Expanded Universe with V2 Scan Discoveries (Experiment 2)
  // -------------------------------------------------------------------------
  {
    name: 'V2 Extended Top10 Mixed SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(['LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'ARB'], '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'V2 Extended Top10 Mixed TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(['LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'ARB'], '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'V2 Extended Top10 Mixed TopN5',
    allocationMode: 'top_n',
    maxPositions: 5,
    subStrategies: [
      ...subs(['LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'ARB'], '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'V2 Full16 Best-TF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(['LDO', 'DOGE', 'ARB', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'COMP', 'BCH', 'TRX', 'APT', 'TIA', 'JTO'], '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'V2 Full16 Best-TF TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(['LDO', 'DOGE', 'ARB', 'IMX', 'ICP', 'XLM', 'GRT', 'NEAR', 'COMP', 'BCH', 'TRX', 'APT', 'TIA', 'JTO'], '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'V2 LowDD Focus SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(['LDO', 'DOGE', 'ARB', 'ICP', 'COMP', 'TRX', 'XLM'], '4h'),
  },

  // -------------------------------------------------------------------------
  // 33-47. New Experiments (Ultra-LowDD, HighSharpe, FundingFocus, Wide)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 33-35. Ultra-Low DD Portfolio (individual MaxDD < 5%)
  // -------------------------------------------------------------------------
  {
    name: 'UltraLowDD 4-asset SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs(ULTRA_LOW_DD, '4h'),
  },
  {
    name: 'UltraLowDD 4-asset TopN2',
    allocationMode: 'top_n',
    maxPositions: 2,
    subStrategies: subs(ULTRA_LOW_DD, '4h'),
  },
  {
    name: 'UltraLowDD+ICP 5-asset SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: subs([...ULTRA_LOW_DD, 'ICP'], '4h'),
  },

  // -------------------------------------------------------------------------
  // 36-38. High Sharpe Core + RPL/ENS (mixed TF)
  // -------------------------------------------------------------------------
  {
    name: 'HighSharpe5 MixedTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(HIGH_SHARPE, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'HighSharpe5 MixedTF TopN2',
    allocationMode: 'top_n',
    maxPositions: 2,
    subStrategies: [
      ...subs(HIGH_SHARPE, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'HighSharpe5 MixedTF TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(HIGH_SHARPE, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },

  // -------------------------------------------------------------------------
  // 39-40. LowDD + RPL/ENS Mixed (expanded LowDD with discoveries)
  // -------------------------------------------------------------------------
  {
    name: 'LowDD+Disc MixedTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(V2_LOW_DD, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'LowDD+Disc MixedTF TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(V2_LOW_DD, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },

  // -------------------------------------------------------------------------
  // 41-42. Funding Income Focus
  // -------------------------------------------------------------------------
  {
    name: 'FundingFocus MixedTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      fr('TIA', '4h'),
      fr('COMP', '4h'),
      fr('JTO', '4h'),
      fr('LDO', '4h'),
      fr('RPL', '1h'),
      fr('PYTH', '1h'),
    ],
  },
  {
    name: 'FundingFocus MixedTF TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      fr('TIA', '4h'),
      fr('COMP', '4h'),
      fr('JTO', '4h'),
      fr('LDO', '4h'),
      fr('RPL', '1h'),
      fr('PYTH', '1h'),
    ],
  },

  // -------------------------------------------------------------------------
  // 43-44. Compact Elite (2-3 assets)
  // -------------------------------------------------------------------------
  {
    name: 'LDO+DOGE Duo SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [fr('LDO', '4h'), fr('DOGE', '4h')],
  },
  {
    name: 'LDO+ARB+DOGE Trio SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [fr('LDO', '4h'), fr('ARB', '4h'), fr('DOGE', '4h')],
  },

  // -------------------------------------------------------------------------
  // 45-47. Wide Diversified (12 assets at best TF)
  // -------------------------------------------------------------------------
  {
    name: 'Wide12 MixedTF SS',
    allocationMode: 'single_strongest',
    maxPositions: 1,
    subStrategies: [
      ...subs(WIDE12, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'Wide12 MixedTF TopN3',
    allocationMode: 'top_n',
    maxPositions: 3,
    subStrategies: [
      ...subs(WIDE12, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
  },
  {
    name: 'Wide12 MixedTF Weighted5',
    allocationMode: 'weighted_multi',
    maxPositions: 5,
    subStrategies: [
      ...subs(WIDE12, '4h'),
      fr('RPL', '1h'),
      fr('ENS', '1h'),
    ],
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

  console.log('=== EXPLORE FR V2 AGGREGATIONS ===');
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
