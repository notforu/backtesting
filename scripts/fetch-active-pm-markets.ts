#!/usr/bin/env npx tsx
/**
 * Find and fetch active Polymarket markets with longest history
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  clobTokenIds: string;
  active: boolean;
  closed: boolean;
  volume?: string;
  volumeNum?: number;
  liquidity?: string;
  endDate?: string;
  category?: string;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchActiveMarkets(offset: number = 0): Promise<GammaMarket[]> {
  const url = `${GAMMA_API}/markets?active=true&closed=false&limit=100&offset=${offset}&order=volume&ascending=false`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json() as Promise<GammaMarket[]>;
}

async function getPriceHistory(tokenId: string): Promise<{ points: number; firstDate: string; lastDate: string; daysSpan: number }> {
  const url = `${CLOB_API}/prices-history?market=${tokenId}&interval=all&fidelity=60`;
  const res = await fetch(url);
  if (!res.ok) return { points: 0, firstDate: '', lastDate: '', daysSpan: 0 };
  const data = await res.json() as { history: Array<{ t: number; p: number }> };
  if (!data.history || data.history.length === 0) return { points: 0, firstDate: '', lastDate: '', daysSpan: 0 };

  const firstTs = data.history[0].t * 1000;
  const lastTs = data.history[data.history.length - 1].t * 1000;
  const first = new Date(firstTs).toISOString().split('T')[0];
  const last = new Date(lastTs).toISOString().split('T')[0];
  const daysSpan = Math.round((lastTs - firstTs) / (1000 * 60 * 60 * 24));
  return { points: data.history.length, firstDate: first, lastDate: last, daysSpan };
}

async function main() {
  console.log('=== Finding Active Polymarket Markets with Long History ===\n');

  // Fetch top markets by volume
  const markets: GammaMarket[] = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const batch = await fetchActiveMarkets(offset);
    markets.push(...batch);
    await sleep(1000);
    if (batch.length < 100) break;
  }

  console.log(`Found ${markets.length} active markets. Checking price history...\n`);

  // Filter markets with CLOB token IDs and check history
  const results: Array<{
    slug: string;
    question: string;
    points: number;
    firstDate: string;
    lastDate: string;
    daysSpan: number;
    volume: string;
  }> = [];

  let checked = 0;
  for (const m of markets) {
    if (!m.clobTokenIds) continue;

    let tokenId = '';
    try {
      const tokens = JSON.parse(m.clobTokenIds);
      tokenId = tokens[0] || '';
    } catch { continue; }

    if (!tokenId) continue;

    const history = await getPriceHistory(tokenId);
    await sleep(500);
    checked++;

    if (history.daysSpan >= 30) { // At least 30 days of data
      const vol = m.volume || m.volumeNum?.toString() || '0';
      results.push({
        slug: m.slug,
        question: m.question,
        points: history.points,
        firstDate: history.firstDate,
        lastDate: history.lastDate,
        daysSpan: history.daysSpan,
        volume: vol,
      });
      console.log(`  [${results.length}] ${m.slug} (${history.daysSpan}d, ${history.points} pts, $${Number(vol).toLocaleString()})`);
    }

    // Stop after checking enough or finding enough
    if (results.length >= 20 || checked >= 80) break;
  }

  // Sort by days span (longest history first)
  results.sort((a, b) => b.daysSpan - a.daysSpan);

  console.log(`\n=== TOP ${results.length} MARKETS BY HISTORY LENGTH ===\n`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${i+1}. PM:${r.slug}`);
    console.log(`   Q: ${r.question}`);
    console.log(`   Period: ${r.firstDate} → ${r.lastDate} (${r.daysSpan} days, ${r.points} data points)`);
    console.log(`   Volume: $${Number(r.volume).toLocaleString()}`);
    console.log('');
  }

  // Output JSON for programmatic use
  console.log('=== JSON ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
