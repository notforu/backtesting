#!/usr/bin/env node
/**
 * Cache candle data for all symbols and timeframes
 *
 * Usage:
 *   npx tsx scripts/cache-candles.ts --exchange=bybit --symbols=ALL --timeframes=1m,5m,15m,1h,4h,1d --from=2025-08-19
 *   npx tsx scripts/cache-candles.ts --exchange=bybit --symbols=BTC/USDT:USDT,ETH/USDT:USDT --timeframes=1h,4h --from=2024-01-01 --to=2024-12-31
 */

import { getProvider } from '../src/data/providers/index.js';
import {
  saveCandles,
  saveCandlesBulk,
  getCandleDateRange,
} from '../src/data/db.js';
import type { Timeframe } from '../src/core/types.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  exchange: string;
  symbols: string[] | 'ALL';
  timeframes: Timeframe[];
  from: Date;
  to: Date;
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
    console.error('Error: --symbols is required (e.g., --symbols=ALL or --symbols=BTC/USDT:USDT,ETH/USDT:USDT)');
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

  const validTimeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
  const timeframes = (parsed['timeframes'] || '1h')
    .split(',')
    .map(t => t.trim() as Timeframe)
    .filter(t => validTimeframes.includes(t));

  if (timeframes.length === 0) {
    console.error('Error: No valid timeframes specified. Valid options: ' + validTimeframes.join(', '));
    process.exit(1);
  }

  const symbols = parsed['symbols'].toUpperCase() === 'ALL'
    ? 'ALL' as const
    : parsed['symbols'].split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (symbols !== 'ALL' && symbols.length === 0) {
    console.error('Error: --symbols must contain at least one symbol or be ALL');
    process.exit(1);
  }

  return {
    exchange: parsed['exchange'],
    symbols,
    timeframes,
    from: fromDate,
    to: toDate,
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
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hr}h ${remainMin}m ${sec}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { exchange, symbols: symbolsArg, timeframes, from, to } = parseArgs();

  const provider = getProvider(exchange);

  // Resolve symbols
  let symbols: string[];
  if (symbolsArg === 'ALL') {
    console.log(`Discovering symbols for ${exchange}...`);
    symbols = await provider.getAvailableSymbols();
    console.log(`Found ${symbols.length} symbols`);
  } else {
    symbols = symbolsArg;
  }

  console.log(`\nCaching candles from ${exchange}`);
  console.log(`Symbols: ${symbols.length} (${symbolsArg === 'ALL' ? 'ALL' : symbols.join(', ')})`);
  console.log(`Timeframes: ${timeframes.join(', ')}`);
  console.log(`Date range: ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}`);
  console.log('');

  const startTime = Date.now();

  let totalCandles = 0;
  let totalSymbolsProcessed = 0;
  let totalErrors = 0;

  for (let si = 0; si < symbols.length; si++) {
    const symbol = symbols[si];
    totalSymbolsProcessed++;

    for (let ti = 0; ti < timeframes.length; ti++) {
      const tf = timeframes[ti];

      const prefix = `[${si + 1}/${symbols.length}] ${symbol} ${tf} [${ti + 1}/${timeframes.length} TFs]`;
      process.stdout.write(`${prefix} -> `);

      try {
        // Check existing cached range
        const cached = await getCandleDateRange(exchange, symbol, tf);

        let fetchStart = from;

        if (cached.start !== null && cached.end !== null) {
          const cachedStartDate = new Date(cached.start);
          const cachedEndDate = new Date(cached.end);

          if (from.getTime() >= cachedStartDate.getTime() && to.getTime() <= cachedEndDate.getTime()) {
            console.log(`already cached (${formatDate(cached.start)} - ${formatDate(cached.end)})`);
            continue;
          }

          // Only fetch the gap
          if (from.getTime() >= cachedStartDate.getTime()) {
            fetchStart = new Date(cached.end + 1);
          }
        }

        const candles = await provider.fetchCandles(symbol, tf, fetchStart, to);

        if (candles.length > 0) {
          // Use bulk insert for large batches (~5x faster than single-row inserts)
          const saved = candles.length > 100
            ? await saveCandlesBulk(candles, exchange, symbol, tf)
            : await saveCandles(candles, exchange, symbol, tf);
          totalCandles += saved;

          const firstDate = formatDate(candles[0].timestamp);
          const lastDate = formatDate(candles[candles.length - 1].timestamp);
          console.log(`${formatNumber(saved)} candles saved (${firstDate} - ${lastDate})`);
        } else {
          console.log('no data returned');
        }
      } catch (err) {
        totalErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
      }
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('');
  console.log('=== CANDLE CACHE COMPLETE ===');
  console.log(`Symbols processed: ${totalSymbolsProcessed}`);
  console.log(`Timeframes: ${timeframes.join(', ')}`);
  console.log(`Total candles cached: ${formatNumber(totalCandles)}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Time elapsed: ${formatDuration(elapsed)}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
