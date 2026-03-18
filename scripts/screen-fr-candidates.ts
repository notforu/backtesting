/**
 * Funding Rate Spike Strategy — Symbol Screener
 *
 * Screens all Bybit perpetual futures symbols available in the local DB cache
 * to find the best candidates for the funding-rate-spike strategy.
 *
 * Criteria:
 *   - 4h candle data from 2024-01-01 (min 3000 candles)
 *   - Funding rate data for the same period (min 100 records)
 *   - Daily volume > $10M (avg over last 90 days of candle data)
 *   - FR std dev > 0.01%
 *   - Score = FR_std_dev × log(daily_volume_USD)
 *
 * Usage:
 *   npx tsx scripts/screen-fr-candidates.ts
 */

import { getPool, closeDb } from '../src/data/db.js';

// ============================================================================
// Configuration
// ============================================================================

const EXCHANGE = 'bybit';
const TIMEFRAME = '4h';

// ~2024-01-01 00:00:00 UTC
const START_MS = new Date('2024-01-01T00:00:00Z').getTime();
// 90 days ago from 2026-03-18 (today)
const NOW_MS = new Date('2026-03-18T00:00:00Z').getTime();
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const RECENT_START_MS = NOW_MS - NINETY_DAYS_MS;

const MIN_CANDLES = 3000;
const MIN_FR_RECORDS = 100;
const MIN_DAILY_VOLUME_USD = 10_000_000; // $10M
const MIN_FR_STD_DEV_PCT = 0.0001; // 0.01% expressed as decimal fraction

// Already-tested / in-portfolio symbols (base only, no /USDT:USDT suffix)
const EXCLUDED_BASES = new Set([
  'ZEC', 'LDO', 'TRB', 'NEAR', 'STG',   // current 5-sym portfolio
  'DOGE', 'XLM', 'IOST',                  // tested, some failed WF
  'ARB', 'IOTA', 'COTI', 'ENJ', 'KAVA', 'APT', 'COMP', 'RPL', 'BCH', // tested in 13-sym default
  'IMX', 'ICP', 'LPT',                    // previously tested
]);

// ============================================================================
// Types
// ============================================================================

interface CandleStats {
  symbol: string;
  candleCount: number;
  minTimestamp: number;
  maxTimestamp: number;
  avgDailyVolumeUSD: number;   // avg USD volume over last 90 days of data
}

interface FRStats {
  symbol: string;
  frCount: number;
  frStdDev: number;  // as fraction (0.0001 = 0.01%)
}

interface ScreenResult {
  symbol: string;
  base: string;
  candleCount: number;
  frCount: number;
  avgDailyVolumeUSD: number;
  frStdDevPct: number;   // as fraction
  score: number;
  excluded: boolean;
}

// ============================================================================
// Database queries
// ============================================================================

async function getSymbolsWithCandles(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM candles WHERE exchange = $1 AND timeframe = $2`,
    [EXCHANGE, TIMEFRAME]
  );
  return rows.map((r) => r.symbol);
}

async function getSymbolsWithFundingRates(): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM funding_rates WHERE exchange = $1`,
    [EXCHANGE]
  );
  return new Set(rows.map((r) => r.symbol));
}

async function getCandleStats(symbol: string): Promise<CandleStats | null> {
  const pool = getPool();

  // Count + date range for the full period
  const { rows: countRows } = await pool.query<{
    cnt: string;
    min_ts: string;
    max_ts: string;
  }>(
    `SELECT COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
     FROM candles
     WHERE exchange = $1 AND symbol = $2 AND timeframe = $3
       AND timestamp >= $4`,
    [EXCHANGE, symbol, TIMEFRAME, START_MS]
  );

  const countRow = countRows[0];
  if (!countRow || Number(countRow.cnt) === 0) return null;

  const candleCount = Number(countRow.cnt);
  const minTimestamp = Number(countRow.min_ts);
  const maxTimestamp = Number(countRow.max_ts);

  // Avg daily volume (last 90 days): volume * close per 4h candle = USD volume per 4h bar
  // 6 bars per day for 4h timeframe
  const { rows: volRows } = await pool.query<{ avg_bar_vol_usd: string; bar_count: string }>(
    `SELECT
       AVG(volume * close) as avg_bar_vol_usd,
       COUNT(*) as bar_count
     FROM candles
     WHERE exchange = $1 AND symbol = $2 AND timeframe = $3
       AND timestamp >= $4`,
    [EXCHANGE, symbol, TIMEFRAME, RECENT_START_MS]
  );

  const volRow = volRows[0];
  if (!volRow || Number(volRow.bar_count) === 0) {
    return null;
  }

  // 6 bars of 4h = 1 day
  const avgBarVolUSD = Number(volRow.avg_bar_vol_usd);
  const avgDailyVolumeUSD = avgBarVolUSD * 6;

  return {
    symbol,
    candleCount,
    minTimestamp,
    maxTimestamp,
    avgDailyVolumeUSD,
  };
}

