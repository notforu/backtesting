#!/usr/bin/env node
/**
 * Batch scan: funding-rate-spike-v2 across all cached Bybit symbols
 *
 * Usage:
 *   npx tsx scripts/scan-fr-v2.ts [options]
 *
 * Options:
 *   --from=YYYY-MM-DD     Start date (default: 2024-01-01)
 *   --to=YYYY-MM-DD       End date   (default: 2026-02-01)
 *   --capital=AMOUNT      Initial capital per run (default: 10000)
 *   --skip=SYM1,SYM2      Comma-separated symbols to skip (no suffix needed, e.g. BTC,ETH)
 *   --only=SYM1,SYM2      Comma-separated symbols to run exclusively
 *
 * Runs 58 backtests (29 symbols x 2 timeframes: 1h and 4h) sequentially.
 * Saves every successful result to the DB via saveBacktestRun().
 * Prints a full table and a Top 15 highlight sorted by Sharpe at the end.
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb, saveBacktestRun } from '../src/data/db.js';
import type { Timeframe, PerformanceMetrics, BacktestResult } from '../src/core/types.js';

// ============================================================================
// Constants
// ============================================================================

const BASE_SYMBOLS = [
  'BTC', 'ETH', 'LTC', 'ADA', 'DOT', 'ETC', 'MANA', 'CRV', 'AXS', 'SNX',
  'IMX', 'LINK', 'VET', 'GRT', 'ICP', 'AAVE', 'HBAR', 'TRX', 'XLM', 'LDO',
  'XRP', 'PENDLE', 'WLD', 'NEAR', 'DOGE', 'WIF', 'OP', 'ATOM', 'INJ',
];

const TIMEFRAMES: Timeframe[] = ['1h', '4h'];

const STRATEGY = 'funding-rate-spike-v2';
const EXCHANGE = 'bybit';
const DEFAULT_FROM = '2024-01-01';
const DEFAULT_TO = '2026-02-01';
const DEFAULT_CAPITAL = 10000;

// Bybit taker fee for futures
const FEE_RATE = 0.00055;

// ============================================================================
// Types
// ============================================================================

interface ScanRow {
  symbol: string;
  timeframe: string;
  sharpe: number;
  returnPct: number;
  maxDD: number;
  trades: number;
  winRate: number;
  fundingIncome: number;
  tradingPnl: number;
  sortino: number;
  profitFactor: number;
  saved: boolean;
  error?: string;
}

// ============================================================================
// Arg parsing
// ============================================================================

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result[key] = value;
      }
    }
  }
  return result;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function pad(s: string, width: number, right = false): string {
  if (right) return s.padStart(width);
  return s.padEnd(width);
}

function printRow(
  rank: string,
  sym: string,
  tf: string,
  sharpe: string,
  ret: string,
  dd: string,
  trades: string,
  wr: string,
  funding: string
): void {
  console.log(
    `${pad(rank, 5)} ${pad(sym, 7)} ${pad(tf, 4)} ${pad(sharpe, 7, true)} ${pad(ret, 9, true)} ${pad(dd, 8, true)} ${pad(trades, 6, true)} ${pad(wr, 8, true)} ${pad(funding, 10, true)}`
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const from = args.from ?? DEFAULT_FROM;
  const to = args.to ?? DEFAULT_TO;
  const capital = Number(args.capital ?? DEFAULT_CAPITAL);
  const startDate = new Date(from).getTime();
  const endDate = new Date(to).getTime();

  // Build symbol filter sets
  const skipSet = new Set(
    (args.skip ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
  const onlySet = new Set(
    (args.only ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );

  const symbols = BASE_SYMBOLS.filter((sym) => {
    if (onlySet.size > 0 && !onlySet.has(sym)) return false;
    if (skipSet.has(sym)) return false;
    return true;
  });

  const total = symbols.length * TIMEFRAMES.length;
  console.log(`=== FR-v2 Batch Scan ===`);
  console.log(`Strategy  : ${STRATEGY}`);
  console.log(`Period    : ${from} → ${to}`);
  console.log(`Capital   : $${capital.toLocaleString()}`);
  console.log(`Symbols   : ${symbols.length} (${symbols.join(', ')})`);
  console.log(`Timeframes: ${TIMEFRAMES.join(', ')}`);
  console.log(`Total runs: ${total}`);
  console.log('');

  const rows: ScanRow[] = [];
  let completed = 0;

  for (const sym of symbols) {
    for (const tf of TIMEFRAMES) {
      completed++;
      const fullSymbol = `${sym}/USDT:USDT`;
      const label = `[${completed}/${total}] ${sym} @ ${tf}`;

      let result: BacktestResult | null = null;

      try {
        const config = createBacktestConfig({
          strategyName: STRATEGY,
          symbol: fullSymbol,
          timeframe: tf,
          startDate,
          endDate,
          initialCapital: capital,
          exchange: EXCHANGE,
          params: {}, // use strategy defaults
          mode: 'futures',
        });

        result = await runBacktest(config, {
          enableLogging: false,
          saveResults: false, // we save manually below
          skipFeeFetch: true,
          broker: {
            feeRate: FEE_RATE,
            slippagePercent: 0.05,
          },
        });

        const m: PerformanceMetrics = result.metrics;
        const mAny = m as Record<string, unknown>;

        const row: ScanRow = {
          symbol: sym,
          timeframe: tf,
          sharpe: m.sharpeRatio,
          returnPct: m.totalReturnPercent,
          maxDD: m.maxDrawdownPercent,
          trades: m.totalTrades,
          winRate: m.winRate,
          fundingIncome: typeof mAny['totalFundingIncome'] === 'number' ? mAny['totalFundingIncome'] : 0,
          tradingPnl: typeof mAny['tradingPnl'] === 'number' ? mAny['tradingPnl'] : 0,
          sortino: m.sortinoRatio,
          profitFactor: m.profitFactor,
          saved: false,
        };

        // Save to DB
        try {
          await saveBacktestRun(result);
          row.saved = true;
        } catch (saveErr) {
          const saveMsg = saveErr instanceof Error ? saveErr.message : 'unknown save error';
          console.error(`  [WARN] Could not save ${sym}@${tf} to DB: ${saveMsg}`);
        }

        rows.push(row);

        const sharpeStr = m.sharpeRatio >= 0
          ? `+${m.sharpeRatio.toFixed(2)}`
          : m.sharpeRatio.toFixed(2);
        const savedStr = row.saved ? ' [saved]' : ' [not saved]';
        console.log(
          `${label} -> Sharpe ${sharpeStr}, Return ${m.totalReturnPercent.toFixed(1)}%, Trades ${m.totalTrades}, Funding $${row.fundingIncome.toFixed(1)}${savedStr}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        console.log(`${label} -> ERROR: ${msg}`);
        rows.push({
          symbol: sym,
          timeframe: tf,
          sharpe: -Infinity,
          returnPct: 0,
          maxDD: 0,
          trades: 0,
          winRate: 0,
          fundingIncome: 0,
          tradingPnl: 0,
          sortino: 0,
          profitFactor: 0,
          saved: false,
          error: msg,
        });
      }
    }
  }

  // ============================================================================
  // Results Table
  // ============================================================================

  const successful = rows.filter((r) => !r.error);
  const errors = rows.filter((r) => r.error);
  const sorted = [...successful].sort((a, b) => b.sharpe - a.sharpe);

  console.log('\n\n=== RESULTS TABLE (sorted by Sharpe) ===\n');

  // Header
  printRow('Rank', 'Symbol', 'TF', 'Sharpe', 'Return%', 'MaxDD%', 'Trades', 'WinRate%', 'Funding$');
  console.log('-'.repeat(70));

  sorted.forEach((r, i) => {
    const sharpeStr = isFinite(r.sharpe)
      ? (r.sharpe >= 0 ? `+${fmt(r.sharpe)}` : fmt(r.sharpe))
      : 'N/A';
    printRow(
      `${i + 1}.`,
      r.symbol,
      r.timeframe,
      sharpeStr,
      fmt(r.returnPct, 1),
      fmt(r.maxDD, 1),
      r.trades.toString(),
      fmt(r.winRate, 1),
      fmt(r.fundingIncome, 1)
    );
  });

  // ============================================================================
  // Error list
  // ============================================================================

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length} runs failed):`);
    errors.forEach((r) => {
      console.log(`  ${r.symbol} @ ${r.timeframe}: ${r.error}`);
    });
  }

  // ============================================================================
  // Summary stats
  // ============================================================================

  const profitable = sorted.filter((r) => r.returnPct > 0);
  const positiveSharpe = sorted.filter((r) => r.sharpe > 0);
  const goodSharpe = sorted.filter((r) => r.sharpe > 0.5);
  const greatSharpe = sorted.filter((r) => r.sharpe > 1.0);

  console.log('\n=== SUMMARY ===');
  console.log(`Total runs   : ${rows.length} (${successful.length} successful, ${errors.length} errors)`);
  console.log(`Saved to DB  : ${successful.filter((r) => r.saved).length}/${successful.length}`);

  if (sorted.length > 0) {
    console.log(`Profitable   : ${profitable.length}/${sorted.length} (${((profitable.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 0   : ${positiveSharpe.length}/${sorted.length} (${((positiveSharpe.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 0.5 : ${goodSharpe.length}/${sorted.length} (${((goodSharpe.length / sorted.length) * 100).toFixed(0)}%)`);
    console.log(`Sharpe > 1.0 : ${greatSharpe.length}/${sorted.length} (${((greatSharpe.length / sorted.length) * 100).toFixed(0)}%)`);

    const avgFunding = sorted.reduce((s, r) => s + r.fundingIncome, 0) / sorted.length;
    console.log(`Avg funding  : $${avgFunding.toFixed(1)} per run`);
  }

  // Best per timeframe
  console.log('');
  for (const tf of TIMEFRAMES) {
    const tfRows = sorted.filter((r) => r.timeframe === tf);
    if (tfRows.length > 0) {
      const best = tfRows[0];
      console.log(
        `Best ${tf}: ${best.symbol} (Sharpe ${fmt(best.sharpe)}, Return ${fmt(best.returnPct, 1)}%, Trades ${best.trades})`
      );
    }
  }

  // ============================================================================
  // Top 15 by Sharpe (aggregation candidates)
  // ============================================================================

  const top15 = sorted.slice(0, 15);

  console.log('\n=== TOP 15 BY SHARPE (aggregation candidates) ===\n');
  printRow('Rank', 'Symbol', 'TF', 'Sharpe', 'Return%', 'MaxDD%', 'Trades', 'WinRate%', 'Funding$');
  console.log('-'.repeat(70));

  top15.forEach((r, i) => {
    const sharpeStr = isFinite(r.sharpe)
      ? (r.sharpe >= 0 ? `+${fmt(r.sharpe)}` : fmt(r.sharpe))
      : 'N/A';
    const highlight = r.sharpe > 1.5 ? ' ***' : r.sharpe > 1.0 ? ' **' : r.sharpe > 0.5 ? ' *' : '';
    printRow(
      `${i + 1}.`,
      r.symbol,
      r.timeframe,
      sharpeStr + highlight,
      fmt(r.returnPct, 1),
      fmt(r.maxDD, 1),
      r.trades.toString(),
      fmt(r.winRate, 1),
      fmt(r.fundingIncome, 1)
    );
  });

  console.log('\n  * Sharpe > 0.5  ** Sharpe > 1.0  *** Sharpe > 1.5');
  console.log('\nDone.');

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb().catch(() => undefined);
  process.exit(1);
});
