#!/usr/bin/env node
/**
 * Bear Mode Comparison: V2 vs V3 (block / shortOnly / mirror)
 *
 * Tests how different bear regime behaviors affect performance.
 * In bull regimes, all V3 modes should be identical (bear mode doesn't activate).
 * In bear regimes, the modes diverge:
 * - block:      no entries at all (original V3 behaviour)
 * - shortOnly:  blocks longs, allows shorts
 * - mirror:     inverts signals (long->short, short->long)
 *
 * Usage:
 *   npx tsx scripts/compare-bear-modes.ts
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

type BearMode = 'block' | 'shortOnly' | 'mirror';
const BEAR_MODES: BearMode[] = ['block', 'shortOnly', 'mirror'];

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
  longTrades: number;
  longPnl: number;
  shortTrades: number;
  shortPnl: number;
  hasError: boolean;
  error?: string;
}

interface RowResult {
  symbol: string;
  regime: string;
  v2: RunResult;
  block: RunResult;
  shortOnly: RunResult;
  mirror: RunResult;
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

async function runV3WithMode(
  symbol: string,
  regime: Regime,
  bearMode: BearMode,
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
    params: { bearMode },
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
    longTrades: closeLongs.length,
    longPnl,
    shortTrades: closeShorts.length,
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
    longTrades: 0,
    longPnl: 0,
    shortTrades: 0,
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

function fmtInt(n: number): string {
  if (!isFinite(n)) return 'N/A';
  return String(Math.round(n));
}

function avg(arr: number[]): number {
  if (arr.length === 0) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}

function sep(len: number): string { return '-'.repeat(len); }

// ============================================================================
// Table 1: Bear Regime Performance
// ============================================================================

function printBearRegimeTable(rows: RowResult[]): void {
  const bearRows = rows.filter(r => BEAR_REGIMES.has(r.regime));

  // Columns: Symbol | Regime | V2 Sharpe | V2 PnL | block Sharpe | block PnL | short Sharpe | short PnL | mirror Sharpe | mirror PnL
  const SYM = 12;
  const REG = 10;
  const SH  = 7;
  const PN  = 8;

  const header =
    lpad('Symbol', SYM) + '  ' +
    lpad('Regime', REG) + '  ' +
    rpad('V2 Shr', SH)  + '  ' + rpad('V2 PnL', PN) + '  ' +
    rpad('Blk Shr', SH) + '  ' + rpad('Blk PnL', PN) + '  ' +
    rpad('Sho Shr', SH) + '  ' + rpad('Sho PnL', PN) + '  ' +
    rpad('Mir Shr', SH) + '  ' + rpad('Mir PnL', PN);
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  BEAR REGIME PERFORMANCE');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  // Group by regime for subtotals
  const regimeGroups: Record<string, RowResult[]> = {};
  for (const r of bearRows) {
    if (!regimeGroups[r.regime]) regimeGroups[r.regime] = [];
    regimeGroups[r.regime].push(r);
  }

  for (const [regShort, regRows] of Object.entries(regimeGroups)) {
    const validRows = regRows.filter(r =>
      !r.v2.hasError && !r.block.hasError && !r.shortOnly.hasError && !r.mirror.hasError
    );

    for (const r of regRows) {
      const sym = r.symbol.replace('/USDT:USDT', '');
      if (r.v2.hasError || r.block.hasError || r.shortOnly.hasError || r.mirror.hasError) {
        console.log(`${lpad(sym, SYM)}  ${lpad(regShort, REG)}  ${'N/A (error)'.padEnd(width - SYM - REG - 4)}`);
        continue;
      }
      const v2Pnl  = r.v2.longPnl + r.v2.shortPnl;
      const blkPnl = r.block.longPnl + r.block.shortPnl;
      const shoPnl = r.shortOnly.longPnl + r.shortOnly.shortPnl;
      const mirPnl = r.mirror.longPnl + r.mirror.shortPnl;

      console.log(
        lpad(sym, SYM) + '  ' +
        lpad(regShort, REG) + '  ' +
        rpad(fmtSharpe(r.v2.sharpe),       SH) + '  ' + rpad(fmtPnl(v2Pnl),  PN) + '  ' +
        rpad(fmtSharpe(r.block.sharpe),    SH) + '  ' + rpad(fmtPnl(blkPnl), PN) + '  ' +
        rpad(fmtSharpe(r.shortOnly.sharpe), SH) + '  ' + rpad(fmtPnl(shoPnl), PN) + '  ' +
        rpad(fmtSharpe(r.mirror.sharpe),   SH) + '  ' + rpad(fmtPnl(mirPnl), PN)
      );
    }

    // Subtotal row for this regime
    if (validRows.length > 0) {
      const avgV2S  = avg(validRows.map(r => r.v2.sharpe));
      const avgBlkS = avg(validRows.map(r => r.block.sharpe));
      const avgShoS = avg(validRows.map(r => r.shortOnly.sharpe));
      const avgMirS = avg(validRows.map(r => r.mirror.sharpe));

      const sumV2P  = sum(validRows.map(r => r.v2.longPnl + r.v2.shortPnl));
      const sumBlkP = sum(validRows.map(r => r.block.longPnl + r.block.shortPnl));
      const sumShoP = sum(validRows.map(r => r.shortOnly.longPnl + r.shortOnly.shortPnl));
      const sumMirP = sum(validRows.map(r => r.mirror.longPnl + r.mirror.shortPnl));

      console.log(sep(width));
      console.log(
        lpad(`AVG ${regShort}`, SYM) + '  ' +
        lpad('', REG) + '  ' +
        rpad(fmtSharpe(avgV2S),  SH) + '  ' + rpad(fmtPnl(sumV2P),  PN) + '  ' +
        rpad(fmtSharpe(avgBlkS), SH) + '  ' + rpad(fmtPnl(sumBlkP), PN) + '  ' +
        rpad(fmtSharpe(avgShoS), SH) + '  ' + rpad(fmtPnl(sumShoP), PN) + '  ' +
        rpad(fmtSharpe(avgMirS), SH) + '  ' + rpad(fmtPnl(sumMirP), PN)
      );
      console.log(sep(width));
    }
  }

  // Grand average over all bear regimes
  const allValid = bearRows.filter(r =>
    !r.v2.hasError && !r.block.hasError && !r.shortOnly.hasError && !r.mirror.hasError
  );
  if (allValid.length > 0) {
    const avgV2S  = avg(allValid.map(r => r.v2.sharpe));
    const avgBlkS = avg(allValid.map(r => r.block.sharpe));
    const avgShoS = avg(allValid.map(r => r.shortOnly.sharpe));
    const avgMirS = avg(allValid.map(r => r.mirror.sharpe));

    const sumV2P  = sum(allValid.map(r => r.v2.longPnl + r.v2.shortPnl));
    const sumBlkP = sum(allValid.map(r => r.block.longPnl + r.block.shortPnl));
    const sumShoP = sum(allValid.map(r => r.shortOnly.longPnl + r.shortOnly.shortPnl));
    const sumMirP = sum(allValid.map(r => r.mirror.longPnl + r.mirror.shortPnl));

    console.log(
      lpad('AVG ALL BEAR', SYM) + '  ' +
      lpad('', REG) + '  ' +
      rpad(fmtSharpe(avgV2S),  SH) + '  ' + rpad(fmtPnl(sumV2P),  PN) + '  ' +
      rpad(fmtSharpe(avgBlkS), SH) + '  ' + rpad(fmtPnl(sumBlkP), PN) + '  ' +
      rpad(fmtSharpe(avgShoS), SH) + '  ' + rpad(fmtPnl(sumShoP), PN) + '  ' +
      rpad(fmtSharpe(avgMirS), SH) + '  ' + rpad(fmtPnl(sumMirP), PN)
    );
  }

  console.log('='.repeat(width));
}

// ============================================================================
// Table 2: Bull Regime Sanity Check
// ============================================================================

function printBullSanityTable(rows: RowResult[]): void {
  const bullRows = rows.filter(r => BULL_REGIMES.has(r.regime));

  const C1 = 10;
  const C2 = 15;
  const C3 = 15;
  const C4 = 20;

  const header =
    lpad('Regime', C1) + '  ' +
    rpad('V2 avg Sharpe', C2) + '  ' +
    rpad('V3 avg Sharpe', C3) + '  ' +
    lpad('Matches?', C4);
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  BULL REGIME SANITY CHECK (all V3 modes should be identical)');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  const regimes = Array.from(BULL_REGIMES);
  for (const regShort of regimes) {
    const regRows = bullRows.filter(r => r.regime === regShort);
    const valid = regRows.filter(r =>
      !r.v2.hasError && !r.block.hasError && !r.shortOnly.hasError && !r.mirror.hasError
    );
    if (valid.length === 0) {
      console.log(lpad(regShort, C1) + '  ' + 'no data');
      continue;
    }

    const avgV2  = avg(valid.map(r => r.v2.sharpe));
    const avgBlk = avg(valid.map(r => r.block.sharpe));
    const avgSho = avg(valid.map(r => r.shortOnly.sharpe));
    const avgMir = avg(valid.map(r => r.mirror.sharpe));
    const avgV3  = avg([avgBlk, avgSho, avgMir]);

    // Check if all three V3 modes are within 0.01 of each other
    const allSame =
      Math.abs(avgBlk - avgSho) < 0.01 &&
      Math.abs(avgBlk - avgMir) < 0.01 &&
      Math.abs(avgSho - avgMir) < 0.01;

    const matchStr = allSame
      ? 'OK (all modes same)'
      : `DIFF block=${fmtSharpe(avgBlk)} sho=${fmtSharpe(avgSho)} mir=${fmtSharpe(avgMir)}`;

    console.log(
      lpad(regShort, C1) + '  ' +
      rpad(fmtSharpe(avgV2), C2) + '  ' +
      rpad(fmtSharpe(avgV3), C3) + '  ' +
      lpad(matchStr, C4)
    );
  }
  console.log('='.repeat(width));
}

// ============================================================================
// Table 3: Overall Summary
// ============================================================================

function printOverallSummary(rows: RowResult[]): void {
  const valid = rows.filter(r =>
    !r.v2.hasError && !r.block.hasError && !r.shortOnly.hasError && !r.mirror.hasError
  );
  const bearValid = valid.filter(r => BEAR_REGIMES.has(r.regime));
  const bullValid = valid.filter(r => BULL_REGIMES.has(r.regime));

  const avgSh = (arr: RunResult[]) => avg(arr.map(r => r.sharpe));
  const totPnl = (arr: RunResult[]) => sum(arr.map(r => r.longPnl + r.shortPnl));

  const allV2   = valid.map(r => r.v2);
  const allBlk  = valid.map(r => r.block);
  const allSho  = valid.map(r => r.shortOnly);
  const allMir  = valid.map(r => r.mirror);

  const bearV2  = bearValid.map(r => r.v2);
  const bearBlk = bearValid.map(r => r.block);
  const bearSho = bearValid.map(r => r.shortOnly);
  const bearMir = bearValid.map(r => r.mirror);

  const bullV2  = bullValid.map(r => r.v2);
  const bullBlk = bullValid.map(r => r.block);
  const bullSho = bullValid.map(r => r.shortOnly);
  const bullMir = bullValid.map(r => r.mirror);

  const C0 = 22;
  const C  = 12;

  const header =
    lpad('Metric', C0) + '  ' +
    rpad('V2', C) + '  ' +
    rpad('V3-block', C) + '  ' +
    rpad('V3-shortOnly', C) + '  ' +
    rpad('V3-mirror', C);
  const width = header.length;

  const dataRows: Array<[string, string, string, string, string]> = [
    [
      'Bear avg Sharpe',
      fmtSharpe(avgSh(bearV2)),
      fmtSharpe(avgSh(bearBlk)),
      fmtSharpe(avgSh(bearSho)),
      fmtSharpe(avgSh(bearMir)),
    ],
    [
      'Bear total PnL',
      fmtPnl(totPnl(bearV2)),
      fmtPnl(totPnl(bearBlk)),
      fmtPnl(totPnl(bearSho)),
      fmtPnl(totPnl(bearMir)),
    ],
    [
      'Bull avg Sharpe',
      fmtSharpe(avgSh(bullV2)),
      fmtSharpe(avgSh(bullBlk)),
      fmtSharpe(avgSh(bullSho)),
      fmtSharpe(avgSh(bullMir)),
    ],
    [
      'Bull total PnL',
      fmtPnl(totPnl(bullV2)),
      fmtPnl(totPnl(bullBlk)),
      fmtPnl(totPnl(bullSho)),
      fmtPnl(totPnl(bullMir)),
    ],
    [
      'All avg Sharpe',
      fmtSharpe(avgSh(allV2)),
      fmtSharpe(avgSh(allBlk)),
      fmtSharpe(avgSh(allSho)),
      fmtSharpe(avgSh(allMir)),
    ],
    [
      'Net PnL (all)',
      fmtPnl(totPnl(allV2)),
      fmtPnl(totPnl(allBlk)),
      fmtPnl(totPnl(allSho)),
      fmtPnl(totPnl(allMir)),
    ],
  ];

  console.log('\n' + '='.repeat(width));
  console.log('  OVERALL SUMMARY');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  for (const [metric, v2val, blkVal, shoVal, mirVal] of dataRows) {
    console.log(
      lpad(metric, C0) + '  ' +
      rpad(v2val,  C) + '  ' +
      rpad(blkVal, C) + '  ' +
      rpad(shoVal, C) + '  ' +
      rpad(mirVal, C)
    );
  }
  console.log('='.repeat(width));
}

// ============================================================================
// Table 4: Long/Short Breakdown for Bear Regimes
// ============================================================================

function printLongShortBreakdown(rows: RowResult[]): void {
  const bearValid = rows
    .filter(r => BEAR_REGIMES.has(r.regime))
    .filter(r => !r.v2.hasError && !r.block.hasError && !r.shortOnly.hasError && !r.mirror.hasError);

  const sumField = (arr: RunResult[], field: keyof RunResult) =>
    sum(arr.map(r => r[field] as number));

  const v2   = bearValid.map(r => r.v2);
  const blk  = bearValid.map(r => r.block);
  const sho  = bearValid.map(r => r.shortOnly);
  const mir  = bearValid.map(r => r.mirror);

  const C0 = 14;
  const C  = 14;

  const header =
    lpad('Mode', C0) + '  ' +
    rpad('Long Trades', C) + '  ' +
    rpad('Long PnL', C) + '  ' +
    rpad('Short Trades', C) + '  ' +
    rpad('Short PnL', C);
  const width = header.length;

  console.log('\n' + '='.repeat(width));
  console.log('  LONG/SHORT BREAKDOWN (Bear Regimes)');
  console.log('='.repeat(width));
  console.log(header);
  console.log(sep(width));

  const modeRows: Array<[string, RunResult[]]> = [
    ['V2',           v2],
    ['V3-block',     blk],
    ['V3-shortOnly', sho],
    ['V3-mirror',    mir],
  ];

  for (const [modeName, arr] of modeRows) {
    const longTrades  = sumField(arr, 'longTrades');
    const longPnl     = sumField(arr, 'longPnl');
    const shortTrades = sumField(arr, 'shortTrades');
    const shortPnl    = sumField(arr, 'shortPnl');

    console.log(
      lpad(modeName, C0) + '  ' +
      rpad(fmtInt(longTrades),  C) + '  ' +
      rpad(fmtPnl(longPnl),    C) + '  ' +
      rpad(fmtInt(shortTrades), C) + '  ' +
      rpad(fmtPnl(shortPnl),   C)
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

  // Total runs: 17 symbols x 5 regimes x 4 variants (v2 + 3 bear modes)
  const totalCombos = SYMBOLS.length * REGIMES.length;
  const totalRuns   = totalCombos * (1 + BEAR_MODES.length);
  let completed = 0;

  console.error('');
  console.error('='.repeat(70));
  console.error('  BEAR MODE COMPARISON: V2 vs V3 (block / shortOnly / mirror)');
  console.error('='.repeat(70));
  console.error(`  Symbols   : ${SYMBOLS.length}`);
  console.error(`  Regimes   : ${REGIMES.length}`);
  console.error(`  Bear modes: ${BEAR_MODES.join(', ')}`);
  console.error(`  Total runs: ${totalRuns} (${totalCombos} combos x 4)`);
  console.error('='.repeat(70));
  console.error('');

  const allRows: RowResult[] = [];

  for (const symbol of SYMBOLS) {
    const symbolShort = symbol.replace('/USDT:USDT', '');

    for (const regime of REGIMES) {
      completed++;
      const comboIdx = String(completed).padStart(String(totalCombos).length);
      const prefix = `[${comboIdx}/${totalCombos}] ${symbolShort.padEnd(10)} ${regime.short.padEnd(10)}`;

      // Run V2
      let v2: RunResult;
      try {
        v2 = await runV2(symbol, regime);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        v2 = errorResult(symbol, regime.short, msg);
      }

      // Run each V3 bear mode
      const modeResults: Record<BearMode, RunResult> = {} as Record<BearMode, RunResult>;
      for (const mode of BEAR_MODES) {
        try {
          modeResults[mode] = await runV3WithMode(symbol, regime, mode, btcCandles);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          modeResults[mode] = errorResult(symbol, regime.short, msg);
        }
      }

      allRows.push({
        symbol,
        regime: regime.short,
        v2,
        block:     modeResults['block'],
        shortOnly: modeResults['shortOnly'],
        mirror:    modeResults['mirror'],
      });

      // Progress line
      const fmtProg = (r: RunResult) => {
        if (r.hasError) return 'ERR';
        return `${fmtSharpe(r.sharpe).padStart(6)}(${r.trades})`;
      };

      console.error(
        `${prefix} ` +
        `v2:${fmtProg(v2)}  ` +
        `block:${fmtProg(modeResults['block'])}  ` +
        `short:${fmtProg(modeResults['shortOnly'])}  ` +
        `mirror:${fmtProg(modeResults['mirror'])}`
      );
    }
  }

  // ============================================================================
  // Print output tables
  // ============================================================================

  console.log('');
  console.log('='.repeat(70));
  console.log('  BEAR MODE COMPARISON RESULTS');
  console.log('  funding-rate-spike v2 vs v3-block / v3-shortOnly / v3-mirror / 4h');
  console.log('='.repeat(70));

  // Table 1: Bear regimes detail
  printBearRegimeTable(allRows);

  // Table 2: Bull sanity check
  printBullSanityTable(allRows);

  // Table 3: Overall summary
  printOverallSummary(allRows);

  // Table 4: Long/short breakdown
  printLongShortBreakdown(allRows);

  // Error summary
  const errRows = allRows.filter(r =>
    r.v2.hasError || r.block.hasError || r.shortOnly.hasError || r.mirror.hasError
  );
  if (errRows.length > 0) {
    console.log(`\n--- Runs with errors (${errRows.length}) ---`);
    for (const row of errRows) {
      const sym = row.symbol.replace('/USDT:USDT', '');
      const variants: Array<[string, RunResult]> = [
        ['v2', row.v2],
        ['v3-block', row.block],
        ['v3-shortOnly', row.shortOnly],
        ['v3-mirror', row.mirror],
      ];
      for (const [name, r] of variants) {
        if (r.hasError) {
          console.log(`  ${name.padEnd(14)} ${sym.padEnd(12)} ${row.regime.padEnd(10)} ${(r.error ?? 'unknown').slice(0, 80)}`);
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
