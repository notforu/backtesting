/**
 * V3 Aggregation Comparison Script
 *
 * Creates 3 FR V3 aggregation configs in the DB and runs backtests,
 * comparing results side-by-side against the V2 benchmark.
 *
 * Usage:
 *   npx tsx scripts/run-v3-aggregation-comparison.ts
 */

import { randomUUID } from 'crypto';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import { initDb, closeDb, saveAggregationConfig, saveBacktestRun } from '../src/data/db.js';
import type { AggregationConfig } from '../src/data/db.js';
import type { AggregateBacktestResult, SubStrategyConfig } from '../src/core/signal-types.js';
import type { Timeframe } from '../src/core/types.js';

const START_DATE = new Date('2024-01-01').getTime();
const END_DATE = new Date('2026-03-01').getTime();

// ============================================================================
// Sub-strategy definitions (typed with Timeframe for the engine)
// ============================================================================

const TF = '4h' as Timeframe;

const qualityCoreSubStrategies: SubStrategyConfig[] = [
  { strategyName: 'funding-rate-spike-v3', symbol: 'ZEC/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'LDO/USDT:USDT', timeframe: TF, params: { holdingPeriods: 4, shortPercentile: 96, longPercentile: 2, atrStopMultiplier: 3.5, atrTPMultiplier: 3.5 }, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'XLM/USDT:USDT', timeframe: TF, params: { holdingPeriods: 6, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 3, atrTPMultiplier: 5 }, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'TRB/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
];

const diversified7SubStrategies: SubStrategyConfig[] = [
  { strategyName: 'funding-rate-spike-v3', symbol: 'ZEC/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'LDO/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'TRB/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'XLM/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'IOST/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'NEAR/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'STG/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
];

const hybridTieredSubStrategies: SubStrategyConfig[] = [
  { strategyName: 'funding-rate-spike-v3', symbol: 'ZEC/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'LDO/USDT:USDT', timeframe: TF, params: { holdingPeriods: 4, shortPercentile: 96, longPercentile: 2, atrStopMultiplier: 3.5, atrTPMultiplier: 3.5 }, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'XLM/USDT:USDT', timeframe: TF, params: { holdingPeriods: 6, shortPercentile: 94, longPercentile: 10, atrStopMultiplier: 3, atrTPMultiplier: 5 }, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'TRB/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'IOST/USDT:USDT', timeframe: TF, params: {}, exchange: 'bybit' },
  { strategyName: 'funding-rate-spike-v3', symbol: 'NEAR/USDT:USDT', timeframe: TF, params: { holdingPeriods: 3, shortPercentile: 96, longPercentile: 6, atrStopMultiplier: 3, atrTPMultiplier: 2.5 }, exchange: 'bybit' },
];

// ============================================================================
// Config definitions (for DB storage via AggregationConfig)
// ============================================================================

interface RunConfig {
  dbConfig: AggregationConfig;
  subStrategies: SubStrategyConfig[];
}

function makeRunConfigs(): RunConfig[] {
  const now = Date.now();
  return [
    {
      dbConfig: {
        id: randomUUID(),
        name: 'FR V3 Quality Core',
        allocationMode: 'single_strongest',
        maxPositions: 1,
        subStrategies: qualityCoreSubStrategies,
        subStrategyConfigIds: [],
        initialCapital: 10000,
        exchange: 'bybit',
        mode: 'futures',
        createdAt: now,
        updatedAt: now,
      },
      subStrategies: qualityCoreSubStrategies,
    },
    {
      dbConfig: {
        id: randomUUID(),
        name: 'FR V3 Diversified 7',
        allocationMode: 'top_n',
        maxPositions: 3,
        subStrategies: diversified7SubStrategies,
        subStrategyConfigIds: [],
        initialCapital: 10000,
        exchange: 'bybit',
        mode: 'futures',
        createdAt: now,
        updatedAt: now,
      },
      subStrategies: diversified7SubStrategies,
    },
    {
      dbConfig: {
        id: randomUUID(),
        name: 'FR V3 Hybrid Tiered',
        allocationMode: 'weighted_multi',
        maxPositions: 3,
        subStrategies: hybridTieredSubStrategies,
        subStrategyConfigIds: [],
        initialCapital: 10000,
        exchange: 'bybit',
        mode: 'futures',
        createdAt: now,
        updatedAt: now,
      },
      subStrategies: hybridTieredSubStrategies,
    },
  ];
}

// Short labels for the comparison table
const configLabels: Record<string, string> = {
  'FR V3 Quality Core': 'Quality Core (SS)',
  'FR V3 Diversified 7': 'Diversified 7 (TN)',
  'FR V3 Hybrid Tiered': 'Hybrid Tiered (WM)',
};

// ============================================================================
// Helpers
// ============================================================================

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function printComparisonTable(results: Array<{ config: AggregationConfig; result: AggregateBacktestResult }>): void {
  console.log('\n================================================================');
  console.log('  V3 AGGREGATION COMPARISON');
  console.log('================================================================');
  console.log(
    pad('Config', 22) +
    pad('Sharpe', 8) +
    pad('Return%', 9) +
    pad('MaxDD%', 8) +
    pad('Trades', 8) +
    pad('WinRate', 9) +
    'PF',
  );
  console.log('----------------------------------------------------------------');

  for (const { config, result } of results) {
    const m = result.metrics;
    const label = configLabels[config.name] ?? config.name;
    const winRate = m.winRate ?? 0;
    const pf = m.profitFactor ?? 0;
    console.log(
      pad(label, 22) +
      pad(fmt(m.sharpeRatio), 8) +
      pad(fmt(m.totalReturnPercent) + '%', 9) +
      pad(fmt(m.maxDrawdownPercent) + '%', 8) +
      pad(String(m.totalTrades), 8) +
      pad(fmt(winRate) + '%', 9) +
      fmt(pf),
    );
  }

  console.log('================================================================');
  console.log(
    pad('V2 Benchmark (SS)', 22) +
    pad('1.88', 8) +
    pad('223.8%', 9) +
    pad('13.3%', 8) +
    pad('~140', 8) +
    pad('??', 9) +
    '??',
  );
  console.log('================================================================\n');
}

function printPerAssetBreakdown(config: AggregationConfig, result: AggregateBacktestResult): void {
  const label = configLabels[config.name] ?? config.name;
  console.log(`--- ${label} per-asset ---`);
  console.log(
    pad('Symbol', 14) +
    pad('Sharpe', 8) +
    pad('Return%', 9) +
    pad('Trades', 8) +
    pad('FundingIncome', 15) +
    'TradingPnL',
  );
  console.log('-'.repeat(72));

  for (const [symbol, assetResult] of Object.entries(result.perAssetResults)) {
    const m = assetResult.metrics;
    // Strip the :USDT suffix for cleaner display
    const shortSym = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    console.log(
      pad(shortSym, 14) +
      pad(fmt(m.sharpeRatio), 8) +
      pad(fmt(m.totalReturnPercent) + '%', 9) +
      pad(String(m.totalTrades), 8) +
      pad('$' + fmt(assetResult.fundingIncome), 15) +
      '$' + fmt(assetResult.tradingPnl),
    );
  }
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Initializing database...');
  await initDb();

  const runConfigs = makeRunConfigs();
  const results: Array<{ config: AggregationConfig; result: AggregateBacktestResult }> = [];

  for (const { dbConfig, subStrategies } of runConfigs) {
    console.log(`\n========================================`);
    console.log(`Running: ${dbConfig.name}`);
    console.log(`  Mode: ${dbConfig.allocationMode}, maxPositions: ${dbConfig.maxPositions}`);
    console.log(`  Symbols: ${subStrategies.map(s => s.symbol).join(', ')}`);
    console.log(`  Period: 2024-01-01 to 2026-03-01`);
    console.log(`========================================`);

    // 1. Save config to DB
    await saveAggregationConfig(dbConfig);
    console.log(`Saved aggregation config: ${dbConfig.id}`);

    // 2. Run the backtest
    const result = await runAggregateBacktest(
      {
        subStrategies,
        allocationMode: dbConfig.allocationMode as 'single_strongest' | 'top_n' | 'weighted_multi',
        maxPositions: dbConfig.maxPositions,
        initialCapital: dbConfig.initialCapital,
        startDate: START_DATE,
        endDate: END_DATE,
        exchange: dbConfig.exchange,
        mode: dbConfig.mode as 'spot' | 'futures',
      },
      {
        enableLogging: true,
        saveResults: false, // We save manually below with aggregationId
        skipFundingRateValidation: false,
        skipCandleValidation: false,
      },
    );

    // 3. Save result to DB linked to this aggregation config
    await saveBacktestRun(result, dbConfig.id);
    console.log(`Saved backtest run: ${result.id}`);

    results.push({ config: dbConfig, result });
  }

  // 4. Print comparison table
  printComparisonTable(results);

  // 5. Print per-asset breakdowns
  for (const { config, result } of results) {
    printPerAssetBreakdown(config, result);
  }

  await closeDb();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
