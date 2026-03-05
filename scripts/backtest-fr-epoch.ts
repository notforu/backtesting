#!/usr/bin/env node
/**
 * Backtest FR Epoch Scalper (1m scalping strategy)
 *
 * Usage:
 *   npx tsx scripts/backtest-fr-epoch.ts --symbol=DOGE/USDT:USDT --from=2025-09-01 --to=2026-03-01
 *   npx tsx scripts/backtest-fr-epoch.ts --symbol=BTC/USDT:USDT --from=2025-01-01 --to=2026-03-01 --leverage=5
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import { runBacktest } from '../src/core/engine.js';
import { loadStrategy } from '../src/strategy/loader.js';
import { initDb, closeDb, saveBacktestRun } from '../src/data/db.js';
import { v4 as uuidv4 } from 'uuid';
import type { BacktestConfig } from '../src/core/types.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) parsed[match[1]] = match[2];
  }

  const symbol = parsed['symbol'] || 'DOGE/USDT:USDT';
  const from = parsed['from'] || '2025-09-01';
  const to = parsed['to'] || '2026-03-01';
  const exchange = parsed['exchange'] || 'bybit';
  const leverage = parseInt(parsed['leverage'] || '3', 10);
  const capital = parseFloat(parsed['capital'] || '10000');
  const timeframe = parsed['timeframe'] || '1m';

  const paramOverrides: Record<string, number | string | boolean> = {};
  const knownArgs = ['symbol', 'from', 'to', 'exchange', 'leverage', 'capital', 'timeframe'];
  for (const [key, val] of Object.entries(parsed)) {
    if (!knownArgs.includes(key)) {
      if (val === 'true') paramOverrides[key] = true;
      else if (val === 'false') paramOverrides[key] = false;
      else if (!isNaN(Number(val))) paramOverrides[key] = Number(val);
      else paramOverrides[key] = val;
    }
  }

  return { symbol, from: new Date(from), to: new Date(to), exchange, leverage, capital, timeframe, paramOverrides };
}

async function main() {
  await initDb();
  const { symbol, from, to, exchange, leverage, capital, timeframe, paramOverrides } = parseArgs();

  const short = symbol.replace('/USDT:USDT', '');
  console.log('='.repeat(70));
  console.log('  FR Epoch Scalper - 1m Scalping Backtest');
  console.log('='.repeat(70));
  console.log(`  Symbol    : ${symbol}`);
  console.log(`  Exchange  : ${exchange}`);
  console.log(`  Timeframe : ${timeframe}`);
  console.log(`  Period    : ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`);
  console.log(`  Capital   : $${capital.toLocaleString()}`);
  console.log(`  Leverage  : ${leverage}x`);
  if (Object.keys(paramOverrides).length > 0) {
    console.log(`  Overrides : ${JSON.stringify(paramOverrides)}`);
  }
  console.log('='.repeat(70));

  const config: BacktestConfig = {
    id: uuidv4(),
    strategyName: 'fr-epoch-scalper',
    symbol,
    exchange,
    timeframe: timeframe as any,
    startDate: from.getTime(),
    endDate: to.getTime(),
    initialCapital: capital,
    mode: 'futures',
    leverage,
    params: {
      leverage,
      ...paramOverrides,
    },
  };

  console.log('\nRunning backtest...');
  const startTime = Date.now();

  const strategy = await loadStrategy('fr-epoch-scalper');
  const result = await runBacktest(config, {
    enableLogging: false, // 1m data = too many bars for verbose logging
    preloadedStrategy: strategy,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const m = result.metrics;

  console.log('\n' + '='.repeat(70));
  console.log(`  RESULTS — ${short} (${timeframe})`);
  console.log('='.repeat(70));
  console.log(`  Total Return  : ${m.totalReturnPercent.toFixed(2)}%`);
  console.log(`  Sharpe Ratio  : ${m.sharpeRatio.toFixed(3)}`);
  console.log(`  Sortino Ratio : ${m.sortinoRatio.toFixed(3)}`);
  console.log(`  Max Drawdown  : ${m.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`  Win Rate      : ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Total Trades  : ${m.totalTrades}`);
  console.log(`  Profit Factor : ${m.profitFactor.toFixed(3)}`);
  console.log(`  Avg Trade Dur : ${m.avgTradeDuration.toFixed(0)} bars`);
  const finalEq = result.equity.length > 0 ? result.equity[result.equity.length - 1].equity : capital;
  console.log(`  Final Equity  : $${finalEq.toFixed(2)}`);
  console.log(`  Elapsed       : ${elapsed}s`);
  console.log('='.repeat(70));

  // Trades per day
  const days = (to.getTime() - from.getTime()) / (86400000);
  console.log(`  Trades/day    : ${(m.totalTrades / days).toFixed(1)}`);

  console.log('\nSaving to database...');
  await saveBacktestRun(result);
  console.log('Saved!');

  await closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
