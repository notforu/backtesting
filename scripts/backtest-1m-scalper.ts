#!/usr/bin/env node
/**
 * Generic 1m scalper backtest runner
 * Usage:
 *   npx tsx scripts/backtest-1m-scalper.ts --strategy=bb-rsi-scalper --symbol=DOGE/USDT:USDT --from=2025-09-01 --to=2026-03-01
 *   npx tsx scripts/backtest-1m-scalper.ts --strategy=fr-epoch-scalper --symbol=BTC/USDT:USDT --from=2025-01-01 --to=2026-03-01 --leverage=5
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

  const strategyName = parsed['strategy'] || 'bb-rsi-scalper';
  const symbol = parsed['symbol'] || 'DOGE/USDT:USDT';
  const from = parsed['from'] || '2025-09-01';
  const to = parsed['to'] || '2026-03-01';
  const exchange = parsed['exchange'] || 'bybit';
  const leverage = parseInt(parsed['leverage'] || '3', 10);
  const capital = parseFloat(parsed['capital'] || '10000');
  const timeframe = parsed['timeframe'] || '1m';
  const mode = (parsed['mode'] || 'futures') as 'spot' | 'futures';

  const paramOverrides: Record<string, number | string | boolean> = {};
  const knownArgs = ['strategy', 'symbol', 'from', 'to', 'exchange', 'leverage', 'capital', 'timeframe', 'mode'];
  for (const [key, val] of Object.entries(parsed)) {
    if (!knownArgs.includes(key)) {
      if (val === 'true') paramOverrides[key] = true;
      else if (val === 'false') paramOverrides[key] = false;
      else if (!isNaN(Number(val))) paramOverrides[key] = Number(val);
      else paramOverrides[key] = val;
    }
  }

  return { strategyName, symbol, from: new Date(from), to: new Date(to), exchange, leverage, capital, timeframe, mode, paramOverrides };
}

async function main() {
  await initDb();
  const { strategyName, symbol, from, to, exchange, leverage, capital, timeframe, mode, paramOverrides } = parseArgs();

  const short = symbol.replace('/USDT:USDT', '');
  console.log(`[${strategyName}] ${short} ${timeframe} | ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} | ${leverage}x | $${capital}`);
  if (Object.keys(paramOverrides).length > 0) {
    console.log(`  Params: ${JSON.stringify(paramOverrides)}`);
  }

  const config: BacktestConfig = {
    id: uuidv4(),
    strategyName,
    symbol,
    exchange,
    timeframe: timeframe as any,
    startDate: from.getTime(),
    endDate: to.getTime(),
    initialCapital: capital,
    mode,
    leverage,
    params: {
      leverage,
      ...paramOverrides,
    },
  };

  const strategy = await loadStrategy(strategyName);
  const startTime = Date.now();
  const result = await runBacktest(config, {
    enableLogging: false,
    preloadedStrategy: strategy,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const m = result.metrics;
  const finalEq = result.equity.length > 0 ? result.equity[result.equity.length - 1].equity : capital;
  const days = (to.getTime() - from.getTime()) / 86400000;

  console.log(`  Return: ${m.totalReturnPercent.toFixed(2)}% | Sharpe: ${m.sharpeRatio.toFixed(3)} | Sortino: ${m.sortinoRatio.toFixed(3)}`);
  console.log(`  MaxDD: ${m.maxDrawdownPercent.toFixed(2)}% | WinRate: ${m.winRate.toFixed(1)}% | PF: ${m.profitFactor.toFixed(3)}`);
  console.log(`  Trades: ${m.totalTrades} (${(m.totalTrades / days).toFixed(1)}/day) | Fees: $${m.totalFees.toFixed(2)} | Equity: $${finalEq.toFixed(2)}`);
  console.log(`  Time: ${elapsed}s`);

  try {
    await saveBacktestRun(result);
    console.log(`  Saved to DB ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key')) {
      console.log(`  Already in DB (duplicate key)`);
    } else {
      console.error(`  DB save error: ${msg}`);
    }
  }

  await closeDb();
}

main().catch(e => { console.error(e); process.exit(1); });
