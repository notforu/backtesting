#!/usr/bin/env node
/**
 * Cache Open Interest (OI) and Long/Short Ratio (LSR) history for perpetual futures
 *
 * Usage:
 *   npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=ALL --from=2024-01-01 --timeframe=5m
 *   npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=BTC/USDT:USDT,ETH/USDT:USDT --from=2024-01-01 --timeframe=1h
 *   npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=BTC/USDT:USDT --from=2024-01-01 --to=2024-12-31 --type=lsr
 *   npx tsx scripts/cache-oi-data.ts --exchange=bybit --symbols=ALL --from=2024-01-01 --type=oi --timeframe=5m
 */

import { BybitProvider } from '../src/data/providers/bybit.js';
import {
  saveOpenInterest,
  getOpenInterestDateRange,
  getOpenInterest,
  saveLongShortRatio,
  getLongShortRatioDateRange,
  getLongShortRatio,
} from '../src/data/db.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  exchange: string;
  symbols: string[] | 'ALL';
  from: Date;
  to: Date;
  type: 'oi' | 'lsr';
  timeframe: string;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      parsed[match[1]] = match[2];
    }
  }

  if (!parsed['exchange']) {
    console.error('Error: --exchange is required (e.g., --exchange=bybit)');
    process.exit(1);
  }

  if (!parsed['symbols']) {
    console.error(
      'Error: --symbols is required (e.g., --symbols=ALL or --symbols=BTC/USDT:USDT,ETH/USDT:USDT)'
    );
    process.exit(1);
  }

  if (!parsed['from']) {
    console.error('Error: --from is required (e.g., --from=2024-01-01)');
    process.exit(1);
  }

  const fromDate = new Date(parsed['from']);
  if (isNaN(fromDate.getTime())) {
    console.error(`Error: Invalid --from date: "${parsed['from']}"`);
    process.exit(1);
  }

  const toDate = parsed['to'] ? new Date(parsed['to']) : new Date();
  if (isNaN(toDate.getTime())) {
    console.error(`Error: Invalid --to date: "${parsed['to']}"`);
    process.exit(1);
  }

  const dataType = (parsed['type'] ?? 'oi') as 'oi' | 'lsr';
  if (dataType !== 'oi' && dataType !== 'lsr') {
    console.error('Error: --type must be "oi" or "lsr"');
    process.exit(1);
  }

  // Default timeframe: 5m for OI, 1h for LSR (LSR only supports 1h on Bybit)
  const defaultTimeframe = dataType === 'lsr' ? '1h' : '5m';
  const timeframe = parsed['timeframe'] ?? defaultTimeframe;

  const validOiTimeframes = ['5m', '15m', '1h', '4h', '1d'];
  if (dataType === 'oi' && !validOiTimeframes.includes(timeframe)) {
    console.error(`Error: --timeframe must be one of: ${validOiTimeframes.join(', ')} for OI`);
    process.exit(1);
  }

  if (dataType === 'lsr' && timeframe !== '1h') {
    console.warn('Warning: LSR on Bybit is only available at 1h granularity. Forcing --timeframe=1h');
  }

  const symbols =
    parsed['symbols'].toUpperCase() === 'ALL'
      ? ('ALL' as const)
      : parsed['symbols']
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

  if (symbols !== 'ALL' && symbols.length === 0) {
    console.error('Error: --symbols must contain at least one symbol or be ALL');
    process.exit(1);
  }

  return {
    exchange: parsed['exchange'],
    symbols,
    from: fromDate,
    to: toDate,
    type: dataType,
    timeframe: dataType === 'lsr' ? '1h' : timeframe,
  };
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

// ============================================================================
// Cache OI for a single symbol
// ============================================================================

