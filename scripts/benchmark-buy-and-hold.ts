#!/usr/bin/env node
/**
 * Buy-and-hold benchmark comparison for top FR V2 strategy configurations.
 *
 * Compares three strategy configs against equal-weight buy-and-hold of
 * the same symbol sets over 2024-01-01 to 2026-03-01.
 *
 * Usage:
 *   npx tsx scripts/benchmark-buy-and-hold.ts
 *
 * Output: comparison table to stdout, progress to stderr.
 * Does NOT save to DB — benchmark only.
 */

import { getCandles, closeDb } from '../src/data/db.js';
import type { Candle } from '../src/core/types.js';

// ============================================================================
// Period
// ============================================================================

const FROM_DATE = '2024-01-01';
const TO_DATE   = '2026-03-01';
const START_TS  = new Date(FROM_DATE).getTime(); // 1704067200000
const END_TS    = new Date(TO_DATE).getTime();   // 1772323200000
const EXCHANGE  = 'bybit';
const TIMEFRAME = '4h';
const INITIAL_CAPITAL = 10_000;

// ============================================================================
// Portfolio configs
// Strategy return / DD figures come from prior backtest results (hardcoded).
// ============================================================================

interface PortfolioConfig {
  label: string;
  stratSharpe: number;
  stratReturn: number; // percent
  stratDD: number;     // percent (positive = drawdown amount)
  symbols: string[];
}

const CONFIGS: PortfolioConfig[] = [
  {
    label: 'V2 7sym top_n mp=3',
    stratSharpe: 3.12,
    stratReturn: 159.8,
    stratDD: 7.2,
    symbols: [
      'ZEC/USDT:USDT',
      'LDO/USDT:USDT',
      'TRB/USDT:USDT',
      'XLM/USDT:USDT',
      'IOST/USDT:USDT',
      'NEAR/USDT:USDT',
      'STG/USDT:USDT',
    ],
  },
  {
    label: 'V2 13sym top_n mp=3',
    stratSharpe: 2.35,
    stratReturn: 149.8,
    stratDD: 5.4,
    symbols: [
      'IOST/USDT:USDT',
      'ZEC/USDT:USDT',
      'ARB/USDT:USDT',
      'IOTA/USDT:USDT',
      'TRB/USDT:USDT',
      'STG/USDT:USDT',
      'COTI/USDT:USDT',
      'ENJ/USDT:USDT',
      'KAVA/USDT:USDT',
      'APT/USDT:USDT',
      'COMP/USDT:USDT',
      'RPL/USDT:USDT',
      'BCH/USDT:USDT',
    ],
  },
  {
    label: 'V2 5sym top_n mp=3',
    stratSharpe: 2.05,
    stratReturn: 67.7,
    stratDD: 3.5,
    symbols: [
      'ZEC/USDT:USDT',
      'LDO/USDT:USDT',
      'DOGE/USDT:USDT',
      'NEAR/USDT:USDT',
      'STG/USDT:USDT',
    ],
  },
];

// ============================================================================
// Buy-and-hold calculation
// ============================================================================

interface BenchmarkResult {
  label: string;
  sharpe: number;
  sortino: number;
  totalReturn: number;  // percent
  maxDD: number;        // percent (positive)
  symbolResults: SymbolBenchmark[];
  missingSymbols: string[];
}

interface SymbolBenchmark {
  symbol: string;
  firstClose: number;
  lastClose: number;
  returnPct: number;
  candles: number;
}

/**
 * Calculate max drawdown from an equity curve (array of dollar values).
 */
function calcMaxDrawdown(equity: number[]): number {
  if (equity.length === 0) return 0;
  let peak = equity[0];
  let maxDD = 0;
  for (const val of equity) {
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100; // percent
}

/**
 * Convert 4h bar-level returns to daily returns by summing 6 bars per day.
 * Returns are log-returns for each 4h bar (close-to-close).
 * We compound 6 bars into 1 daily return.
 *
 * We use simple compounding: daily_return = product(1 + bar_return) - 1
 * for each group of 6 bars.
 */
function toDailyReturns(barReturns: number[]): number[] {
  const daily: number[] = [];
  const BARS_PER_DAY = 6; // 24h / 4h

  let i = 0;
  while (i < barReturns.length) {
    const slice = barReturns.slice(i, i + BARS_PER_DAY);
    // Compound: (1+r1)(1+r2)...(1+r6) - 1
    const compound = slice.reduce((acc, r) => acc * (1 + r), 1) - 1;
    daily.push(compound);
    i += BARS_PER_DAY;
  }

  return daily;
}

/**
 * Calculate annualized Sharpe ratio from daily returns.
 * Sharpe = mean(daily_returns) / std(daily_returns) * sqrt(365)
 */
function calcSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return NaN;

  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / n;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  if (std === 0) return NaN;
  return (mean / std) * Math.sqrt(365);
}

