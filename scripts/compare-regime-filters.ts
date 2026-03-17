#!/usr/bin/env node
/**
 * Regime Filter Comparison: V2 baseline vs V3-block with different MA periods/types
 *
 * Tests how the choice of regime filter (SMA200, SMA100, SMA50, EMA200, EMA100)
 * affects performance across bear, recovery, and bull regimes.
 *
 * Key question: does a faster MA (SMA100, EMA100) recover more bull/transition
 * profits while still blocking most bear losses?
 *
 * Usage:
 *   npx tsx scripts/compare-regime-filters.ts
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

interface FilterVariant {
  label: string;
  short: string;
  params: Record<string, unknown>;
}

const VARIANTS: FilterVariant[] = [
  { label: 'SMA200', short: 'S200', params: { bearMode: 'block', useRegimeFilter: true, regimeSMAPeriod: 200, regimeMAType: 'sma' } },
  { label: 'SMA100', short: 'S100', params: { bearMode: 'block', useRegimeFilter: true, regimeSMAPeriod: 100, regimeMAType: 'sma' } },
  { label: 'SMA50',  short: 'S50',  params: { bearMode: 'block', useRegimeFilter: true, regimeSMAPeriod: 50,  regimeMAType: 'sma' } },
  { label: 'EMA200', short: 'E200', params: { bearMode: 'block', useRegimeFilter: true, regimeSMAPeriod: 200, regimeMAType: 'ema' } },
  { label: 'EMA100', short: 'E100', params: { bearMode: 'block', useRegimeFilter: true, regimeSMAPeriod: 100, regimeMAType: 'ema' } },
];

// ============================================================================
// BTC daily candle loading
// ============================================================================

interface BtcCandle {
  timestamp: number;
  close: number;
}

async function loadBtcDailyCandles(): Promise<BtcCandle[]> {
  const p = getPool();

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

    const seen = new Set<number>();
    const unique = candles.filter(c => {
      if (seen.has(c.timestamp)) return false;
      seen.add(c.timestamp);
      return true;
    }).sort((a, b) => a.timestamp - b.timestamp);

    console.error(`Fetched ${unique.length} BTC daily candles from Binance USDM`);

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
  longPnl: number;
  shortPnl: number;
  hasError: boolean;
  error?: string;
}

interface RowResult {
  symbol: string;
  regime: string;
  v2: RunResult;
  variants: RunResult[];  // index matches VARIANTS
}

// ============================================================================
// Backtest runners
// ============================================================================

async function runV2(symbol: string, regime: Regime): Promise<RunResult> {
  const config = createBacktestConfig({
    strategyName: 'funding-rate-spike-v2',
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
    enableLogging: false,
    saveResults: false,
    skipFeeFetch: true,
    broker: { feeRate: 0.00055, slippagePercent: 0.05 },
  });

  return extractResult(symbol, regime.short, result);
}

async function runV3Variant(
  symbol: string,
  regime: Regime,
  variant: FilterVariant,
  btcCandles: BtcCandle[]
): Promise<RunResult> {
  clearStrategyCache();
  const strategy = await loadStrategy('funding-rate-spike-v3');
  (strategy as unknown as { _btcDailyCandles: BtcCandle[] })._btcDailyCandles = btcCandles;

  const config = createBacktestConfig({
    strategyName: 'funding-rate-spike-v3',
    symbol,
    timeframe: TIMEFRAME,
    startDate: new Date(regime.start).getTime(),
    endDate: new Date(regime.end).getTime(),
    initialCapital: INITIAL_CAPITAL,
    exchange: regime.exchange,
    params: variant.params,
    mode: 'futures',
  });

  const result = await runBacktest(config, {
    preloadedStrategy: strategy,
    enableLogging: false,
    saveResults: false,
    skipFeeFetch: true,
    broker: { feeRate: 0.00055, slippagePercent: 0.05 },
  });

  return extractResult(symbol, regime.short, result);
}

function extractResult(
  symbol: string,
  regimeShort: string,
  result: Awaited<ReturnType<typeof runBacktest>>
): RunResult {
  const m: PerformanceMetrics = result.metrics;
  const closeLongs  = result.trades.filter(t => t.action === 'CLOSE_LONG');
  const closeShorts = result.trades.filter(t => t.action === 'CLOSE_SHORT');
  const longPnl  = closeLongs.reduce((s, t)  => s + (t.pnl ?? 0), 0);
  const shortPnl = closeShorts.reduce((s, t) => s + (t.pnl ?? 0), 0);

  return {
    symbol,
    regime: regimeShort,
    sharpe: m.sharpeRatio,
    returnPct: m.totalReturnPercent,
    maxDdPct: m.maxDrawdownPercent,
    trades: m.totalTrades,
    longPnl,
    shortPnl,
    hasError: false,
  };
}

function errorResult(symbol: string, regimeShort: string, msg: string): RunResult {
  return {
    symbol,
    regime: regimeShort,
    sharpe: NaN,
    returnPct: NaN,
    maxDdPct: NaN,
    trades: 0,
    longPnl: 0,
    shortPnl: 0,
    hasError: true,
    error: msg,
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

function fmtPnl(n: number): string {
  if (!isFinite(n)) return 'N/A';
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${n.toFixed(0)}`;
}

function fmtInt(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return String(Math.round(n));
}

function avg(arr: number[]): number {
  const finite = arr.filter(isFinite);
  if (finite.length === 0) return NaN;
  return finite.reduce((s, v) => s + v, 0) / finite.length;
}

function sum(arr: number[]): number {
  return arr.filter(isFinite).reduce((s, v) => s + v, 0);
}

function sep(len: number): string { return '-'.repeat(len); }

// Helper: get all variant results from a RowResult array for a given variant index
function vResults(rows: RowResult[], vi: number): RunResult[] {
  return rows.map(r => r.variants[vi]);
}

function allValid(row: RowResult): boolean {
  return !row.v2.hasError && row.variants.every(v => !v.hasError);
}

// ============================================================================
// Table 1: Per-Regime Average Sharpe
// ============================================================================

function printRegimeSharpeTable(rows: RowResult[]): void {
  const COL0 = 10;  // Regime column
  const COL  = 8;   // Each value column

  const variantShorts = ['V2', ...VARIANTS.map(v => v.short)];

  const header =
    lpad('Regime', COL0) + '  ' +
    variantShorts.map(s => rpad(s, COL)).join('  ');
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  REGIME FILTER COMPARISON -- Average Sharpe by Regime');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const regime of REGIMES) {
    const regRows = rows.filter(r => r.regime === regime.short && allValid(r));
    if (regRows.length === 0) {
      console.log(lpad(regime.short, COL0) + '  ' + 'no data');
      continue;
    }

    const avgV2 = avg(regRows.map(r => r.v2.sharpe));
    const variantAvgs = VARIANTS.map((_, vi) => avg(vResults(regRows, vi).map(r => r.sharpe)));

    console.log(
      lpad(regime.short, COL0) + '  ' +
      rpad(fmtSharpe(avgV2), COL) + '  ' +
      variantAvgs.map(a => rpad(fmtSharpe(a), COL)).join('  ')
    );
  }

  console.log('='.repeat(width));
}

// ============================================================================
// Table 2: Overall Summary
// ============================================================================

function printOverallSummary(rows: RowResult[]): void {
  const valid = rows.filter(allValid);
  const bearValid = valid.filter(r => BEAR_REGIMES.has(r.regime));
  const bullValid = valid.filter(r => BULL_REGIMES.has(r.regime));

  const avgSh  = (arr: RunResult[]) => avg(arr.map(r => r.sharpe));
  const totPnl = (arr: RunResult[]) => sum(arr.map(r => r.longPnl + r.shortPnl));
  const totTrades = (arr: RunResult[]) => arr.reduce((s, r) => s + r.trades, 0);

  // Build arrays for V2 and each variant across bear/bull
  const bearV2   = bearValid.map(r => r.v2);
  const bullV2   = bullValid.map(r => r.v2);
  const allV2    = valid.map(r => r.v2);

  const bearVars = VARIANTS.map((_, vi) => bearValid.flatMap(r => [r.variants[vi]]));
  const bullVars = VARIANTS.map((_, vi) => bullValid.flatMap(r => [r.variants[vi]]));
  const allVars  = VARIANTS.map((_, vi) => valid.flatMap(r => [r.variants[vi]]));

  const C0 = 20;
  const C  = 9;

  const variantShorts = ['V2', ...VARIANTS.map(v => v.short)];
  const header =
    lpad('Metric', C0) + '  ' +
    variantShorts.map(s => rpad(s, C)).join('  ');
  const width = header.length;

  const dataRows: Array<[string, string[]]> = [
    [
      'Bear avg Sharpe',
      [fmtSharpe(avgSh(bearV2)), ...bearVars.map(a => fmtSharpe(avgSh(a)))],
    ],
    [
      'Bear total PnL',
      [fmtPnl(totPnl(bearV2)), ...bearVars.map(a => fmtPnl(totPnl(a)))],
    ],
    [
      'Bull avg Sharpe',
      [fmtSharpe(avgSh(bullV2)), ...bullVars.map(a => fmtSharpe(avgSh(a)))],
    ],
    [
      'Bull total PnL',
      [fmtPnl(totPnl(bullV2)), ...bullVars.map(a => fmtPnl(totPnl(a)))],
    ],
    [
      'Net PnL (all)',
      [fmtPnl(totPnl(allV2)), ...allVars.map(a => fmtPnl(totPnl(a)))],
    ],
    [
      'Bear trades',
      [fmtInt(totTrades(bearV2)), ...bearVars.map(a => fmtInt(totTrades(a)))],
    ],
    [
      'Bull trades',
      [fmtInt(totTrades(bullV2)), ...bullVars.map(a => fmtInt(totTrades(a)))],
    ],
  ];

  console.log('\n' + '='.repeat(width));
  console.log('  OVERALL SUMMARY');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const [metric, vals] of dataRows) {
    console.log(
      lpad(metric, C0) + '  ' +
      vals.map(v => rpad(v, C)).join('  ')
    );
  }

  console.log('='.repeat(width));
}

// ============================================================================
// Table 3: Recovery 2023 Detail (transition period)
// ============================================================================

function printRecov23Detail(rows: RowResult[]): void {
  const recRows = rows.filter(r => r.regime === 'Recov23');

  const COL0 = 10;  // Symbol column
  const COL  = 8;   // Each value column

  const variantShorts = ['V2', ...VARIANTS.map(v => v.short)];
  const header =
    lpad('Symbol', COL0) + '  ' +
    variantShorts.map(s => rpad(s, COL)).join('  ');
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  RECOVERY 2023 DETAIL (transition period -- filter aggressiveness test)');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  const validRows: RowResult[] = [];

  for (const row of recRows) {
    const sym = row.symbol.replace('/USDT:USDT', '');
    if (!allValid(row)) {
      console.log(lpad(sym, COL0) + '  ' + 'N/A (error)');
      continue;
    }
    validRows.push(row);

    console.log(
      lpad(sym, COL0) + '  ' +
      rpad(fmtSharpe(row.v2.sharpe), COL) + '  ' +
      row.variants.map(v => rpad(fmtSharpe(v.sharpe), COL)).join('  ')
    );
  }

  // Average row
  if (validRows.length > 0) {
    console.log(sep(width));
    const avgV2 = avg(validRows.map(r => r.v2.sharpe));
    const variantAvgs = VARIANTS.map((_, vi) =>
      avg(vResults(validRows, vi).map(r => r.sharpe))
    );
    console.log(
      lpad('AVG', COL0) + '  ' +
      rpad(fmtSharpe(avgV2), COL) + '  ' +
      variantAvgs.map(a => rpad(fmtSharpe(a), COL)).join('  ')
    );
  }

  console.log('='.repeat(width));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  await initDb();

  const btcCandles = await loadBtcDailyCandles();
  if (btcCandles.length < 200) {
    throw new Error(
      `Only ${btcCandles.length} BTC daily candles loaded — need at least 200 for SMA200`
    );
  }
  console.error(
    `BTC daily candle range: ${new Date(btcCandles[0].timestamp).toISOString().slice(0, 10)} ` +
    `to ${new Date(btcCandles[btcCandles.length - 1].timestamp).toISOString().slice(0, 10)}`
  );

  const totalCombos = SYMBOLS.length * REGIMES.length;
  const variantsPerCombo = 1 + VARIANTS.length;  // V2 + 5 V3 variants
  const totalRuns = totalCombos * variantsPerCombo;

  console.error('');
  console.error('='.repeat(70));
  console.error('  REGIME FILTER COMPARISON: V2 baseline vs V3-block variants');
  console.error('='.repeat(70));
  console.error(`  Symbols   : ${SYMBOLS.length}`);
  console.error(`  Regimes   : ${REGIMES.length}`);
  console.error(`  Variants  : V2, ${VARIANTS.map(v => v.label).join(', ')}`);
  console.error(`  Total runs: ${totalRuns} (${totalCombos} combos x ${variantsPerCombo})`);
  console.error('='.repeat(70));
  console.error('');

  const allRows: RowResult[] = [];
  let completed = 0;

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');

    for (const regime of REGIMES) {
      completed++;
      const comboIdx = String(completed).padStart(String(totalCombos).length, ' ');
      const prefix = `[${comboIdx}/${totalCombos}] ${symbolShort.padEnd(6)} ${regime.short.padEnd(10)}`;

      // Run V2
      let v2: RunResult;
      try {
        v2 = await runV2(symbol, regime);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        v2 = errorResult(symbol, regime.short, msg);
      }

      // Run each V3 variant
      const variantResults: RunResult[] = [];
      for (const variant of VARIANTS) {
        try {
          variantResults.push(await runV3Variant(symbol, regime, variant, btcCandles));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          variantResults.push(errorResult(symbol, regime.short, msg));
        }
      }

      allRows.push({
        symbol,
        regime: regime.short,
        v2,
        variants: variantResults,
      });

      // Progress line on stderr
      const fmtProg = (r: RunResult) => {
        if (r.hasError) return 'ERR    ';
        return fmtSharpe(r.sharpe).padStart(6);
      };

      const variantStr = VARIANTS.map((v, vi) => `${v.short}:${fmtProg(variantResults[vi])}`).join('  ');
      console.error(`${prefix} V2:${fmtProg(v2)}  ${variantStr}`);
    }
  }

  // ============================================================================
  // Print output tables
  // ============================================================================

  console.log('');
  console.log('='.repeat(70));
  console.log('  REGIME FILTER COMPARISON RESULTS');
  console.log('  funding-rate-spike v2 vs v3-block (SMA200/SMA100/SMA50/EMA200/EMA100) / 4h');
  console.log('='.repeat(70));

  // Table 1: Per-regime average Sharpe
  printRegimeSharpeTable(allRows);

  // Table 2: Overall summary
  printOverallSummary(allRows);

  // Table 3: Recovery 2023 per-symbol detail
  printRecov23Detail(allRows);

  // Error summary
  const errRows = allRows.filter(r => !allValid(r));
  if (errRows.length > 0) {
    console.log(`\n--- Runs with errors (${errRows.length}) ---`);
    for (const row of errRows) {
      const sym = row.symbol.replace('/USDT:USDT', '');
      if (row.v2.hasError) {
        console.log(`  v2          ${sym.padEnd(12)} ${row.regime.padEnd(10)} ${(row.v2.error ?? 'unknown').slice(0, 80)}`);
      }
      for (let vi = 0; vi < VARIANTS.length; vi++) {
        const r = row.variants[vi];
        if (r.hasError) {
          console.log(`  v3-${VARIANTS[vi].short.padEnd(8)} ${sym.padEnd(12)} ${row.regime.padEnd(10)} ${(r.error ?? 'unknown').slice(0, 80)}`);
        }
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
