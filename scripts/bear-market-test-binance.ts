#!/usr/bin/env node
/**
 * Bear Market Test — Binance Futures
 *
 * Phase 1: Fetches 2022 candle and funding rate data from Binance Futures
 *          (exchange='binance') and caches it in the database.
 *
 * Phase 2: Runs funding-rate-spike-v2 backtests for Bear 2022 H1 and H2
 *          using the cached binance data and prints a summary table.
 *
 * Usage:
 *   npx tsx scripts/bear-market-test-binance.ts              # fetch + backtest
 *   npx tsx scripts/bear-market-test-binance.ts --fetch-only
 *   npx tsx scripts/bear-market-test-binance.ts --backtest-only
 *
 * Progress goes to stderr, final table goes to stdout.
 */

import ccxt from 'ccxt';
import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import {
  initDb,
  closeDb,
  saveCandlesBulk,
  getCandleDateRange,
  getFundingRateDateRange,
  saveFundingRates,
} from '../src/data/db.js';
import type { Candle, FundingRate, PerformanceMetrics } from '../src/core/types.js';

// ============================================================================
// Configuration
// ============================================================================

const SYMBOLS: string[] = [
  'LDO/USDT:USDT',
  'DOGE/USDT:USDT',
  'ARB/USDT:USDT',
  'IOST/USDT:USDT',
  'ZEC/USDT:USDT',
  'IMX/USDT:USDT',
  'ICP/USDT:USDT',
  'XLM/USDT:USDT',
  'NEAR/USDT:USDT',
  'TRB/USDT:USDT',
  'STG/USDT:USDT',
  'COMP/USDT:USDT',
  'IOTA/USDT:USDT',
  'COTI/USDT:USDT',
  'APT/USDT:USDT',
  'BCH/USDT:USDT',
  'ENJ/USDT:USDT',
];

interface Regime {
  label: string;
  short: string;
  start: string;
  end: string;
}

// Only the 2022 bear market periods
const REGIMES: Regime[] = [
  { label: 'Bear 2022 H1 (Luna)', short: 'Bear22H1', start: '2022-01-01', end: '2022-06-30' },
  { label: 'Bear 2022 H2 (FTX)',  short: 'Bear22H2', start: '2022-07-01', end: '2022-12-31' },
];

// Fetch range covers full 2022
const FETCH_START = new Date('2022-01-01T00:00:00Z').getTime();
const FETCH_END   = new Date('2022-12-31T23:59:59Z').getTime();

const INITIAL_CAPITAL = 10000;
const TIMEFRAME = '4h' as const;
const EXCHANGE = 'binance';

// ============================================================================
// CCXT helpers
// ============================================================================

async function fetchAllCandles(
  exchange: ccxt.Exchange,
  symbol: string,
  timeframe: string,
  start: number,
  end: number
): Promise<number[][]> {
  const all: number[][] = [];
  let since = start;
  const limit = 1000; // Binance USDM returns max 1000 per request

  while (since < end) {
    const batch = await exchange.fetchOHLCV(symbol, timeframe, since, limit) as number[][];
    if (batch.length === 0) break;

    // Filter to requested range
    for (const c of batch) {
      if (c[0] <= end) all.push(c);
    }

    const lastTs = batch[batch.length - 1][0];
    if (lastTs >= end) break; // reached the end of requested range
    since = lastTs + 1;
    if (batch.length < 10) break; // truly no more data (tiny remainder)
  }

  return all;
}

async function fetchAllFundingRates(
  exchange: ccxt.Exchange,
  symbol: string,
  start: number,
  end: number
): Promise<Array<{ timestamp: number; fundingRate: number; markPrice?: number }>> {
  const all: Array<{ timestamp: number; fundingRate: number; markPrice?: number }> = [];
  let since = start;
  const limit = 1000;

  while (since < end) {
    const batch = await exchange.fetchFundingRateHistory(symbol, since, limit);
    if (batch.length === 0) break;

    for (const r of batch) {
      const ts = r.timestamp ?? 0;
      if (ts <= end) {
        all.push({
          timestamp: ts,
          fundingRate: r.fundingRate ?? 0,
          markPrice: undefined,
        });
      }
    }

    const lastTs = batch[batch.length - 1].timestamp ?? 0;
    since = lastTs + 1;
    if (batch.length < limit) break;
  }

  return all;
}

