#!/usr/bin/env node
/**
 * FR Spike Batch Scan
 *
 * Runs funding-rate-spike backtests across a large list of Bybit perp futures
 * symbols and timeframes, then ranks and reports results.
 *
 * Usage:
 *   npx tsx scripts/fr-spike-batch-scan.ts \
 *     --from=2024-01-01 --to=2026-02-22 \
 *     [--timeframes=1h,4h] \
 *     [--capital=10000] \
 *     [--min-trades=5] \
 *     [--symbols=BTC/USDT:USDT,ETH/USDT:USDT]
 *
 * Outputs:
 *   - Live progress per run
 *   - Full results table sorted by Sharpe
 *   - TOP 20 by Sharpe / Sortino / Return
 *   - Summary statistics
 *   - JSON saved to /workspace/data/fr-spike-scan-results.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb } from '../src/data/db.js';
import type { Timeframe, PerformanceMetrics } from '../src/core/types.js';

// ============================================================================
// Built-in symbol list — all major Bybit perp futures
// ============================================================================

const DEFAULT_SYMBOLS: string[] = [
  'BTC/USDT:USDT',    'ETH/USDT:USDT',    'XRP/USDT:USDT',    'ADA/USDT:USDT',
  'AVAX/USDT:USDT',   'SOL/USDT:USDT',    'LINK/USDT:USDT',   'LTC/USDT:USDT',
  'NEAR/USDT:USDT',   'ARB/USDT:USDT',    'OP/USDT:USDT',     'INJ/USDT:USDT',
  'ATOM/USDT:USDT',   'DOT/USDT:USDT',    'DOGE/USDT:USDT',   'WLD/USDT:USDT',
  'PEPE/USDT:USDT',   'APT/USDT:USDT',    'SEI/USDT:USDT',    'SUI/USDT:USDT',
  'GMX/USDT:USDT',    'BLUR/USDT:USDT',   'AAVE/USDT:USDT',   'RENDER/USDT:USDT',
  'TIA/USDT:USDT',    'ORDI/USDT:USDT',   'UNI/USDT:USDT',    'FIL/USDT:USDT',
  'POL/USDT:USDT',    'SONIC/USDT:USDT',  'TRX/USDT:USDT',    'ETC/USDT:USDT',
  'EIGEN/USDT:USDT',  'ENA/USDT:USDT',    'PENDLE/USDT:USDT', 'STRK/USDT:USDT',
  'ZRO/USDT:USDT',    'ONDO/USDT:USDT',   'TAO/USDT:USDT',    'RUNE/USDT:USDT',
  'STX/USDT:USDT',    'CRV/USDT:USDT',    'SNX/USDT:USDT',    'COMP/USDT:USDT',
  'DYDX/USDT:USDT',   'GRT/USDT:USDT',    'IMX/USDT:USDT',    'MANA/USDT:USDT',
  'SAND/USDT:USDT',   'AXS/USDT:USDT',    'GALA/USDT:USDT',   'ENS/USDT:USDT',
  'LDO/USDT:USDT',    'RPL/USDT:USDT',    'SSV/USDT:USDT',    'NOT/USDT:USDT',
  'TON/USDT:USDT',    'PYTH/USDT:USDT',   'JTO/USDT:USDT',    'W/USDT:USDT',
  'ETHFI/USDT:USDT',  'MEME/USDT:USDT',   'BOME/USDT:USDT',   'TRUMP/USDT:USDT',
  'HYPE/USDT:USDT',   'VIRTUAL/USDT:USDT','XLM/USDT:USDT',    'ALGO/USDT:USDT',
  'VET/USDT:USDT',    'ICP/USDT:USDT',    'THETA/USDT:USDT',  'HBAR/USDT:USDT',
  'BCH/USDT:USDT',    'KAS/USDT:USDT',
];

// ============================================================================
// Types
// ============================================================================

interface ScanRow {
  symbol: string;
  symbolShort: string;
  timeframe: string;
  totalReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  profitFactor: number;
  totalFundingIncome: number;
  tradingPnl: number;
  hasError: boolean;
  error?: string;
}

// ============================================================================
// CLI argument parsing
// ============================================================================

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 2) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        result[key] = value;
      }
    }
  }
  return result;
}

// ============================================================================
// Table formatting helpers
// ============================================================================

function pad(str: string, width: number, right = false): string {
  const s = String(str);
  if (s.length >= width) return s.slice(0, width);
  const padding = ' '.repeat(width - s.length);
  return right ? padding + s : s + padding;
}

function rpad(str: string, width: number): string {
  return pad(str, width, true);
}

function lpad(str: string, width: number): string {
  return pad(str, width, false);
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function printResultsTable(rows: ScanRow[], title: string, limit?: number): void {
  const display = limit ? rows.slice(0, limit) : rows;

  const HDR = [
    rpad('#', 4),
    lpad('Symbol', 12),
    lpad('TF', 4),
    rpad('Return%', 9),
    rpad('Sharpe', 7),
    rpad('Sortino', 8),
    rpad('MaxDD%', 7),
    rpad('WinRate%', 9),
    rpad('Trades', 7),
    rpad('PF', 6),
    rpad('Funding$', 10),
    rpad('TradePnL$', 11),
  ].join('  ');

  const SEP = '-'.repeat(HDR.length);

  console.log(`\n${title}`);
  console.log(SEP);
  console.log(HDR);
  console.log(SEP);

  display.forEach((r, i) => {
    const row = [
      rpad(String(i + 1), 4),
      lpad(r.symbolShort, 12),
      lpad(r.timeframe, 4),
      rpad(fmtPct(r.totalReturnPct), 9),
      rpad(fmt(r.sharpeRatio), 7),
      rpad(fmt(r.sortinoRatio), 8),
      rpad(`${fmt(r.maxDrawdownPct)}%`, 7),
      rpad(`${fmt(r.winRatePct)}%`, 9),
      rpad(String(r.tradeCount), 7),
      rpad(fmt(r.profitFactor), 6),
      rpad(`$${fmt(r.totalFundingIncome, 1)}`, 10),
      rpad(`$${fmt(r.tradingPnl, 1)}`, 11),
    ].join('  ');
    console.log(row);
  });

  console.log(SEP);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!args.from || !args.to) {
    console.error('Error: --from and --to are required. Example: --from=2024-01-01 --to=2026-02-22');
    process.exit(1);
  }

  const startDate = new Date(args.from).getTime();
  const endDate = new Date(args.to).getTime();

  if (isNaN(startDate) || isNaN(endDate)) {
    console.error('Error: Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (startDate >= endDate) {
    console.error('Error: --from must be before --to');
    process.exit(1);
  }

  // Parse optional args
  const timeframeArg = args.timeframes ?? '1h,4h';
  const timeframes = timeframeArg.split(',').map(tf => tf.trim()) as Timeframe[];
  const capital = Number(args.capital ?? '10000');
  const minTrades = Number(args['min-trades'] ?? '5');

  let symbols: string[];
  if (args.symbols) {
    symbols = args.symbols.split(',').map(s => s.trim());
  } else {
    symbols = DEFAULT_SYMBOLS;
  }

  const total = symbols.length * timeframes.length;

  console.log('='.repeat(70));
  console.log('  FR SPIKE BATCH SCAN');
  console.log('='.repeat(70));
  console.log(`  Strategy    : funding-rate-spike (default params)`);
  console.log(`  Exchange    : bybit (futures mode)`);
  console.log(`  Period      : ${args.from} to ${args.to}`);
  console.log(`  Timeframes  : ${timeframes.join(', ')}`);
  console.log(`  Symbols     : ${symbols.length}`);
  console.log(`  Total runs  : ${total}`);
  console.log(`  Capital     : $${capital.toLocaleString()}`);
  console.log(`  Min trades  : ${minTrades}`);
  console.log('='.repeat(70));
  console.log('');

  const allResults: ScanRow[] = [];
  let completed = 0;

  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      completed++;
      const symbolShort = symbol.replace('/USDT:USDT', '');
      const prefix = `[${String(completed).padStart(String(total).length)}/${total}] ${symbolShort.padEnd(10)} ${timeframe.padEnd(3)}`;

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
            feeRate: 0.00055, // Bybit taker fee for perps
            slippagePercent: 0.05,
          },
        });

        const m: PerformanceMetrics = result.metrics;
        const fundingIncome = (m as Record<string, unknown>).totalFundingIncome as number ?? 0;
        const tradingPnl = (m as Record<string, unknown>).tradingPnl as number ?? m.totalReturn;

        const row: ScanRow = {
          symbol,
          symbolShort,
          timeframe,
          totalReturnPct: m.totalReturnPercent,
          sharpeRatio: m.sharpeRatio,
          sortinoRatio: m.sortinoRatio,
          maxDrawdownPct: m.maxDrawdownPercent,
          winRatePct: m.winRate,
          tradeCount: m.totalTrades,
          profitFactor: m.profitFactor,
          totalFundingIncome: fundingIncome,
          tradingPnl,
          hasError: false,
        };
        allResults.push(row);

        // Progress line
        const sharpeStr = m.sharpeRatio >= 0
          ? `+${m.sharpeRatio.toFixed(2)}`
          : m.sharpeRatio.toFixed(2);
        const retStr = fmtPct(m.totalReturnPercent);
        console.log(
          `${prefix} -> Sharpe: ${sharpeStr.padStart(6)}, Return: ${retStr.padStart(8)}, Trades: ${String(m.totalTrades).padStart(3)}, Funding: $${fundingIncome.toFixed(1)}`
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Truncate long error messages for display
        const displayMsg = msg.length > 70 ? msg.slice(0, 70) + '...' : msg;
        console.log(`${prefix} -> ERROR: ${displayMsg}`);
        allResults.push({
          symbol,
          symbolShort,
          timeframe,
          totalReturnPct: 0,
          sharpeRatio: -Infinity,
          sortinoRatio: -Infinity,
          maxDrawdownPct: 0,
          winRatePct: 0,
          tradeCount: 0,
          profitFactor: 0,
          totalFundingIncome: 0,
          tradingPnl: 0,
          hasError: true,
          error: msg,
        });
      }
    }
  }

  // ============================================================================
  // Post-processing
  // ============================================================================

  const successResults = allResults.filter(r => !r.hasError);
  const errorResults = allResults.filter(r => r.hasError);
  const qualifyingResults = successResults.filter(r => r.tradeCount >= minTrades);
  const profitableResults = qualifyingResults.filter(r => r.totalReturnPct > 0);

  // Sorted copies for each ranking
  const bySharpe = [...qualifyingResults].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
  const bySortino = [...qualifyingResults].sort((a, b) => b.sortinoRatio - a.sortinoRatio);
  const byReturn = [...qualifyingResults].sort((a, b) => b.totalReturnPct - a.totalReturnPct);

  // ============================================================================
  // Print full results table (sorted by Sharpe)
  // ============================================================================

  printResultsTable(bySharpe, `=== FULL RESULTS TABLE (${qualifyingResults.length} qualifying runs, sorted by Sharpe) ===`);

  // ============================================================================
  // TOP 20 rankings
  // ============================================================================

  printResultsTable(bySharpe, '=== TOP 20 BY SHARPE RATIO ===', 20);
  printResultsTable(bySortino, '=== TOP 20 BY SORTINO RATIO ===', 20);
  printResultsTable(byReturn, '=== TOP 20 BY TOTAL RETURN ===', 20);

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));

  console.log(`  Total combinations tested  : ${total}`);
  console.log(`  Runs with data (no error)  : ${successResults.length}`);
  console.log(`  Errors (no data cached)    : ${errorResults.length}`);
  console.log(`  Meeting min-trades (>=${minTrades})  : ${qualifyingResults.length}`);
  console.log(`  Profitable (return > 0%)   : ${profitableResults.length}`);

  if (profitableResults.length > 0) {
    const avgSharpe = profitableResults.reduce((s, r) => s + r.sharpeRatio, 0) / profitableResults.length;
    const avgReturn = profitableResults.reduce((s, r) => s + r.totalReturnPct, 0) / profitableResults.length;
    const avgFunding = profitableResults.reduce((s, r) => s + r.totalFundingIncome, 0) / profitableResults.length;
    console.log(`  Avg Sharpe (profitable)    : ${avgSharpe.toFixed(2)}`);
    console.log(`  Avg Return (profitable)    : ${fmtPct(avgReturn)}`);
    console.log(`  Avg Funding (profitable)   : $${avgFunding.toFixed(1)}`);
  }

  // Best per timeframe
  console.log('');
  for (const tf of timeframes) {
    const tfRows = bySharpe.filter(r => r.timeframe === tf);
    if (tfRows.length > 0) {
      const best = tfRows[0];
      console.log(
        `  Best ${tf.padEnd(3)}: ${best.symbolShort.padEnd(12)} Sharpe ${best.sharpeRatio.toFixed(2)}, Return ${fmtPct(best.totalReturnPct)}, Trades ${best.tradeCount}`
      );
    } else {
      console.log(`  Best ${tf.padEnd(3)}: (no qualifying results)`);
    }
  }

  // Error list (if any)
  if (errorResults.length > 0) {
    console.log(`\n  Errors (${errorResults.length} — likely no cached data):`);
    for (const r of errorResults) {
      const errMsg = r.error ?? 'unknown';
      const shortErr = errMsg.length > 80 ? errMsg.slice(0, 80) + '...' : errMsg;
      console.log(`    ${r.symbolShort.padEnd(12)} ${r.timeframe.padEnd(4)} ${shortErr}`);
    }
  }

  console.log('='.repeat(70));

  // ============================================================================
  // Save JSON results
  // ============================================================================

  const outputDir = join('/workspace', 'data');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, 'fr-spike-scan-results.json');

  const jsonOutput = {
    scanMetadata: {
      timestamp: new Date().toISOString(),
      from: args.from,
      to: args.to,
      timeframes,
      capital,
      minTrades,
      symbolCount: symbols.length,
      totalRuns: total,
      exchange: 'bybit',
      strategy: 'funding-rate-spike',
      mode: 'futures',
    },
    summary: {
      totalRuns: total,
      runsWithData: successResults.length,
      errors: errorResults.length,
      qualifyingRuns: qualifyingResults.length,
      profitableRuns: profitableResults.length,
      avgSharpeProfitable: profitableResults.length > 0
        ? profitableResults.reduce((s, r) => s + r.sharpeRatio, 0) / profitableResults.length
        : null,
    },
    top20BySharpe: bySharpe.slice(0, 20),
    top20BySortino: bySortino.slice(0, 20),
    top20ByReturn: byReturn.slice(0, 20),
    allResults: bySharpe,
    errors: errorResults.map(r => ({
      symbol: r.symbol,
      timeframe: r.timeframe,
      error: r.error,
    })),
  };

  writeFileSync(outputPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n  Full results saved to: ${outputPath}`);

  await closeDb();
}

main().catch(error => {
  console.error('Fatal error:', error);
  closeDb();
  process.exit(1);
});
