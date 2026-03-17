#!/usr/bin/env node
/**
 * V2 vs V3 Regime Comparison
 *
 * Runs funding-rate-spike-v2 (baseline) and funding-rate-spike-v3 (BTC SMA200
 * regime filter) across all 5 regimes and 17 symbols, then prints a side-by-side
 * comparison to show how much the regime filter improves bear-market performance
 * without hurting bull-market returns.
 *
 * Usage:
 *   npx tsx scripts/compare-v2-v3-regimes.ts
 *
 * Output: progress on stderr, comparison tables on stdout
 */

import { runBacktest, createBacktestConfig } from '../src/core/engine.js';
import { closeDb, initDb, getPool } from '../src/data/db.js';
import { loadStrategy, clearStrategyCache } from '../src/strategy/loader.js';
import type { PerformanceMetrics } from '../src/core/types.js';

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
  exchange: string;
}

const REGIMES: Regime[] = [
  { label: 'Bear 2022 H1 (Luna)', short: 'Bear22H1', start: '2022-01-01', end: '2022-06-30', exchange: 'binance' },
  { label: 'Bear 2022 H2 (FTX)',  short: 'Bear22H2', start: '2022-07-01', end: '2022-12-31', exchange: 'binance' },
  { label: 'Recovery 2023',       short: 'Recov23',  start: '2023-01-01', end: '2023-12-31', exchange: 'bybit'   },
  { label: 'Bull 2024',           short: 'Bull24',   start: '2024-01-01', end: '2024-12-31', exchange: 'bybit'   },
  { label: 'Bull 2025+',          short: 'Bull25+',  start: '2025-01-01', end: '2026-03-01', exchange: 'bybit'   },
];

const BEAR_REGIMES = new Set(['Bear22H1', 'Bear22H2']);
const BULL_REGIMES = new Set(['Recov23', 'Bull24', 'Bull25+']);

const INITIAL_CAPITAL = 10000;
const TIMEFRAME = '4h' as const;

// ============================================================================
// BTC daily candle loading
// ============================================================================

interface BtcCandle {
  timestamp: number;
  close: number;
}