// ============================================================================
// Phase 1: Fetch and cache data
// ============================================================================

async function fetchAndCache(
  exchange: ccxt.Exchange,
  symbol: string
): Promise<{ candlesFetched: number; frFetched: number; skippedCandles: boolean; skippedFr: boolean }> {
  let candlesFetched = 0;
  let frFetched = 0;
  let skippedCandles = false;
  let skippedFr = false;

  // -- Candles --
  const candleRange = await getCandleDateRange(EXCHANGE, symbol, TIMEFRAME);
  const candlesCovered =
    candleRange.start !== null &&
    candleRange.start <= FETCH_START &&
    candleRange.end !== null &&
    candleRange.end >= FETCH_END - 4 * 60 * 60 * 1000; // allow one bar gap at end

  if (candlesCovered) {
    skippedCandles = true;
  } else {
    const raw = await fetchAllCandles(exchange, symbol, TIMEFRAME, FETCH_START, FETCH_END);
    if (raw.length > 0) {
      const candles: Candle[] = raw.map((c) => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      }));
      candlesFetched = await saveCandlesBulk(candles, EXCHANGE, symbol, TIMEFRAME);
    }
  }

  // -- Funding rates --
  const frRange = await getFundingRateDateRange(EXCHANGE, symbol);
  const frCovered =
    frRange.start !== null &&
    frRange.start <= FETCH_START &&
    frRange.end !== null &&
    frRange.end >= FETCH_END - 8 * 60 * 60 * 1000; // allow one FR interval gap at end

  if (frCovered) {
    skippedFr = true;
  } else {
    const rawFr = await fetchAllFundingRates(exchange, symbol, FETCH_START, FETCH_END);
    if (rawFr.length > 0) {
      const rates: FundingRate[] = rawFr.map((r) => ({
        timestamp: r.timestamp,
        fundingRate: r.fundingRate,
        markPrice: r.markPrice,
      }));
      frFetched = await saveFundingRates(rates, EXCHANGE, symbol);
    }
  }

  return { candlesFetched, frFetched, skippedCandles, skippedFr };
}

// ============================================================================
// Phase 2: Backtesting
// ============================================================================

