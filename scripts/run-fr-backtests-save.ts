#!/usr/bin/env node
/**
 * Run funding-rate-spike backtests for ATOM and DOT (4h, Bybit)
 * and persist results to the database so they appear in the dashboard.
 *
 * Usage:
 *   DATABASE_URL=postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting \
 *     npx tsx scripts/run-fr-backtests-save.ts
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { initDb, closeDb } from '../src/data/db.js';

const START_DATE = new Date('2024-01-01').getTime();
const END_DATE = new Date('2026-01-01').getTime();

const TARGETS = [
  { symbol: 'ATOM/USDT:USDT', label: 'ATOM' },
  { symbol: 'DOT/USDT:USDT', label: 'DOT' },
];

async function main(): Promise<void> {
  console.log('Initializing database connection...');
  await initDb();

  for (const { symbol, label } of TARGETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running backtest: ${label} (${symbol}) 4h`);
    console.log('='.repeat(60));

    const config = createBacktestConfig({
      strategyName: 'funding-rate-spike',
      symbol,
      timeframe: '4h',
      startDate: START_DATE,
      endDate: END_DATE,
      initialCapital: 10000,
      exchange: 'bybit',
      mode: 'futures',
      params: {}, // Use strategy defaults — defaults work best per research
    });

    const result = await runBacktest(config, {
      saveResults: true,
      enableLogging: false,
    });

    const { metrics } = result;
    const fundingIncome = (metrics as Record<string, unknown>).totalFundingIncome as number | undefined;

    console.log(`\nResults for ${label}:`);
    console.log(`  Backtest ID   : ${result.id}`);
    console.log(`  Sharpe Ratio  : ${metrics.sharpeRatio.toFixed(3)}`);
    console.log(`  Total Return  : ${metrics.totalReturnPercent.toFixed(2)}%`);
    console.log(`  Trade Count   : ${result.trades.length}`);
    if (fundingIncome !== undefined) {
      console.log(`  Funding Income: $${fundingIncome.toFixed(2)}`);
    }
    console.log(`  Max Drawdown  : ${metrics.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`  Win Rate      : ${(metrics.winRate * 100).toFixed(1)}%`);
  }

  console.log('\nClosing database connection...');
  await closeDb();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