async function cacheOI(
  provider: BybitProvider,
  exchange: string,
  symbol: string,
  from: Date,
  to: Date,
  timeframe: string
): Promise<number> {
  const cached = await getOpenInterestDateRange(exchange, symbol);

  let fetchStart = from;
  let fetchEnd = to;

  if (cached.start !== null && cached.end !== null) {
    if (from.getTime() >= cached.start) {
      if (to.getTime() <= cached.end) {
        // Entire range is cached
        const records = await getOpenInterest(exchange, symbol, from.getTime(), to.getTime());
        console.log(
          `already cached (${records.length} records, ${formatDate(cached.start)} - ${formatDate(cached.end)})`
        );
        return 0;
      }
      fetchStart = new Date(cached.end + 1);
      fetchEnd = to;
    }
    // else: need data before cached start — fetch full range, upsert handles duplicates
  }

  const records = await provider.fetchOpenInterestHistoryDirect(symbol, timeframe, fetchStart, fetchEnd);

  if (records.length === 0) {
    console.log('no data returned (symbol may not exist or no data in range)');
    return 0;
  }

  const saved = await saveOpenInterest(records, exchange, symbol);
  const firstDate = formatDate(records[0].timestamp);
  const lastDate = formatDate(records[records.length - 1].timestamp);
  console.log(`${saved} records saved (${firstDate} - ${lastDate})`);
  return saved;
}

// ============================================================================
// Cache LSR for a single symbol
// ============================================================================

async function cacheLSR(
  provider: BybitProvider,
  exchange: string,
  symbol: string,
  from: Date,
  to: Date
): Promise<number> {
  const cached = await getLongShortRatioDateRange(exchange, symbol);

  let fetchStart = from;
  let fetchEnd = to;

  if (cached.start !== null && cached.end !== null) {
    if (from.getTime() >= cached.start) {
      if (to.getTime() <= cached.end) {
        // Entire range is cached
        const records = await getLongShortRatio(exchange, symbol, from.getTime(), to.getTime());
        console.log(
          `already cached (${records.length} records, ${formatDate(cached.start)} - ${formatDate(cached.end)})`
        );
        return 0;
      }
      fetchStart = new Date(cached.end + 1);
      fetchEnd = to;
    }
  }

  const records = await provider.fetchLongShortRatioHistory(symbol, fetchStart, fetchEnd);

  if (records.length === 0) {
    console.log('no data returned (symbol may not exist or no data in range)');
    return 0;
  }

  const saved = await saveLongShortRatio(records, exchange, symbol);
  const firstDate = formatDate(records[0].timestamp);
  const lastDate = formatDate(records[records.length - 1].timestamp);
  console.log(`${saved} records saved (${firstDate} - ${lastDate})`);
  return saved;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { exchange, symbols: symbolsArg, from, to, type, timeframe } = parseArgs();

  if (exchange !== 'bybit') {
    console.error(`Error: Only "bybit" exchange is currently supported.`);
    process.exit(1);
  }

  const provider = new BybitProvider();

  // Resolve symbols
  let symbols: string[];
  if (symbolsArg === 'ALL') {
    console.log(`Discovering symbols for ${exchange}...`);
    symbols = await provider.getAvailableSymbols();
    console.log(`Found ${symbols.length} symbols`);
  } else {
    symbols = symbolsArg;
  }

  const dataLabel = type === 'oi' ? `Open Interest (${timeframe})` : 'Long/Short Ratio (1h)';
  console.log(`\nCaching ${dataLabel} from ${exchange}`);
  console.log(`Symbols: ${symbols.length} (${symbolsArg === 'ALL' ? 'ALL' : symbols.join(', ')})`);
  console.log(`Date range: ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}`);
  console.log('');

  const startTime = Date.now();

  let totalFetched = 0;
  let totalSymbols = 0;

  for (const symbol of symbols) {
    totalSymbols++;
    process.stdout.write(`[${totalSymbols}/${symbols.length}] ${symbol} -> `);

    try {
      if (type === 'oi') {
        const saved = await cacheOI(provider, exchange, symbol, from, to, timeframe);
        totalFetched += saved;
      } else {
        const saved = await cacheLSR(provider, exchange, symbol, from, to);
        totalFetched += saved;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('');
  console.log(`=== ${type.toUpperCase()} CACHE COMPLETE ===`);
  console.log(`Symbols processed: ${totalSymbols}`);
  console.log(`Total records saved: ${totalFetched}`);
  console.log(`Time elapsed: ${formatDuration(elapsed)}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