interface RunResult {
  symbol: string;
  regime: string;
  sharpe: number;
  returnPct: number;
  maxDdPct: number;
  trades: number;
  winRate: number;
  longTrades: number;
  longPnl: number;
  shortTrades: number;
  shortPnl: number;
  hasError: boolean;
  error?: string;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function pad(s: string, width: number, right = false): string {
  const str = String(s);
  if (str.length >= width) return str.slice(0, width);
  const fill = ' '.repeat(width - str.length);
  return right ? fill + str : str + fill;
}

function lpad(s: string, w: number): string { return pad(s, w, false); }
function rpad(s: string, w: number): string { return pad(s, w, true); }

function fmtNum(n: number, dp = 2): string {
  return isFinite(n) ? n.toFixed(dp) : 'N/A';
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtSharpe(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function fmtPnl(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(0)}`;
}

function sep(len: number): string { return '-'.repeat(len); }

// ============================================================================
// Per-regime table
// ============================================================================

function printRegimeTable(results: RunResult[], regime: Regime): void {
  const rows = results.filter((r) => r.regime === regime.short);

  const header = [
    lpad('Symbol', 14),
    rpad('Sharpe', 8),
    rpad('Return%', 10),
    rpad('MaxDD%', 8),
    rpad('Trades', 7),
    rpad('WinR%', 7),
    rpad('LongN', 6),
    rpad('LongPnL', 9),
    rpad('ShortN', 7),
    rpad('ShortPnL', 9),
  ].join('  ');

  const width = header.length;
  console.log(`\n--- ${regime.label} (${regime.start} to ${regime.end}) ---`);
  console.log(sep(width));
  console.log(header);
  console.log(sep(width));

  const valid: RunResult[] = [];

  for (const r of rows) {
    const symbolShort = r.symbol.replace('/USDT:USDT', '');
    if (r.hasError) {
      console.log(`${lpad(symbolShort, 14)}  ${'N/A (no data or error)'.padEnd(width - 16)}`);
      continue;
    }
    valid.push(r);
    const line = [
      lpad(symbolShort, 14),
      rpad(fmtSharpe(r.sharpe), 8),
      rpad(fmtPct(r.returnPct), 10),
      rpad(`${fmtNum(r.maxDdPct)}%`, 8),
      rpad(String(r.trades), 7),
      rpad(`${fmtNum(r.winRate, 1)}%`, 7),
      rpad(String(r.longTrades), 6),
      rpad(fmtPnl(r.longPnl), 9),
      rpad(String(r.shortTrades), 7),
      rpad(fmtPnl(r.shortPnl), 9),
    ].join('  ');
    console.log(line);
  }

  if (valid.length > 0) {
    const avgSharpe   = valid.reduce((s, r) => s + r.sharpe, 0) / valid.length;
    const avgReturn   = valid.reduce((s, r) => s + r.returnPct, 0) / valid.length;
    const avgDd       = valid.reduce((s, r) => s + r.maxDdPct, 0) / valid.length;
    const totalTrades = valid.reduce((s, r) => s + r.trades, 0);
    const avgWin      = valid.reduce((s, r) => s + r.winRate, 0) / valid.length;
    const totalLong      = valid.reduce((s, r) => s + r.longTrades, 0);
    const totalLongPnl   = valid.reduce((s, r) => s + r.longPnl, 0);
    const totalShort     = valid.reduce((s, r) => s + r.shortTrades, 0);
    const totalShortPnl  = valid.reduce((s, r) => s + r.shortPnl, 0);

    console.log(sep(width));
    const avgLine = [
      lpad(`AVG (${valid.length}/${rows.length})`, 14),
      rpad(fmtSharpe(avgSharpe), 8),
      rpad(fmtPct(avgReturn), 10),
      rpad(`${fmtNum(avgDd)}%`, 8),
      rpad(String(totalTrades), 7),
      rpad(`${fmtNum(avgWin, 1)}%`, 7),
      rpad(String(totalLong), 6),
      rpad(fmtPnl(totalLongPnl), 9),
      rpad(String(totalShort), 7),
      rpad(fmtPnl(totalShortPnl), 9),
    ].join('  ');
    console.log(avgLine);
  }

  console.log(sep(width));
}

// ============================================================================
// Cross-regime Sharpe summary
// ============================================================================

function printCrossRegimeSummary(results: RunResult[]): void {
  const regimeCols = REGIMES.map((r) => r.short);
  const colWidth = 10;

  const header = [
    lpad('Symbol', 14),
    ...regimeCols.map((c) => rpad(c, colWidth)),
    rpad('AvgSharpe', colWidth),
  ].join('  ');

  const width = header.length;
  console.log('\n' + '='.repeat(width));
  console.log('  CROSS-REGIME SHARPE SUMMARY (one cell = Sharpe ratio)');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');
    const sharpeValues: number[] = [];

    const cells = regimeCols.map((regime) => {
      const row = results.find((r) => r.symbol === symbol && r.regime === regime);
      if (!row || row.hasError) return rpad('N/A', colWidth);
      sharpeValues.push(row.sharpe);
      return rpad(fmtSharpe(row.sharpe), colWidth);
    });

    const avg =
      sharpeValues.length > 0
        ? sharpeValues.reduce((s, v) => s + v, 0) / sharpeValues.length
        : NaN;
    const avgCell = rpad(isFinite(avg) ? fmtSharpe(avg) : 'N/A', colWidth);

    console.log([lpad(symbolShort, 14), ...cells, avgCell].join('  '));
  }

  console.log(sep(width));
  const avgCells = regimeCols.map((regime) => {
    const valid = results.filter((r) => r.regime === regime && !r.hasError);
    if (valid.length === 0) return rpad('N/A', colWidth);
    const avg = valid.reduce((s, r) => s + r.sharpe, 0) / valid.length;
    return rpad(fmtSharpe(avg), colWidth);
  });
  const allValid = results.filter((r) => !r.hasError);
  const grandAvg =
    allValid.length > 0 ? allValid.reduce((s, r) => s + r.sharpe, 0) / allValid.length : NaN;
  console.log([
    lpad('REGIME AVG', 14),
    ...avgCells,
    rpad(isFinite(grandAvg) ? fmtSharpe(grandAvg) : 'N/A', colWidth),
  ].join('  '));
  console.log('='.repeat(width));
}

// ============================================================================
// Long vs Short breakdown
// ============================================================================

function printLongShortBreakdown(results: RunResult[]): void {
  const header = [
    lpad('Regime', 16),
    rpad('LongTrades', 11),
    rpad('LongPnL', 10),
    rpad('ShortTrades', 12),
    rpad('ShortPnL', 10),
    rpad('L/S Ratio', 10),
    rpad('Direction', 10),
  ].join('  ');

  const width = header.length;
  console.log('\n' + '='.repeat(width));
  console.log('  LONG vs SHORT BREAKDOWN BY REGIME');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const regime of REGIMES) {
    const valid = results.filter((r) => r.regime === regime.short && !r.hasError);
    if (valid.length === 0) {
      console.log(`${lpad(regime.short, 16)}  ${'(no data)'.padEnd(width - 18)}`);
      continue;
    }

    const totalLong      = valid.reduce((s, r) => s + r.longTrades, 0);
    const totalShort     = valid.reduce((s, r) => s + r.shortTrades, 0);
    const totalLongPnl   = valid.reduce((s, r) => s + r.longPnl, 0);
    const totalShortPnl  = valid.reduce((s, r) => s + r.shortPnl, 0);
    const lsRatio        = totalShort > 0 ? totalLong / totalShort : Infinity;
    const direction      = totalLongPnl > totalShortPnl ? 'Long-biased' : 'Short-biased';

    const line = [
      lpad(regime.short, 16),
      rpad(String(totalLong), 11),
      rpad(fmtPnl(totalLongPnl), 10),
      rpad(String(totalShort), 12),
      rpad(fmtPnl(totalShortPnl), 10),
      rpad(isFinite(lsRatio) ? lsRatio.toFixed(2) : 'inf', 10),
      rpad(direction, 10),
    ].join('  ');
    console.log(line);
  }

  console.log(sep(width));
  const allValid      = results.filter((r) => !r.hasError);
  const totalLong     = allValid.reduce((s, r) => s + r.longTrades, 0);
  const totalShort    = allValid.reduce((s, r) => s + r.shortTrades, 0);
  const totalLongPnl  = allValid.reduce((s, r) => s + r.longPnl, 0);
  const totalShortPnl = allValid.reduce((s, r) => s + r.shortPnl, 0);
  const lsRatio       = totalShort > 0 ? totalLong / totalShort : Infinity;
  const direction     = totalLongPnl > totalShortPnl ? 'Long-biased' : 'Short-biased';

  console.log([
    lpad('OVERALL', 16),
    rpad(String(totalLong), 11),
    rpad(fmtPnl(totalLongPnl), 10),
    rpad(String(totalShort), 12),
    rpad(fmtPnl(totalShortPnl), 10),
    rpad(isFinite(lsRatio) ? lsRatio.toFixed(2) : 'inf', 10),
    rpad(direction, 10),
  ].join('  '));
  console.log('='.repeat(width));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fetchOnly    = args.includes('--fetch-only');
  const backtestOnly = args.includes('--backtest-only');

  await initDb();

  // ---- Phase 1: Fetch -------------------------------------------------------

  if (!backtestOnly) {
    console.error('');
    console.error('='.repeat(70));
    console.error('  PHASE 1: FETCHING 2022 DATA FROM BINANCE FUTURES');
    console.error('='.repeat(70));
    console.error(`  Symbols  : ${SYMBOLS.length}`);
    console.error(`  Period   : 2022-01-01 to 2022-12-31`);
    console.error(`  Timeframe: ${TIMEFRAME}`);
    console.error('='.repeat(70));
    console.error('');

    const exchange = new ccxt.binanceusdm({ enableRateLimit: true });
    await exchange.loadMarkets();

    for (let i = 0; i < SYMBOLS.length; i++) {
      const symbol = SYMBOLS[i];
      const symbolShort = symbol.replace('/USDT:USDT', '');
      const prefix = `[${String(i + 1).padStart(String(SYMBOLS.length).length)}/${SYMBOLS.length}] ${symbolShort.padEnd(10)}`;

      try {
        const { candlesFetched, frFetched, skippedCandles, skippedFr } =
          await fetchAndCache(exchange, symbol);

        const candleMsg = skippedCandles ? 'candles: cached' : `candles: +${candlesFetched}`;
        const frMsg     = skippedFr      ? 'FR: cached'     : `FR: +${frFetched}`;
        console.error(`${prefix} -> ${candleMsg}  ${frMsg}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const short = msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
        console.error(`${prefix} -> SKIPPED: ${short}`);
      }
    }