/**
 * Calculate annualized Sortino ratio from daily returns.
 * Sortino = mean(daily_returns) / downside_std * sqrt(365)
 * Downside std uses only negative returns.
 */
function calcSortino(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return NaN;

  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / n;
  const negReturns = dailyReturns.filter((r) => r < 0);

  if (negReturns.length === 0) return Infinity;

  const downVariance = negReturns.reduce((s, r) => s + r ** 2, 0) / n;
  const downStd = Math.sqrt(downVariance);

  if (downStd === 0) return NaN;
  return (mean / downStd) * Math.sqrt(365);
}

/**
 * Load candles for all symbols in a portfolio and compute equal-weight B&H metrics.
 */
async function calcBuyAndHold(
  config: PortfolioConfig,
): Promise<BenchmarkResult> {
  const { label, symbols } = config;
  const n = symbols.length;
  const allocationPerSymbol = INITIAL_CAPITAL / n;

  process.stderr.write(`\n[bah] ${label} — loading ${n} symbols...\n`);

  const symbolResults: SymbolBenchmark[] = [];
  const missingSymbols: string[] = [];

  // Load candles for each symbol
  const candleMap = new Map<string, Candle[]>();

  for (const symbol of symbols) {
    process.stderr.write(`[bah]   ${symbol}...`);
    const candles = await getCandles(EXCHANGE, symbol, TIMEFRAME, START_TS, END_TS);
    process.stderr.write(` ${candles.length} candles\n`);

    if (candles.length < 2) {
      process.stderr.write(`[bah]   WARNING: insufficient candles for ${symbol} (${candles.length}), skipping\n`);
      missingSymbols.push(symbol);
      continue;
    }

    candleMap.set(symbol, candles);
  }

  const availableSymbols = symbols.filter((s) => candleMap.has(s));
  if (availableSymbols.length === 0) {
    throw new Error(`${label}: no symbols have candle data`);
  }

  // For each available symbol, track share count and returns
  for (const symbol of availableSymbols) {
    const candles = candleMap.get(symbol)!;
    const firstClose = candles[0].close;
    const lastClose  = candles[candles.length - 1].close;
    const returnPct  = ((lastClose - firstClose) / firstClose) * 100;

    symbolResults.push({
      symbol,
      firstClose,
      lastClose,
      returnPct,
      candles: candles.length,
    });
  }

  // Build portfolio equity curve aligned to the union of all timestamps
  // Strategy: for each timestamp, sum position values across all symbols.
  // Each symbol's position value = (allocation / firstClose) * currentClose

  // Collect all unique timestamps, sorted
  const timestampSet = new Set<number>();
  for (const symbol of availableSymbols) {
    for (const c of candleMap.get(symbol)!) {
      timestampSet.add(c.timestamp);
    }
  }
  const allTimestamps = Array.from(timestampSet).sort((a, b) => a - b);

  // Build close price maps
  const closeMaps = new Map<string, Map<number, number>>();
  for (const symbol of availableSymbols) {
    const closeMap = new Map<number, number>();
    for (const c of candleMap.get(symbol)!) {
      closeMap.set(c.timestamp, c.close);
    }
    closeMaps.set(symbol, closeMap);
  }

  // Compute per-symbol initial prices (first available candle price)
  const initPrices = new Map<string, number>();
  const shareQty   = new Map<string, number>();
  const effectiveAlloc = INITIAL_CAPITAL / availableSymbols.length;

  for (const symbol of availableSymbols) {
    const candles = candleMap.get(symbol)!;
    const firstClose = candles[0].close;
    initPrices.set(symbol, firstClose);
    shareQty.set(symbol, effectiveAlloc / firstClose);
  }

  // Build portfolio equity at each timestamp
  // Use last-known price for any symbol that doesn't have a bar at this timestamp
  const portfolioEquity: number[] = [];
  const lastKnownPrice = new Map<string, number>();

  // Initialize with first price
  for (const symbol of availableSymbols) {
    lastKnownPrice.set(symbol, initPrices.get(symbol)!);
  }

  for (const ts of allTimestamps) {
    let portfolioValue = 0;
    for (const symbol of availableSymbols) {
      const closeMap = closeMaps.get(symbol)!;
      const price = closeMap.get(ts) ?? lastKnownPrice.get(symbol)!;
      lastKnownPrice.set(symbol, price);
      portfolioValue += shareQty.get(symbol)! * price;
    }
    portfolioEquity.push(portfolioValue);
  }

  // Compute bar-to-bar portfolio returns
  const barReturns: number[] = [];
  for (let i = 1; i < portfolioEquity.length; i++) {
    const prev = portfolioEquity[i - 1];
    const curr = portfolioEquity[i];
    if (prev > 0) {
      barReturns.push((curr - prev) / prev);
    } else {
      barReturns.push(0);
    }
  }

  const dailyReturns = toDailyReturns(barReturns);
  const sharpe  = calcSharpe(dailyReturns);
  const sortino = calcSortino(dailyReturns);
  const maxDD   = calcMaxDrawdown(portfolioEquity);

  const finalEquity = portfolioEquity[portfolioEquity.length - 1];
  const totalReturn = ((finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

  process.stderr.write(
    `[bah] ${label} — Sharpe=${isFinite(sharpe) ? sharpe.toFixed(2) : 'N/A'}, ` +
    `Return=${totalReturn.toFixed(1)}%, MaxDD=${maxDD.toFixed(1)}%\n`,
  );

  return {
    label,
    sharpe,
    sortino,
    totalReturn,
    maxDD,
    symbolResults,
    missingSymbols,
  };
}

// ============================================================================
// Formatting helpers
// ============================================================================

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

function rpad(s: string, width: number): string {
  return s.padStart(width);
}

function fmt(n: number, decimals = 2): string {
  if (!isFinite(n)) return 'N/A';
  return n.toFixed(decimals);
}

function fmtSharpe(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

function fmtPct(n: number, decimals = 1): string {
  if (!isFinite(n)) return 'N/A';
  return n.toFixed(decimals) + '%';
}

function fmtExcessSharpe(excess: number): string {
  if (!isFinite(excess)) return 'N/A';
  return (excess >= 0 ? '+' : '') + excess.toFixed(2);
}

function fmtExcessReturn(excess: number): string {
  if (!isFinite(excess)) return 'N/A';
  return (excess >= 0 ? '+' : '') + excess.toFixed(1) + '%';
}

function fmtDDDiff(diff: number): string {
  // diff = stratDD - bahDD; negative means strategy has LESS drawdown (better)
  if (!isFinite(diff)) return 'N/A';
  return (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
}

// ============================================================================
// Print comparison table
// ============================================================================

interface BenchmarkRow {
  config: PortfolioConfig;
  bah: BenchmarkResult;
}

function printComparisonTable(rows: BenchmarkRow[]): void {
  const SEP  = '='.repeat(66);
  const DASH = '-'.repeat(66);
  const COL1 = 26;
  const COL2 = 10;

  console.log('');
  console.log(SEP);
  console.log('  BUY-AND-HOLD BENCHMARK COMPARISON');
  console.log(`  Period: ${FROM_DATE} to ${TO_DATE}  |  Capital: $${INITIAL_CAPITAL.toLocaleString()}`);
  console.log(SEP);

  // ---- Sharpe section ----
  console.log(
    pad('Config', COL1) +
    rpad('Strat Sharpe', COL2) +
    rpad('B&H Sharpe', COL2) +
    rpad('Excess', COL2),
  );
  console.log(DASH);

  for (const { config, bah } of rows) {
    const excess = config.stratSharpe - bah.sharpe;
    console.log(
      pad(config.label, COL1) +
      rpad(fmtSharpe(config.stratSharpe), COL2) +
      rpad(fmtSharpe(bah.sharpe), COL2) +
      rpad(fmtExcessSharpe(excess), COL2),
    );
  }

  console.log(DASH);

  // ---- Return section ----
  console.log('');
  console.log(
    pad('Config', COL1) +
    rpad('Strat Return', COL2) +
    rpad('B&H Return', COL2) +
    rpad('Excess', COL2),
  );
  console.log(DASH);

  for (const { config, bah } of rows) {
    const excess = config.stratReturn - bah.totalReturn;
    console.log(
      pad(config.label, COL1) +
      rpad(fmtPct(config.stratReturn), COL2) +
      rpad(fmtPct(bah.totalReturn), COL2) +
      rpad(fmtExcessReturn(excess), COL2),
    );
  }

  console.log(DASH);

  // ---- MaxDD section ----
  console.log('');
  console.log(
    pad('Config', COL1) +
    rpad('Strat DD', COL2) +
    rpad('B&H DD', COL2) +
    rpad('DD Diff', COL2),
  );
  console.log(DASH);

  for (const { config, bah } of rows) {
    // DD diff: negative means strategy has less drawdown (better)
    const diff = config.stratDD - bah.maxDD;
    console.log(
      pad(config.label, COL1) +
      rpad(fmtPct(config.stratDD), COL2) +
      rpad(fmtPct(bah.maxDD), COL2) +
      rpad(fmtDDDiff(diff), COL2),
    );
  }

  console.log(DASH);

  // ---- Sortino section ----
  console.log('');
  console.log(
    pad('Config', COL1) +
    rpad('Sortino (B&H only)', COL2 * 2),
  );
  console.log(DASH);
  for (const { bah } of rows) {
    console.log(
      pad(bah.label, COL1) +
      rpad(fmt(bah.sortino), COL2),
    );
  }
  console.log(DASH);

  // ---- Per-symbol detail ----
  console.log('');
  console.log(SEP);
  console.log('  PER-SYMBOL B&H RETURNS');
  console.log(SEP);

  for (const { config, bah } of rows) {
    console.log(`\n  ${config.label} (${bah.symbolResults.length} symbols with data):`);
    const SYM_W = 20;
    const NUM_W = 12;
    console.log(
      '  ' + pad('Symbol', SYM_W) + rpad('Buy Price', NUM_W) + rpad('Sell Price', NUM_W) + rpad('Return', NUM_W)
    );
    console.log('  ' + '-'.repeat(SYM_W + NUM_W * 3));

    // Sort by return descending
    const sorted = [...bah.symbolResults].sort((a, b) => b.returnPct - a.returnPct);
    for (const s of sorted) {
      const base = s.symbol.replace('/USDT:USDT', '');
      console.log(
        '  ' +
        pad(base, SYM_W) +
        rpad('$' + s.firstClose.toFixed(4), NUM_W) +
        rpad('$' + s.lastClose.toFixed(4), NUM_W) +
        rpad(fmtPct(s.returnPct), NUM_W),
      );
    }

    if (bah.missingSymbols.length > 0) {
      console.log(`  Missing data: ${bah.missingSymbols.map((s) => s.replace('/USDT:USDT', '')).join(', ')}`);
    }
  }

  console.log('');
  console.log(SEP);
  console.log('  NOTES');
  console.log(SEP);
  console.log('  - B&H: equal-weight allocation at first candle open, held to last close');
  console.log('  - No rebalancing, no fees (B&H benchmark)');
  console.log('  - Sharpe: annualized from daily returns (6 x 4h bars = 1 day)');
  console.log('  - DD Diff negative = strategy has LESS drawdown than B&H (better)');
  console.log('  - Strategy figures come from walk-forward-validated backtests');
  console.log(SEP);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write(`[bah] Buy-and-Hold Benchmark\n`);
  process.stderr.write(`[bah] Period: ${FROM_DATE} to ${TO_DATE}\n`);
  process.stderr.write(`[bah] Exchange: ${EXCHANGE}, Timeframe: ${TIMEFRAME}\n`);
  process.stderr.write(`[bah] Capital: $${INITIAL_CAPITAL.toLocaleString()}\n\n`);

  const rows: BenchmarkRow[] = [];

  for (const config of CONFIGS) {
    const bah = await calcBuyAndHold(config);
    rows.push({ config, bah });
  }

  printComparisonTable(rows);

  await closeDb();
}

main().catch((err) => {
  process.stderr.write(`\n[bah] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  closeDb().catch(() => {});
  process.exit(1);
});