async function getFRStats(symbol: string): Promise<FRStats | null> {
  const pool = getPool();

  const { rows } = await pool.query<{
    cnt: string;
    stddev: string | null;
  }>(
    `SELECT
       COUNT(*) as cnt,
       STDDEV(funding_rate) as stddev
     FROM funding_rates
     WHERE exchange = $1 AND symbol = $2 AND timestamp >= $3`,
    [EXCHANGE, symbol, START_MS]
  );

  const row = rows[0];
  if (!row || Number(row.cnt) === 0) return null;

  return {
    symbol,
    frCount: Number(row.cnt),
    frStdDev: row.stddev != null ? Number(row.stddev) : 0,
  };
}

// ============================================================================
// Utility
// ============================================================================

function extractBase(symbol: string): string {
  // 'BTC/USDT:USDT' -> 'BTC'
  return symbol.split('/')[0] ?? symbol;
}

function formatUSD(usd: number): string {
  if (usd >= 1_000_000_000) return `${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `${(usd / 1_000_000).toFixed(1)}M`;
  return `${(usd / 1_000).toFixed(0)}K`;
}

function pad(s: string, len: number, right = false): string {
  if (right) return s.padEnd(len);
  return s.padStart(len);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  process.stderr.write('Connecting to database...\n');

  const pool = getPool();

  // Quick connectivity check
  await pool.query('SELECT 1');
  process.stderr.write('Connected.\n\n');

  // Step 1: Enumerate symbols with candle data
  process.stderr.write('Fetching symbols with 4h candle data...\n');
  const candleSymbols = await getSymbolsWithCandles();
  process.stderr.write(`  Found ${candleSymbols.length} symbols with 4h candle data in DB.\n\n`);

  // Step 2: Enumerate symbols with funding rate data
  process.stderr.write('Fetching symbols with funding rate data...\n');
  const frSymbols = await getSymbolsWithFundingRates();
  process.stderr.write(`  Found ${frSymbols.size} symbols with funding rate data in DB.\n\n`);

  // Symbols that have BOTH candles and FR data
  const candidateSymbols = candleSymbols.filter((s) => frSymbols.has(s));
  process.stderr.write(`  ${candidateSymbols.length} symbols have both candle + FR data.\n\n`);

  // Symbols with candles but no FR data
  const missingFR = candleSymbols.filter((s) => !frSymbols.has(s));

  // Step 3: Process each candidate symbol
  const results: ScreenResult[] = [];
  let processed = 0;

  for (const symbol of candidateSymbols) {
    processed++;
    if (processed % 10 === 0 || processed === candidateSymbols.length) {
      process.stderr.write(`  Processing ${processed}/${candidateSymbols.length}: ${symbol}        \r`);
    }

    try {
      const candleStats = await getCandleStats(symbol);
      if (!candleStats) continue;

      // Must have at least MIN_CANDLES from 2024-01-01
      if (candleStats.candleCount < MIN_CANDLES) continue;

      // Must have data starting before 2024-02-01 (some leeway)
      const dataStart = new Date(candleStats.minTimestamp);
      if (dataStart > new Date('2024-02-01')) continue;

      const frStats = await getFRStats(symbol);
      if (!frStats) continue;
      if (frStats.frCount < MIN_FR_RECORDS) continue;

      const base = extractBase(symbol);
      const excluded = EXCLUDED_BASES.has(base);

      // Volume filter
      if (candleStats.avgDailyVolumeUSD < MIN_DAILY_VOLUME_USD) continue;

      // FR volatility filter
      if (frStats.frStdDev < MIN_FR_STD_DEV_PCT) continue;

      // Score = FR_std_dev * log(daily_vol_usd)
      const score = frStats.frStdDev * Math.log(candleStats.avgDailyVolumeUSD);

      results.push({
        symbol,
        base,
        candleCount: candleStats.candleCount,
        frCount: frStats.frCount,
        avgDailyVolumeUSD: candleStats.avgDailyVolumeUSD,
        frStdDevPct: frStats.frStdDev,
        score,
        excluded,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n  Warning: Error processing ${symbol}: ${msg}\n`);
    }
  }

  process.stderr.write('\n\nDone processing.\n\n');

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // ============================================================================
  // Table 1: All qualifying symbols
  // ============================================================================

  console.log('');
  console.log('='.repeat(90));
  console.log('TABLE 1: All qualifying symbols (sorted by score)');
  console.log('='.repeat(90));
  console.log('');

  const header = [
    pad('Rank', 4),
    pad('Symbol', 20, true),
    pad('Daily Vol', 14),
    pad('FR Std (%)', 12),
    pad('Score', 8),
    pad('Candles', 8),
    pad('FR Count', 9),
    pad('Excluded', 9),
  ].join(' | ');

  const divider = '-'.repeat(header.length);
  console.log(header);
  console.log(divider);

  let rank = 0;
  for (const r of results) {
    rank++;
    const line = [
      pad(String(rank), 4),
      pad(r.symbol, 20, true),
      pad(formatUSD(r.avgDailyVolumeUSD), 14),
      pad((r.frStdDevPct * 100).toFixed(4), 12),
      pad(r.score.toFixed(4), 8),
      pad(String(r.candleCount), 8),
      pad(String(r.frCount), 9),
      pad(r.excluded ? 'yes' : '', 9),
    ].join(' | ');
    console.log(line);
  }

  if (results.length === 0) {
    console.log('  (no symbols passed all filters)');
  }

  console.log('');
  console.log(`Total qualifying: ${results.length}`);
  console.log('');

  // ============================================================================
  // Table 2: Top 10 recommendations (non-excluded)
  // ============================================================================

  const eligible = results.filter((r) => !r.excluded);

  console.log('='.repeat(90));
  console.log('TABLE 2: Top 10 recommendations for WF validation (excluding already-tested symbols)');
  console.log('='.repeat(90));
  console.log('');

  const top10 = eligible.slice(0, 10);
  if (top10.length === 0) {
    console.log('  (no non-excluded symbols passed filters)');
  } else {
    top10.forEach((r, idx) => {
      console.log(
        `  ${String(idx + 1).padStart(2)}. ${r.symbol.padEnd(22)} score=${r.score.toFixed(4)},  ` +
          `vol=$${formatUSD(r.avgDailyVolumeUSD)},  FR_std=${(r.frStdDevPct * 100).toFixed(4)}%,  ` +
          `candles=${r.candleCount},  FR records=${r.frCount}`
      );
    });
  }

  console.log('');

  // ============================================================================
  // Note: symbols with candle data but no FR data
  // ============================================================================

  if (missingFR.length > 0) {
    console.log('='.repeat(90));
    console.log(`Symbols with 4h candle data but NO funding rate data (${missingFR.length} total):`);
    console.log('  (These may still be viable candidates — fetch FR data to evaluate them)');
    console.log('');
    // Only print the first 30 to avoid noise
    const show = missingFR.slice(0, 30);
    for (let i = 0; i < show.length; i += 5) {
      const chunk = show.slice(i, i + 5).map((s) => s.padEnd(22)).join('  ');
      console.log('  ' + chunk);
    }
    if (missingFR.length > 30) {
      console.log(`  ... and ${missingFR.length - 30} more`);
    }
    console.log('');
  }

  // ============================================================================
  // Summary stats
  // ============================================================================

  console.log('='.repeat(90));
  console.log('Summary');
  console.log('='.repeat(90));
  console.log(`  Symbols with 4h candle data in DB   : ${candleSymbols.length}`);
  console.log(`  Symbols with funding rate data in DB : ${frSymbols.size}`);
  console.log(`  Symbols with BOTH                    : ${candidateSymbols.length}`);
  console.log(`  Passed ALL filters                   : ${results.length}`);
  console.log(`  Eligible (not excluded)              : ${eligible.length}`);
  console.log('');
  console.log('Filter thresholds:');
  console.log(`  Min candles (from 2024-01-01, 4h)   : ${MIN_CANDLES}`);
  console.log(`  Min FR records                       : ${MIN_FR_RECORDS}`);
  console.log(`  Min avg daily volume                 : $${formatUSD(MIN_DAILY_VOLUME_USD)}`);
  console.log(`  Min FR std dev                       : ${(MIN_FR_STD_DEV_PCT * 100).toFixed(4)}%`);
  console.log(`  Score formula                        : FR_std_dev × ln(daily_vol_usd)`);
  console.log('');

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