    console.error('');
    console.error('Phase 1 complete.');
    console.error('');
  }

  if (fetchOnly) {
    await closeDb();
    return;
  }

  // ---- Phase 2: Backtests ---------------------------------------------------

  const totalRuns = SYMBOLS.length * REGIMES.length;
  let completed = 0;

  console.error('='.repeat(70));
  console.error('  PHASE 2: BACKTESTING — funding-rate-spike-v2 / binance / 4h');
  console.error('='.repeat(70));
  console.error(`  Symbols  : ${SYMBOLS.length}`);
  console.error(`  Regimes  : ${REGIMES.length} (Bear 2022 H1, Bear 2022 H2)`);
  console.error(`  Total    : ${totalRuns} runs`);
  console.error(`  Capital  : $${INITIAL_CAPITAL.toLocaleString()}`);
  console.error('='.repeat(70));
  console.error('');

  const allResults: RunResult[] = [];

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');

    for (const regime of REGIMES) {
      completed++;
      const prefix =
        `[${String(completed).padStart(String(totalRuns).length)}/${totalRuns}] ` +
        `${symbolShort.padEnd(10)} ${regime.short.padEnd(9)}`;

      try {
        const config = createBacktestConfig({
          strategyName: 'funding-rate-spike-v2',
          symbol,
          timeframe: TIMEFRAME,
          startDate: new Date(regime.start).getTime(),
          endDate: new Date(regime.end).getTime(),
          initialCapital: INITIAL_CAPITAL,
          exchange: EXCHANGE,
          params: {},
          mode: 'futures',
        });

        const result = await runBacktest(config, {
          enableLogging: false,
          saveResults: false,
          skipFeeFetch: true,
          broker: {
            feeRate: 0.00055,
            slippagePercent: 0.05,
          },
        });

        const m: PerformanceMetrics = result.metrics;

        const closeLongs  = result.trades.filter((t) => t.action === 'CLOSE_LONG');
        const closeShorts = result.trades.filter((t) => t.action === 'CLOSE_SHORT');
        const longPnl     = closeLongs.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
        const shortPnl    = closeShorts.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

        const row: RunResult = {
          symbol,
          regime: regime.short,
          sharpe: m.sharpeRatio,
          returnPct: m.totalReturnPercent,
          maxDdPct: m.maxDrawdownPercent,
          trades: m.totalTrades,
          winRate: m.winRate,
          longTrades: closeLongs.length,
          longPnl,
          shortTrades: closeShorts.length,
          shortPnl,
          hasError: false,
        };
        allResults.push(row);

        console.error(
          `${prefix} -> Sharpe: ${fmtSharpe(m.sharpeRatio).padStart(7)}, ` +
          `Return: ${fmtPct(m.totalReturnPercent).padStart(9)}, ` +
          `Trades: ${String(m.totalTrades).padStart(3)} ` +
          `(L:${closeLongs.length} S:${closeShorts.length})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const displayMsg = msg.length > 60 ? msg.slice(0, 60) + '...' : msg;
        console.error(`${prefix} -> ERROR: ${displayMsg}`);
        allResults.push({
          symbol,
          regime: regime.short,
          sharpe: NaN,
          returnPct: NaN,
          maxDdPct: NaN,
          trades: 0,
          winRate: NaN,
          longTrades: 0,
          longPnl: 0,
          shortTrades: 0,
          shortPnl: 0,
          hasError: true,
          error: msg,
        });
      }
    }
  }

  // ---- Output ---------------------------------------------------------------

  console.log('');
  console.log('='.repeat(70));
  console.log('  BEAR MARKET TEST RESULTS — funding-rate-spike-v2 / 4h / binance');
  console.log('='.repeat(70));

  for (const regime of REGIMES) {
    printRegimeTable(allResults, regime);
  }

  printCrossRegimeSummary(allResults);
  printLongShortBreakdown(allResults);

  const errors = allResults.filter((r) => r.hasError);
  if (errors.length > 0) {
    console.log(`\n--- Skipped runs (${errors.length}) — no data or symbol not listed on Binance in 2022 ---`);
    for (const e of errors) {
      const symbolShort = e.symbol.replace('/USDT:USDT', '');
      const shortErr = (e.error ?? 'unknown').slice(0, 80);
      console.log(`  ${symbolShort.padEnd(12)} ${e.regime.padEnd(10)} ${shortErr}`);
    }
  }

  console.log('');

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  void closeDb();
  process.exit(1);
});
