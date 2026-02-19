#!/usr/bin/env node
/**
 * Batch backtest: funding-rate-spike across multiple assets and timeframes
 *
 * Usage: npx tsx scripts/batch-fr-backtest.ts [--from=2024-01-01] [--to=2025-01-01] [--capital=2000]
 *
 * Runs backtests for all configured symbols at 15m, 1h, 4h timeframes.
 * Outputs a markdown summary table sorted by Sharpe ratio.
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb } from '../src/data/db.js';
import type { Timeframe, PerformanceMetrics } from '../src/core/types.js';

const SYMBOLS = [
  'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT',
  'XRP/USDT:USDT', 'DOGE/USDT:USDT', 'ADA/USDT:USDT',
  'AVAX/USDT:USDT', 'LINK/USDT:USDT', 'DOT/USDT:USDT',
  'NEAR/USDT:USDT', 'ARB/USDT:USDT', 'OP/USDT:USDT',
  'APT/USDT:USDT', 'SUI/USDT:USDT', 'WIF/USDT:USDT',
  'INJ/USDT:USDT', 'ATOM/USDT:USDT', 'FIL/USDT:USDT',
  'LTC/USDT:USDT', 'TIA/USDT:USDT', 'SEI/USDT:USDT',
  'WLD/USDT:USDT', 'ORDI/USDT:USDT', 'JUP/USDT:USDT',
  'AAVE/USDT:USDT', 'UNI/USDT:USDT',
];

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h'];

interface BacktestRow {
  symbol: string;
  timeframe: string;
  returnPct: number;
  sharpe: number;
  sortino: number;
  winRate: number;
  trades: number;
  maxDD: number;
  fundingIncome: number;
  tradingPnl: number;
  profitFactor: number;
  error?: string;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key && value) result[key] = value;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from ?? '2024-01-01';
  const to = args.to ?? '2025-01-01';
  const capital = Number(args.capital ?? '2000');
  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();

  const total = SYMBOLS.length * TIMEFRAMES.length;
  console.log(`Batch FR Backtest: ${SYMBOLS.length} symbols x ${TIMEFRAMES.length} timeframes = ${total} runs`);
  console.log(`Period: ${from} to ${to}, Capital: $${capital}`);
  console.log('');

  const results: BacktestRow[] = [];
  let completed = 0;

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      completed++;
      const label = `[${completed}/${total}] ${symbol} @ ${timeframe}`;

      try {
        const config = createBacktestConfig({
          strategyName: 'funding-rate-spike',
          symbol,
          timeframe,
          startDate,
          endDate,
          initialCapital: capital,
          exchange: 'bybit',
          params: {},
          mode: 'futures',
        });

        const result = await runBacktest(config, {
          enableLogging: false,
          saveResults: false,
          skipFeeFetch: true,
          broker: {
            feeRate: 0.00055, // Bybit taker fee
            slippagePercent: 0,
          },
        });

        const m: PerformanceMetrics = result.metrics;
        const row: BacktestRow = {
          symbol: symbol.replace('/USDT:USDT', ''),
          timeframe,
          returnPct: m.totalReturnPercent,
          sharpe: m.sharpeRatio,
          sortino: m.sortinoRatio,
          winRate: m.winRate,
          trades: m.totalTrades,
          maxDD: m.maxDrawdownPercent,
          fundingIncome: (m as any).totalFundingIncome ?? 0,
          tradingPnl: (m as any).tradingPnl ?? 0,
          profitFactor: m.profitFactor,
        };
        results.push(row);

        const sharpeStr =
          m.sharpeRatio >= 0
            ? `+${m.sharpeRatio.toFixed(2)}`
            : m.sharpeRatio.toFixed(2);
        console.log(
          `${label} -> Sharpe ${sharpeStr}, Return ${m.totalReturnPercent.toFixed(1)}%, Trades ${m.totalTrades}, Funding $${((m as any).totalFundingIncome ?? 0).toFixed(1)}`
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.log(`${label} -> ERROR: ${msg}`);
        results.push({
          symbol: symbol.replace('/USDT:USDT', ''),
          timeframe,
          returnPct: 0,
          sharpe: 0,
          sortino: 0,
          winRate: 0,
          trades: 0,
          maxDD: 0,
          fundingIncome: 0,
          tradingPnl: 0,
          profitFactor: 0,
          error: msg,
        });
      }
    }
  }

  // Sort by Sharpe ratio descending, errors excluded
  const sorted = results.filter((r) => !r.error).sort((a, b) => b.sharpe - a.sharpe);
  const errors = results.filter((r) => r.error);

  // Print markdown table
  console.log('\n\n=== RESULTS TABLE (sorted by Sharpe) ===\n');
  console.log(
    '| Rank | Symbol | TF | Return % | Sharpe | Sortino | WinRate % | Trades | MaxDD % | Funding $ | TradePnL $ | PF |'
  );
  console.log(
    '|------|--------|----|----------|--------|---------|-----------|--------|---------|-----------|------------|-----|'
  );

  sorted.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.symbol} | ${r.timeframe} | ${r.returnPct.toFixed(1)} | ${r.sharpe.toFixed(2)} | ${r.sortino.toFixed(2)} | ${r.winRate.toFixed(1)} | ${r.trades} | ${r.maxDD.toFixed(1)} | ${r.fundingIncome.toFixed(1)} | ${r.tradingPnl.toFixed(1)} | ${r.profitFactor.toFixed(2)} |`
    );
  });

  if (errors.length > 0) {
    console.log(`\n\nErrors (${errors.length}):`);
    errors.forEach((r) => console.log(`  ${r.symbol} @ ${r.timeframe}: ${r.error}`));
  }

  // Summary stats
  const profitable = sorted.filter((r) => r.returnPct > 0);
  const positiveSharpe = sorted.filter((r) => r.sharpe > 0);
  const goodSharpe = sorted.filter((r) => r.sharpe > 0.5);

  console.log('\n=== SUMMARY ===');
  console.log(`Total runs: ${sorted.length} (${errors.length} errors)`);
  if (sorted.length > 0) {
    console.log(
      `Profitable: ${profitable.length}/${sorted.length} (${((profitable.length / sorted.length) * 100).toFixed(0)}%)`
    );
    console.log(
      `Sharpe > 0: ${positiveSharpe.length}/${sorted.length} (${((positiveSharpe.length / sorted.length) * 100).toFixed(0)}%)`
    );
    console.log(
      `Sharpe > 0.5: ${goodSharpe.length}/${sorted.length} (${((goodSharpe.length / sorted.length) * 100).toFixed(0)}%)`
    );
  }

  // Best per timeframe
  for (const tf of TIMEFRAMES) {
    const tfResults = sorted.filter((r) => r.timeframe === tf);
    if (tfResults.length > 0) {
      const best = tfResults[0];
      console.log(
        `Best ${tf}: ${best.symbol} (Sharpe ${best.sharpe.toFixed(2)}, Return ${best.returnPct.toFixed(1)}%)`
      );
    }
  }

  // Funding income analysis
  if (sorted.length > 0) {
    const totalFunding = sorted.reduce((s, r) => s + r.fundingIncome, 0);
    const avgFunding = totalFunding / sorted.length;
    console.log(`\nAvg funding income per run: $${avgFunding.toFixed(1)}`);
    console.log(
      `Assets with funding > trading PnL: ${sorted.filter((r) => r.fundingIncome > r.tradingPnl && r.fundingIncome > 0).length}`
    );
  }

  await closeDb();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  closeDb();
  process.exit(1);
});