async function loadBtcDailyCandles(): Promise<BtcCandle[]> {
  const p = getPool();

  // Try multiple symbol/exchange combos in order of preference
  const candidates: Array<[string, string]> = [
    ['binance', 'BTC/USDT:USDT'],
    ['binance', 'BTC/USDT'],
    ['bybit',   'BTC/USDT:USDT'],
    ['bybit',   'BTC/USDT'],
  ];

  for (const [exchange, symbol] of candidates) {
    const { rows } = await p.query<{ timestamp: string; close: string }>(
      `SELECT timestamp, close FROM candles
       WHERE exchange=$1 AND symbol=$2 AND timeframe='1d'
       ORDER BY timestamp`,
      [exchange, symbol]
    );
    if (rows.length > 200) {
      console.error(`Loaded ${rows.length} BTC daily candles from DB (${exchange} ${symbol})`);
      return rows.map(r => ({ timestamp: Number(r.timestamp), close: Number(r.close) }));
    }
  }

  // Not in DB — fetch from Binance USDM via CCXT and cache
  console.error('BTC daily candles not found in DB — fetching from Binance USDM via CCXT...');
  try {
    // Dynamic import to avoid loading CCXT at module level
    const ccxt = await import('ccxt');
    const exchange = new ccxt.binanceusdm({ enableRateLimit: true });

    const startMs = new Date('2021-01-01').getTime();
    const endMs   = new Date('2026-03-01').getTime();
    const limit   = 1000;
    const candles: BtcCandle[] = [];
    let since = startMs;

    while (since < endMs) {
      const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '1d', since, limit);
      if (!ohlcv || ohlcv.length === 0) break;
      for (const bar of ohlcv) {
        const ts = bar[0] as number;
        const cl = bar[4] as number;
        if (ts >= startMs && ts <= endMs) {
          candles.push({ timestamp: ts, close: cl });
        }
      }
      const lastTs = ohlcv[ohlcv.length - 1][0] as number;
      if (lastTs <= since) break;
      since = lastTs + 24 * 60 * 60 * 1000;
      await new Promise(r => setTimeout(r, 200));
    }

    // Deduplicate and sort
    const seen = new Set<number>();
    const unique = candles.filter(c => {
      if (seen.has(c.timestamp)) return false;
      seen.add(c.timestamp);
      return true;
    }).sort((a, b) => a.timestamp - b.timestamp);

    console.error(`Fetched ${unique.length} BTC daily candles from Binance USDM`);

    // Cache them in DB
    if (unique.length > 0) {
      const p2 = getPool();
      for (const c of unique) {
        await p2.query(
          `INSERT INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
           VALUES ('binance', 'BTC/USDT:USDT', '1d', $1, $2, $2, $2, $3, 0)
           ON CONFLICT DO NOTHING`,
          [c.timestamp, c.close, c.close]
        );
      }
      console.error('Cached BTC daily candles to DB');
    }

    return unique;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch BTC daily candles: ${msg}`);
  }
}

// ============================================================================
// Result types
// ============================================================================

interface RunResult {
  symbol: string;
  regime: string;
  sharpe: number;
  returnPct: number;
  maxDdPct: number;
  trades: number;
  longTrades: number;
  longPnl: number;
  shortTrades: number;
  shortPnl: number;
  hasError: boolean;
  error?: string;
}

interface PairResult {
  symbol: string;
  regime: string;
  v2: RunResult;
  v3: RunResult;
}

// ============================================================================
// Backtest runner
// ============================================================================

async function runOne(
  symbol: string,
  regime: Regime,
  strategyName: string,
  btcCandles: BtcCandle[]
): Promise<RunResult> {
  // For v3 we need to inject BTC candles on a fresh strategy instance.
  // loadStrategy caches by name, so clear the v3 cache before each load.
  let preloadedStrategy: import('../src/strategy/base.js').Strategy | undefined;
  if (strategyName === 'funding-rate-spike-v3') {
    clearStrategyCache();
    preloadedStrategy = await loadStrategy('funding-rate-spike-v3');
    (preloadedStrategy as unknown as { _btcDailyCandles: BtcCandle[] })._btcDailyCandles =
      btcCandles;
  }

  const config = createBacktestConfig({
    strategyName,
    symbol,
    timeframe: TIMEFRAME,
    startDate: new Date(regime.start).getTime(),
    endDate: new Date(regime.end).getTime(),
    initialCapital: INITIAL_CAPITAL,
    exchange: regime.exchange,
    params: {},
    mode: 'futures',
  });

  const result = await runBacktest(config, {
    preloadedStrategy,
    enableLogging: false,
    saveResults: false,
    skipFeeFetch: true,
    broker: {
      feeRate: 0.00055,
      slippagePercent: 0.05,
    },
  });

  const m: PerformanceMetrics = result.metrics;
  const closeLongs  = result.trades.filter(t => t.action === 'CLOSE_LONG');
  const closeShorts = result.trades.filter(t => t.action === 'CLOSE_SHORT');
  const longPnl  = closeLongs.reduce((s, t)  => s + (t.pnl ?? 0), 0);
  const shortPnl = closeShorts.reduce((s, t) => s + (t.pnl ?? 0), 0);

  return {
    symbol,
    regime: regime.short,
    sharpe: m.sharpeRatio,
    returnPct: m.totalReturnPercent,
    maxDdPct: m.maxDrawdownPercent,
    trades: m.totalTrades,
    longTrades: closeLongs.length,
    longPnl,
    shortTrades: closeShorts.length,
    shortPnl,
    hasError: false,
  };
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

function fmtSharpe(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPnl(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(0)}`;
}

