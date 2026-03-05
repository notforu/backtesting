#!/usr/bin/env node
/**
 * Backtest OI-Delta Regime Scalper strategy
 * Pre-loads OI + LSR data from DB and injects into strategy before engine runs.
 *
 * Usage:
 *   npx tsx scripts/backtest-oi-delta.ts --symbol=DOGE/USDT:USDT --from=2024-06-01 --to=2025-03-01
 *   npx tsx scripts/backtest-oi-delta.ts --symbol=SOL/USDT:USDT --from=2024-06-01 --to=2025-03-01 --leverage=5
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import { runBacktest } from '../src/core/engine.js';
import { loadStrategy } from '../src/strategy/loader.js';
import { getOpenInterest, getLongShortRatio, initDb, closeDb, saveBacktestRun } from '../src/data/db.js';
import type { BacktestConfig } from '../src/core/types.js';
import { v4 as uuidv4 } from 'uuid';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) parsed[match[1]] = match[2];
  }

  const symbol = parsed['symbol'] || 'DOGE/USDT:USDT';
  const from = parsed['from'] || '2024-06-01';
  const to = parsed['to'] || '2025-03-01';
  const exchange = parsed['exchange'] || 'bybit';
  const leverage = parseInt(parsed['leverage'] || '3', 10);
  const capital = parseFloat(parsed['capital'] || '10000');
  const timeframe = parsed['timeframe'] || '15m';

  // Parse optional strategy param overrides
  const paramOverrides: Record<string, number | string | boolean> = {};
  const knownArgs = ['symbol', 'from', 'to', 'exchange', 'leverage', 'capital', 'timeframe'];
  for (const [key, val] of Object.entries(parsed)) {
    if (!knownArgs.includes(key)) {
      // Try to parse as number, then boolean, else string
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

  console.log('='.repeat(70));
  console.log('  OI-Delta Regime Scalper - Backtest');
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
  console.log('');

  // 1. Pre-load OI data
  console.log('Pre-loading OI data...');
  const oiRecords = await getOpenInterest(exchange, symbol, from.getTime(), to.getTime());
  console.log(`  Loaded ${oiRecords.length} OI records`);

  // 2. Pre-load LSR data
  console.log('Pre-loading LSR data...');
  const lsrRecords = await getLongShortRatio(exchange, symbol, from.getTime(), to.getTime());
  console.log(`  Loaded ${lsrRecords.length} LSR records`);

  if (oiRecords.length === 0) {
    console.error('\nERROR: No OI data found! Run cache-oi-data.ts first.');
    console.error(`  npx tsx scripts/cache-oi-data.ts --exchange=${exchange} --symbols=${symbol} --from=${from.toISOString().slice(0,10)} --to=${to.toISOString().slice(0,10)} --timeframe=5m --type=oi`);
    process.exit(1);
  }

  // 3. Load strategy and inject data
  console.log('Loading strategy...');
  const strategy = await loadStrategy('oi-delta-regime-scalper');

  // Wrap init to inject OI/LSR data after normal init
  const originalInit = strategy.init?.bind(strategy);
  strategy.init = function(context) {
    if (originalInit) originalInit(context);
    // Inject pre-loaded data into strategy state
    const self = this as any;
    self._oiRecords = oiRecords;
    self._lsrRecords = lsrRecords;
    self._initialized = true;
    context.log(`Injected ${oiRecords.length} OI records and ${lsrRecords.length} LSR records`);
  };

  // 4. Build backtest config
  const config: BacktestConfig = {
    id: uuidv4(),
    strategyName: 'oi-delta-regime-scalper',
    symbol,
    exchange,
    timeframe: timeframe as any,
    startDate: from.getTime(),
    endDate: to.getTime(),
    initialCapital: capital,
    mode: 'futures',
    leverage,
    params: {
      exchange,
      leverage,
      ...paramOverrides,
    },
  };

  // 5. Run backtest
  console.log('\nRunning backtest...\n');
  const startTime = Date.now();
  const result = await runBacktest(config, {
    enableLogging: true,
    preloadedStrategy: strategy,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 6. Print results
  console.log('\n' + '='.repeat(70));
  console.log('  RESULTS');
  console.log('='.repeat(70));
  const m = result.metrics;
  const finalEq = result.equity.length > 0 ? result.equity[result.equity.length - 1].equity : capital;
  console.log(`  Total Return  : ${m.totalReturnPercent.toFixed(2)}%`);
  console.log(`  Sharpe Ratio  : ${m.sharpeRatio.toFixed(3)}`);
  console.log(`  Sortino Ratio : ${m.sortinoRatio.toFixed(3)}`);
  console.log(`  Max Drawdown  : ${m.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`  Win Rate      : ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Total Trades  : ${m.totalTrades}`);
  console.log(`  Profit Factor : ${m.profitFactor.toFixed(3)}`);
  console.log(`  Avg Trade Dur : ${m.avgTradeDuration.toFixed(0)} bars`);
  console.log(`  Final Equity  : $${finalEq.toFixed(2)}`);
  console.log(`  Elapsed       : ${elapsed}s`);
  console.log('='.repeat(70));

  // 7. Save to DB
  console.log('\nSaving to database...');
  await saveBacktestRun(result);
  console.log('Saved!');

  await closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
