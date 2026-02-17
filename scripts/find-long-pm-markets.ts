#!/usr/bin/env npx tsx
/**
 * Find active Polymarket markets with longest hourly-resolution history
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getHistory(tokenId: string): Promise<{ points: number; firstDate: string; lastDate: string; daysSpan: number }> {
  const url = `${CLOB_API}/prices-history?market=${tokenId}&interval=all&fidelity=3600`;
  const res = await fetch(url);
  if (!res.ok) return { points: 0, firstDate: '', lastDate: '', daysSpan: 0 };
  const data = await res.json() as { history: Array<{ t: number; p: number }> };
  if (!data.history || data.history.length === 0) return { points: 0, firstDate: '', lastDate: '', daysSpan: 0 };
  const firstTs = data.history[0].t * 1000;
  const lastTs = data.history[data.history.length - 1].t * 1000;
  return {
    points: data.history.length,
    firstDate: new Date(firstTs).toISOString().split('T')[0],
    lastDate: new Date(lastTs).toISOString().split('T')[0],
    daysSpan: Math.round((lastTs - firstTs) / 86400000),
  };
}

async function main() {
  console.log('=== Finding Markets with Longest Hourly History ===\n');

  // Fetch active markets sorted by oldest first
  const allMarkets: any[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const url = `${GAMMA_API}/markets?active=true&closed=false&limit=100&offset=${offset}&order=startDate&ascending=true`;
    const res = await fetch(url);
    const data: any = await res.json();
    allMarkets.push(...data);
    await sleep(1000);
    if (data.length < 100) break;
  }
  console.log(`Fetched ${allMarkets.length} active markets\n`);

  // Check history for first ~100 (oldest) markets
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
  for (const m of allMarkets.slice(0, 120)) {
    if (!m.clobTokenIds) continue;
    let tokenId = '';
    try { const t = JSON.parse(m.clobTokenIds); tokenId = t[0]; } catch { continue; }
    if (!tokenId) continue;

    const history = await getHistory(tokenId);
    await sleep(400);
    checked++;

    if (history.daysSpan >= 60) { // 60+ days of history
      const vol = m.volume || '0';
      results.push({
        slug: m.slug,
        question: m.question,
        points: history.points,
        firstDate: history.firstDate,
        lastDate: history.lastDate,
        daysSpan: history.daysSpan,
        volume: vol,
      });
      console.log(`  [${results.length}] ${m.slug} (${history.daysSpan}d, ${history.points}h pts, $${Math.round(Number(vol)).toLocaleString()})`);
    }

    if (results.length >= 25) break;
  }

  // Sort by days span
  results.sort((a, b) => b.daysSpan - a.daysSpan);

  console.log(`\n=== TOP MARKETS (${results.length} with 60+ days) ===\n`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${i+1}. PM:${r.slug}`);
    console.log(`   ${r.question}`);
    console.log(`   ${r.firstDate} → ${r.lastDate} (${r.daysSpan}d, ${r.points} hourly pts, vol=$${Math.round(Number(r.volume)).toLocaleString()})`);
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
