import ccxt from 'ccxt';
import { initDb, closeDb, saveCandlesBulk, getPool } from '../src/data/db.js';
import type { Candle } from '../src/core/types.js';

async function main() {
  await initDb();
  const p = getPool();

  // Check what we have
  const { rows } = await p.query(
    `SELECT COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
     FROM candles WHERE exchange='binance' AND symbol='BTC/USDT:USDT' AND timeframe='1d'`
  );
  console.log(`Existing BTC daily candles: ${rows[0].cnt} (${rows[0].min_ts ? new Date(Number(rows[0].min_ts)).toISOString().slice(0,10) : 'none'} → ${rows[0].max_ts ? new Date(Number(rows[0].max_ts)).toISOString().slice(0,10) : 'none'})`);

  if (Number(rows[0].cnt) >= 1400) {
    console.log('Sufficient coverage, skipping fetch.');
    await closeDb();
    return;
  }

  console.log('Fetching BTC/USDT:USDT daily candles from Binance USDM...');
  const exchange = new ccxt.binanceusdm({ enableRateLimit: true });
  await exchange.loadMarkets();

  const start = new Date('2021-01-01').getTime();
  const end = new Date('2026-03-17').getTime();
  const all: Candle[] = [];
  let since = start;

  while (since < end) {
    const batch = await exchange.fetchOHLCV('BTC/USDT:USDT', '1d', since, 1000) as number[][];
    if (batch.length === 0) break;
    for (const c of batch) {
      if (c[0] <= end) all.push({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
    }
    const lastTs = batch[batch.length - 1][0];
    if (lastTs >= end) break;
    since = lastTs + 1;
    if (batch.length < 10) break;
  }

  console.log(`Fetched ${all.length} candles (${new Date(all[0].timestamp).toISOString().slice(0,10)} → ${new Date(all[all.length-1].timestamp).toISOString().slice(0,10)})`);
  const saved = await saveCandlesBulk(all, 'binance', 'BTC/USDT:USDT', '1d');
  console.log(`Saved ${saved} candles to DB`);

  await closeDb();
}

main();
