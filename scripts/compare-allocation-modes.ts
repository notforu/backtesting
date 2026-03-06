#!/usr/bin/env node
/**
 * Compare top_n vs single_strongest allocation modes for FR V2
 *
 * Symbols: LDO, DOGE, IMX, ICP, XLM, NEAR (4h, Bybit)
 * Period: 2024-01-01 to 2026-01-01
 * Capital: $10,000
 *
 * Config A: single_strongest, maxPositions=1 (baseline)
 * Config B: top_n,            maxPositions=2
 * Config C: top_n,            maxPositions=3
 */

import { saveBacktestRun, closeDb, initDb } from '../src/data/db.js';
import { runAggregateBacktest } from '../src/core/aggregate-engine.js';
import type { AggregateBacktestConfig, SubStrategyConfig } from '../src/core/signal-types.js';

const SYMBOLS = ['LDO', 'DOGE', 'IMX', 'ICP', 'XLM', 'NEAR'];

function makeSubStrategies(): SubStrategyConfig[] {
  return SYMBOLS.map((s) => ({
    strategyName: 'funding-rate-spike-v2',
    symbol: `${s}/USDT:USDT`,
    timeframe: '4h' as const,
    params: {},
    exchange: 'bybit',
  }));
}

interface RunConfig {
  name: string;
  allocationMode: 'single_strongest' | 'top_n';
  maxPositions: number;
}

const CONFIGS: RunConfig[] = [
  { name: 'Config A — single_strongest maxPos=1', allocationMode: 'single_strongest', maxPositions: 1 },
  { name: 'Config B — top_n            maxPos=2', allocationMode: 'top_n',            maxPositions: 2 },
  { name: 'Config C — top_n            maxPos=3', allocationMode: 'top_n',            maxPositions: 3 },
];

const FROM = '2024-01-01';
const TO   = '2026-01-01';
const CAPITAL = 10_000;

async function main(): Promise<void> {
  await initDb();

  const startDate = new Date(FROM).getTime();
  const endDate   = new Date(TO).getTime();

  console.log('=== FR V2 Allocation Mode Comparison ===');
  console.log(`Symbols  : ${SYMBOLS.join(', ')}`);
  console.log(`Timeframe: 4h`);
  console.log(`Period   : ${FROM} → ${TO}`);
  console.log(`Capital  : $${CAPITAL.toLocaleString()}`);
  console.log('');

  type Row = {
    name: string;
    trades: number;
    returnPct: number;
    sharpe: number;
    maxDD: number;
    pf: number;
    avgTradesPerMonth: number;
  };

  const rows: Row[] = [];

  for (const cfg of CONFIGS) {
    console.log(`Running ${cfg.name} ...`);

    const aggConfig: AggregateBacktestConfig = {
      subStrategies: makeSubStrategies(),
      allocationMode: cfg.allocationMode,
      maxPositions: cfg.maxPositions,
      initialCapital: CAPITAL,
      startDate,
      endDate,
      exchange: 'bybit',
      mode: 'futures',
    };

    const t0 = Date.now();
    const result = await runAggregateBacktest(aggConfig, { saveResults: false, enableLogging: false });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    await saveBacktestRun(result);

    const m = result.metrics;
    const months = (endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44);
    const avgTradesPerMonth = m.totalTrades / months;

    console.log(
      `  Done in ${elapsed}s` +
      ` | Trades ${m.totalTrades}` +
      ` | Return ${m.totalReturnPercent.toFixed(2)}%` +
      ` | Sharpe ${m.sharpeRatio.toFixed(3)}` +
      ` | MaxDD ${m.maxDrawdownPercent.toFixed(2)}%` +
      ` | PF ${m.profitFactor.toFixed(3)}` +
      ` | Avg ${avgTradesPerMonth.toFixed(1)}/mo`,
    );

    rows.push({
      name: cfg.name,
      trades: m.totalTrades,
      returnPct: m.totalReturnPercent,
      sharpe: m.sharpeRatio,
      maxDD: m.maxDrawdownPercent,
      pf: m.profitFactor,
      avgTradesPerMonth,
    });
  }

  // Summary table
  const W = 130;
  console.log('');
  console.log('='.repeat(W));
  console.log('SUMMARY');
  console.log('='.repeat(W));
  const hdr = [
    'Config'.padEnd(40),
    'Trades'.padStart(7),
    'Return%'.padStart(9),
    'Sharpe'.padStart(8),
    'MaxDD%'.padStart(8),
    'ProfitFactor'.padStart(13),
    'Trades/Mo'.padStart(11),
  ].join('  ');
  console.log(hdr);
  console.log('-'.repeat(W));
  for (const r of rows) {
    const line = [
      r.name.padEnd(40),
      String(r.trades).padStart(7),
      r.returnPct.toFixed(2).padStart(9),
      r.sharpe.toFixed(3).padStart(8),
      r.maxDD.toFixed(2).padStart(8),
      r.pf.toFixed(3).padStart(13),
      r.avgTradesPerMonth.toFixed(1).padStart(11),
    ].join('  ');
    console.log(line);
  }
  console.log('='.repeat(W));

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal:', err);
  closeDb().catch(() => {});
  process.exit(1);
});
