#!/usr/bin/env node
/**
 * Cache 1m candles for HF scalping research
 * Usage: npx tsx scripts/cache-1m-candles.ts --symbols=BTC/USDT:USDT,ETH/USDT:USDT --from=2025-01-01 --to=2025-06-01
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://backtesting:backtesting@host.docker.internal:5432/backtesting';
}

import { BybitProvider } from '../src/data/providers/bybit.js';
import { saveCandles, initDb, closeDb, getCandleDateRange } from '../src/data/db.js';
import type { Timeframe } from '../src/core/types.js';

function parseArgs(): { symbols: string[]; from: Date; to: Date; timeframe: Timeframe } {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) parsed[match[1]] = match[2];
  }

  if (!parsed['symbols']) {
    console.error('Error: --symbols required');
    process.exit(1);
  }
  if (!parsed['from']) {
    console.error('Error: --from required');
    process.exit(1);
  }

  return {
    symbols: parsed['symbols'].split(',').map(s => s.trim()),
    from: new Date(parsed['from']),
    to: parsed['to'] ? new Date(parsed['to']) : new Date(),
    timeframe: (parsed['timeframe'] || '1m') as Timeframe,
  };
}

async function main() {
  await initDb();
  const { symbols, from, to, timeframe } = parseArgs();
  const provider = new BybitProvider();

  console.log(`Caching ${timeframe} candles for ${symbols.length} symbols`);
  console.log(`Range: ${from.toISOString().slice(0,10)} -> ${to.toISOString().slice(0,10)}`);
  console.log('');

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const short = symbol.replace('/USDT:USDT', '');
    console.log(`[${i+1}/${symbols.length}] ${short} (${timeframe})...`);

    try {
      // Check existing cache
      const cached = await getCandleDateRange('bybit', symbol, timeframe);
      if (cached.start && cached.end) {
        const cachedStart = new Date(cached.start);
        const cachedEnd = new Date(cached.end);
        if (cachedStart <= from && cachedEnd >= to) {
          console.log(`  Already cached (${cachedStart.toISOString().slice(0,10)} - ${cachedEnd.toISOString().slice(0,10)})`);
          continue;
        }
      }

      const startTime = Date.now();
      const candles = await provider.fetchCandles(symbol, timeframe, from, to);
      const fetchSec = Math.round((Date.now() - startTime) / 1000);

      if (candles.length > 0) {
        await saveCandles(candles, 'bybit', symbol, timeframe);
        const firstDate = new Date(candles[0].timestamp).toISOString().slice(0, 10);
        const lastDate = new Date(candles[candles.length - 1].timestamp).toISOString().slice(0, 10);
        console.log(`  ${candles.length} candles saved (${firstDate} - ${lastDate}) [${fetchSec}s]`);
      } else {
        console.log(`  No candles returned`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ERROR: ${msg}`);
    }
  }

  await closeDb();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
