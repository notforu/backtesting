import ccxt from 'ccxt';
import { initDb, closeDb, saveCandlesBulk } from '../src/data/db.js';
import type { Candle } from '../src/core/types.js';

const SYMBOLS = ['DOGE/USDT:USDT', 'IOST/USDT:USDT', 'ZEC/USDT:USDT', 'TRB/USDT:USDT', 'IOTA/USDT:USDT'];
const H2_START = new Date('2022-06-17T00:00:00Z').getTime();
const H2_END = new Date('2022-12-31T23:59:59Z').getTime();

async function main() {
  await initDb();
  const exchange = new ccxt.binanceusdm({ enableRateLimit: true });
  await exchange.loadMarkets();

  for (const symbol of SYMBOLS) {
    const short = symbol.replace('/USDT:USDT', '');
    console.log(`Fetching H2 candles for ${short}...`);

    const all: Candle[] = [];
    let since = H2_START;

    while (since < H2_END) {
      const batch = await exchange.fetchOHLCV(symbol, '4h', since, 1000) as number[][];
      if (batch.length === 0) break;

      for (const c of batch) {
        if (c[0] <= H2_END) {
          all.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
        }
      }

      const lastTs = batch[batch.length - 1][0];
      if (lastTs >= H2_END) break;
      since = lastTs + 1;
      if (batch.length < 10) break;
    }

    if (all.length > 0) {
      const saved = await saveCandlesBulk(all, 'binance', symbol, '4h');
      console.log(`  ${short}: saved ${saved} candles (${new Date(all[0].timestamp).toISOString().slice(0,10)} → ${new Date(all[all.length-1].timestamp).toISOString().slice(0,10)})`);
    } else {
      console.log(`  ${short}: NO candles returned by Binance for H2 2022`);
    }
  }

  await closeDb();
}

main();