function delta(v2: number, v3: number): string {
  if (!isFinite(v2) || !isFinite(v3)) return 'N/A';
  const d = v3 - v2;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}`;
}

function sep(len: number): string { return '-'.repeat(len); }

// ============================================================================
// Table 1: Side-by-side Sharpe comparison by symbol × regime
// ============================================================================

function printSharpeComparisonTable(pairs: PairResult[]): void {
  // Layout: Symbol | Bear22H1 v2 v3 | Bear22H2 v2 v3 | Recov23 v2 v3 | Bull24 v2 v3 | Bull25+ v2 v3
  const C = 7; // column width per v2/v3 cell

  const regimeCols = REGIMES.map(r => r.short);

  // Header line 1 — regime names spanning 2 cells each
  const headerLine1Parts = [lpad('Symbol', 12)];
  for (const short of regimeCols) {
    const cell = short.padEnd(C * 2 + 3); // two cells + spaces
    headerLine1Parts.push(cell);
  }
  const headerLine1 = headerLine1Parts.join('  ');

  // Header line 2 — v2 / v3 sub-headers
  const headerLine2Parts = [lpad('', 12)];
  for (let i = 0; i < regimeCols.length; i++) {
    headerLine2Parts.push(rpad('v2', C) + '  ' + rpad('v3', C));
  }
  const headerLine2 = headerLine2Parts.join('  ');

  const width = Math.max(headerLine1.length, headerLine2.length);

  console.log('\n' + '='.repeat(width));
  console.log('  SHARPE RATIO: v2 vs v3 (BTC SMA200 Regime Filter)');
  console.log('='.repeat(width));
  console.log(headerLine1);
  console.log(headerLine2);
  console.log(sep(width));

  // Collect per-regime averages
  const regimeSharpeV2: Record<string, number[]> = {};
  const regimeSharpeV3: Record<string, number[]> = {};
  for (const r of regimeCols) {
    regimeSharpeV2[r] = [];
    regimeSharpeV3[r] = [];
  }

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');
    const cells: string[] = [];

    for (const r of regimeCols) {
      const pair = pairs.find(p => p.symbol === symbol && p.regime === r);
      if (!pair || pair.v2.hasError || pair.v3.hasError) {
        cells.push(rpad('N/A', C) + '  ' + rpad('N/A', C));
        continue;
      }
      regimeSharpeV2[r].push(pair.v2.sharpe);
      regimeSharpeV3[r].push(pair.v3.sharpe);
      cells.push(rpad(fmtSharpe(pair.v2.sharpe), C) + '  ' + rpad(fmtSharpe(pair.v3.sharpe), C));
    }

    console.log([lpad(symbolShort, 12), ...cells].join('  '));
  }

  // Averages row
  console.log(sep(width));
  const avgCells: string[] = [];
  for (const r of regimeCols) {
    const v2arr = regimeSharpeV2[r];
    const v3arr = regimeSharpeV3[r];
    const avgV2 = v2arr.length > 0 ? v2arr.reduce((s, v) => s + v, 0) / v2arr.length : NaN;
    const avgV3 = v3arr.length > 0 ? v3arr.reduce((s, v) => s + v, 0) / v3arr.length : NaN;
    avgCells.push(rpad(fmtSharpe(avgV2), C) + '  ' + rpad(fmtSharpe(avgV3), C));
  }
  console.log([lpad('AVG', 12), ...avgCells].join('  '));
  console.log('='.repeat(width));
}

// ============================================================================
// Table 2: Aggregate comparison summary
// ============================================================================

function printAggregateSummary(pairs: PairResult[]): void {
  const valid = pairs.filter(p => !p.v2.hasError && !p.v3.hasError);
  const bearPairs = valid.filter(p => BEAR_REGIMES.has(p.regime));
  const bullPairs = valid.filter(p => BULL_REGIMES.has(p.regime));

  const avgSharpe = (arr: RunResult[]) =>
    arr.length > 0 ? arr.reduce((s, r) => s + r.sharpe, 0) / arr.length : NaN;
  const totalTrades = (arr: RunResult[]) => arr.reduce((s, r) => s + r.trades, 0);
  const totalPnl = (arr: RunResult[]) =>
    arr.reduce((s, r) => s + r.longPnl + r.shortPnl, 0);

  const allV2  = valid.map(p => p.v2);
  const allV3  = valid.map(p => p.v3);
  const bearV2 = bearPairs.map(p => p.v2);
  const bearV3 = bearPairs.map(p => p.v3);
  const bullV2 = bullPairs.map(p => p.v2);
  const bullV3 = bullPairs.map(p => p.v3);

  const rows: Array<[string, string, string, string]> = [
    ['Metric',         'v2',                     'v3',                     'Delta'],
    ['Avg Sharpe (all)', fmtSharpe(avgSharpe(allV2)), fmtSharpe(avgSharpe(allV3)), delta(avgSharpe(allV2), avgSharpe(allV3))],
    ['Avg Sharpe (bear)', fmtSharpe(avgSharpe(bearV2)), fmtSharpe(avgSharpe(bearV3)), delta(avgSharpe(bearV2), avgSharpe(bearV3))],
    ['Avg Sharpe (bull)', fmtSharpe(avgSharpe(bullV2)), fmtSharpe(avgSharpe(bullV3)), delta(avgSharpe(bullV2), avgSharpe(bullV3))],
    ['Total Trades (all)', String(totalTrades(allV2)), String(totalTrades(allV3)), String(totalTrades(allV3) - totalTrades(allV2))],
    ['Total Trades (bear)', String(totalTrades(bearV2)), String(totalTrades(bearV3)), String(totalTrades(bearV3) - totalTrades(bearV2))],
    ['Total Trades (bull)', String(totalTrades(bullV2)), String(totalTrades(bullV3)), String(totalTrades(bullV3) - totalTrades(bullV2))],
    ['Total PnL (all)', fmtPnl(totalPnl(allV2)), fmtPnl(totalPnl(allV3)), fmtPnl(totalPnl(allV3) - totalPnl(allV2))],
    ['Total PnL (bear)', fmtPnl(totalPnl(bearV2)), fmtPnl(totalPnl(bearV3)), fmtPnl(totalPnl(bearV3) - totalPnl(bearV2))],
    ['Total PnL (bull)', fmtPnl(totalPnl(bullV2)), fmtPnl(totalPnl(bullV3)), fmtPnl(totalPnl(bullV3) - totalPnl(bullV2))],
  ];

  const C1 = 22;
  const C2 = 12;

  const header = lpad(rows[0][0], C1) + '  ' + rpad(rows[0][1], C2) + '  ' + rpad(rows[0][2], C2) + '  ' + rpad(rows[0][3], C2);
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  AGGREGATE COMPARISON SUMMARY');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const [metric, v2val, v3val, dval] of rows.slice(1)) {
    console.log(
      lpad(metric, C1) + '  ' +
      rpad(v2val, C2) + '  ' +
      rpad(v3val, C2) + '  ' +
      rpad(dval, C2)
    );
  }
  console.log('='.repeat(width));
}

// ============================================================================
// Table 3: Per-regime detail (v2 vs v3 side by side)
// ============================================================================

function printRegimeDetailTable(pairs: PairResult[], regime: Regime): void {
  const regimePairs = pairs.filter(p => p.regime === regime.short);
  const C = 9;

  const header = [
    lpad('Symbol', 12),
    rpad('v2Sharpe', C), rpad('v3Sharpe', C),
    rpad('v2Ret%', C),   rpad('v3Ret%', C),
    rpad('v2Trd', 6),    rpad('v3Trd', 6),
    rpad('v2DD%', 7),    rpad('v3DD%', 7),
  ].join('  ');
  const width = header.length;

  console.log(`\n--- ${regime.label} (${regime.start} -> ${regime.end}, exchange: ${regime.exchange}) ---`);
  console.log(sep(width));
  console.log(header);
  console.log(sep(width));

  const validPairs: PairResult[] = [];
  for (const pair of regimePairs) {
    const symbolShort = pair.symbol.replace('/USDT:USDT', '');
    if (pair.v2.hasError || pair.v3.hasError) {
      console.log(`${lpad(symbolShort, 12)}  ${'N/A (error)'.padEnd(width - 14)}`);
      continue;
    }
    validPairs.push(pair);
    const { v2, v3 } = pair;
    console.log([
      lpad(symbolShort, 12),
      rpad(fmtSharpe(v2.sharpe), C),   rpad(fmtSharpe(v3.sharpe), C),
      rpad(fmtPct(v2.returnPct), C),    rpad(fmtPct(v3.returnPct), C),
      rpad(String(v2.trades), 6),        rpad(String(v3.trades), 6),
      rpad(`${v2.maxDdPct.toFixed(1)}%`, 7), rpad(`${v3.maxDdPct.toFixed(1)}%`, 7),
    ].join('  '));
  }

  if (validPairs.length > 0) {
    const avgV2S = validPairs.reduce((s, p) => s + p.v2.sharpe, 0) / validPairs.length;
    const avgV3S = validPairs.reduce((s, p) => s + p.v3.sharpe, 0) / validPairs.length;
    const avgV2R = validPairs.reduce((s, p) => s + p.v2.returnPct, 0) / validPairs.length;
    const avgV3R = validPairs.reduce((s, p) => s + p.v3.returnPct, 0) / validPairs.length;
    const totV2T = validPairs.reduce((s, p) => s + p.v2.trades, 0);
    const totV3T = validPairs.reduce((s, p) => s + p.v3.trades, 0);
    const avgV2D = validPairs.reduce((s, p) => s + p.v2.maxDdPct, 0) / validPairs.length;
    const avgV3D = validPairs.reduce((s, p) => s + p.v3.maxDdPct, 0) / validPairs.length;

    console.log(sep(width));
    console.log([
      lpad(`AVG(${validPairs.length})`, 12),
      rpad(fmtSharpe(avgV2S), C), rpad(fmtSharpe(avgV3S), C),
      rpad(fmtPct(avgV2R), C),    rpad(fmtPct(avgV3R), C),
      rpad(String(totV2T), 6),     rpad(String(totV3T), 6),
      rpad(`${avgV2D.toFixed(1)}%`, 7), rpad(`${avgV3D.toFixed(1)}%`, 7),
    ].join('  '));
  }

  console.log(sep(width));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  await initDb();

  // Load BTC daily candles once for all v3 runs
  const btcCandles = await loadBtcDailyCandles();
  if (btcCandles.length < 200) {
    throw new Error(
      `Only ${btcCandles.length} BTC daily candles loaded — need at least 200 for SMA200`
    );
  }
  console.error(`BTC daily candle range: ${new Date(btcCandles[0].timestamp).toISOString().slice(0,10)} to ${new Date(btcCandles[btcCandles.length - 1].timestamp).toISOString().slice(0,10)}`);

  const totalSymbols = SYMBOLS.length;
  const totalRegimes = REGIMES.length;
  const totalRuns = totalSymbols * totalRegimes * 2; // v2 + v3
  let completed = 0;

  console.error('');
  console.error('='.repeat(70));
  console.error('  V2 vs V3 REGIME COMPARISON');
  console.error('='.repeat(70));
  console.error(`  Symbols  : ${totalSymbols}`);
  console.error(`  Regimes  : ${totalRegimes}`);
  console.error(`  Runs     : ${totalRuns} (${totalSymbols * totalRegimes} per strategy)`);
  console.error('='.repeat(70));
  console.error('');

  const allPairs: PairResult[] = [];

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');

    for (const regime of REGIMES) {
      const prefix = `[${String(Math.floor(completed / 2) + 1).padStart(String(totalSymbols * totalRegimes).length)}/${totalSymbols * totalRegimes}] ${symbolShort.padEnd(10)} ${regime.short.padEnd(9)}`;

      // Run v2
      let v2Result: RunResult;
      try {
        completed++;
        v2Result = await runOne(symbol, regime, 'funding-rate-spike-v2', btcCandles);
      } catch (err) {
        completed++;
        const msg = err instanceof Error ? err.message : String(err);
        v2Result = {
          symbol, regime: regime.short,
          sharpe: NaN, returnPct: NaN, maxDdPct: NaN,
          trades: 0, longTrades: 0, longPnl: 0, shortTrades: 0, shortPnl: 0,
          hasError: true, error: msg,
        };
      }

      // Run v3
      let v3Result: RunResult;
      try {
        completed++;
        v3Result = await runOne(symbol, regime, 'funding-rate-spike-v3', btcCandles);
      } catch (err) {
        completed++;
        const msg = err instanceof Error ? err.message : String(err);
        v3Result = {
          symbol, regime: regime.short,
          sharpe: NaN, returnPct: NaN, maxDdPct: NaN,
          trades: 0, longTrades: 0, longPnl: 0, shortTrades: 0, shortPnl: 0,
          hasError: true, error: msg,
        };
      }

      allPairs.push({ symbol, regime: regime.short, v2: v2Result, v3: v3Result });

      const v2s = v2Result.hasError ? 'ERR' : fmtSharpe(v2Result.sharpe).padStart(7);
      const v3s = v3Result.hasError ? 'ERR' : fmtSharpe(v3Result.sharpe).padStart(7);
      const v2t = v2Result.hasError ? '?' : String(v2Result.trades).padStart(3);
      const v3t = v3Result.hasError ? '?' : String(v3Result.trades).padStart(3);
      console.error(`${prefix} -> v2: ${v2s} (${v2t} trades)  v3: ${v3s} (${v3t} trades)`);
    }
  }

  // ============================================================================
  // Print output tables
  // ============================================================================

  console.log('');
  console.log('='.repeat(70));
  console.log('  V2 vs V3 COMPARISON RESULTS — funding-rate-spike v2 / v3 / 4h');
  console.log('='.repeat(70));

  // Per-regime detail tables
  for (const regime of REGIMES) {
    printRegimeDetailTable(allPairs, regime);
  }

  // Sharpe comparison matrix
  printSharpeComparisonTable(allPairs);

  // Aggregate summary
  printAggregateSummary(allPairs);

  // Error summary
  const errPairs = allPairs.filter(p => p.v2.hasError || p.v3.hasError);
  if (errPairs.length > 0) {
    console.log(`\n--- Runs with errors (${errPairs.length}) ---`);
    for (const pair of errPairs) {
      const sym = pair.symbol.replace('/USDT:USDT', '');
      if (pair.v2.hasError) {
        console.log(`  v2  ${sym.padEnd(12)} ${pair.regime.padEnd(10)} ${(pair.v2.error ?? 'unknown').slice(0, 80)}`);
      }
      if (pair.v3.hasError) {
        console.log(`  v3  ${sym.padEnd(12)} ${pair.regime.padEnd(10)} ${(pair.v3.error ?? 'unknown').slice(0, 80)}`);
      }
    }
  }

  console.log('');

  await closeDb();
}

main().catch(err => {
  console.error('Fatal error:', err);
  void closeDb();
  process.exit(1);
});
