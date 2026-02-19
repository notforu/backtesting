#!/usr/bin/env node
/**
 * Cache funding rate history for perpetual futures
 *
 * Usage:
 *   npx tsx scripts/cache-funding-rates.ts --exchange=bybit --symbols=BTC/USDT:USDT,ETH/USDT:USDT --from=2024-01-01
 *   npx tsx scripts/cache-funding-rates.ts --exchange=bybit --symbols=BTC/USDT:USDT --from=2024-01-01 --to=2024-12-31
 */

import { BybitProvider } from '../src/data/providers/bybit.js';
import {
  saveFundingRates,
  getFundingRateDateRange,
} from '../src/data/db.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): {
  exchange: string;
  symbols: string[];
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
    console.error(
      'Error: --symbols is required (e.g., --symbols=BTC/USDT:USDT,ETH/USDT:USDT)'
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

  const symbols = parsed['symbols']
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (symbols.length === 0) {
    console.error('Error: --symbols must contain at least one symbol');
    process.exit(1);
  }

  return {
    exchange: parsed['exchange'],
    symbols,
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
  return `${min}m ${sec}s`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { exchange, symbols, from, to } = parseArgs();

  console.log(`Caching funding rates from ${exchange}`);
  console.log(`Symbols: ${symbols.join(', ')}`);
  console.log(`Date range: ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}`);
  console.log('');

  if (exchange !== 'bybit') {
    console.error(`Error: Only "bybit" exchange is currently supported for funding rates.`);
    process.exit(1);
  }

  const provider = new BybitProvider();
  const startTime = Date.now();

  let totalFetched = 0;
  let totalSymbols = 0;

  for (const symbol of symbols) {
    totalSymbols++;
    process.stdout.write(`[${totalSymbols}/${symbols.length}] ${symbol} -> `);

    try {
      // Check existing cached range
      const cached = await getFundingRateDateRange(exchange, symbol);

      let fetchStart = from;
      let fetchEnd = to;

      if (cached.start !== null && cached.end !== null) {
        // We have some cached data - only fetch what's missing
        const cachedStartDate = new Date(cached.start);
        const cachedEndDate = new Date(cached.end);

        // Determine what's missing at the beginning
        if (from.getTime() >= cachedStartDate.getTime()) {
          // Start is covered; only fetch from end of cache to requested end
          if (to.getTime() <= cachedEndDate.getTime()) {
            // Entire range is cached
            const cachedCount = await getCachedCount(exchange, symbol, from.getTime(), to.getTime());
            console.log(
              `already cached (${cachedCount} rates, ${formatDate(cached.start)} - ${formatDate(cached.end)})`
            );
            continue;
          }
          // Fetch from end of cache to requested end
          fetchStart = new Date(cached.end + 1);
          fetchEnd = to;
        } else {
          // Need to fetch before the cached start too
          // For simplicity: fetch the full requested range and let INSERT OR REPLACE handle duplicates
          fetchStart = from;
          fetchEnd = to;
        }
      }

      const rates = await provider.fetchFundingRateHistory(symbol, fetchStart, fetchEnd);

      if (rates.length > 0) {
        const saved = await saveFundingRates(rates, exchange, symbol);
        totalFetched += saved;

        const firstDate = formatDate(rates[0].timestamp);
        const lastDate = formatDate(rates[rates.length - 1].timestamp);
        console.log(`${saved} rates saved (${firstDate} - ${lastDate})`);
      } else {
        console.log('no rates returned (symbol may not exist or no data in range)');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('');
  console.log('=== FUNDING RATE CACHE COMPLETE ===');
  console.log(`Symbols processed: ${totalSymbols}`);
  console.log(`Total rates fetched: ${totalFetched}`);
  console.log(`Time elapsed: ${formatDuration(elapsed)}`);
}

/**
 * Helper to get count of cached rates for a symbol in a range
 */
async function getCachedCount(
  exchange: string,
  symbol: string,
  start: number,
  end: number
): Promise<number> {
  const { getFundingRates } = await import('../src/data/db.js');
  const rates = await getFundingRates(exchange, symbol, start, end);
  return rates.length;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
