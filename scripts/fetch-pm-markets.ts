#!/usr/bin/env npx tsx
/**
 * Fetch long-running Polymarket markets for backtesting
 * Queries Gamma API for market metadata, then fetches price history
 */

// Candidate slugs to search for (mix of event-level and market-level)
const SEARCH_TERMS = [
  'trump', 'biden', 'bitcoin', 'tiktok', 'fed rate', 'election',
  'president', 'ukraine', 'china', 'speaker', 'recession'
];

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  clobTokenIds: string;
  endDate: string;
  category: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  volume?: string;
  volumeNum?: number;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchMarkets(query: string): Promise<GammaMarket[]> {
  const url = `${GAMMA_API}/markets?_q=${encodeURIComponent(query)}&limit=50&closed=true`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Search failed for "${query}": ${res.status}`);
    return [];
  }
  return res.json() as Promise<GammaMarket[]>;
}

async function getMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const url = `${GAMMA_API}/markets?slug=${slug}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as GammaMarket[];
  return data.length > 0 ? data[0] : null;
}

async function getPriceHistoryLength(tokenId: string): Promise<{ points: number; firstDate: string; lastDate: string }> {
  const url = `${CLOB_API}/prices-history?market=${tokenId}&interval=all&fidelity=60`;
  const res = await fetch(url);
  if (!res.ok) return { points: 0, firstDate: '', lastDate: '' };
  const data = await res.json() as { history: Array<{ t: number; p: number }> };
  if (!data.history || data.history.length === 0) return { points: 0, firstDate: '', lastDate: '' };

  const first = new Date(data.history[0].t * 1000).toISOString().split('T')[0];
  const last = new Date(data.history[data.history.length - 1].t * 1000).toISOString().split('T')[0];
  return { points: data.history.length, firstDate: first, lastDate: last };
}

// Direct slugs to try first (binary yes/no markets work best)
const DIRECT_SLUGS = [
  'will-biden-drop-out-of-presidential-race',
  'will-bitcoin-hit-100k-in-2024',
  'tiktok-banned-in-the-us-before-may-2025',
  'will-china-invade-taiwan-in-2024',
  'us-government-shutdown-before-2025',
  'ethereum-etf-approved-in-2024',
  'will-trump-win-the-2024-us-presidential-election',
  'will-kamala-harris-win-the-2024-us-presidential-election',
  'fed-cuts-interest-rates-september',
  'will-there-be-a-recession-in-2024',
  'will-there-be-a-us-recession-in-2025',
  'will-trump-be-convicted-in-the-hush-money-case-before-the-election',
  'will-donald-trump-be-convicted-of-a-felony-before-nov-1',
];

async function main() {
  console.log('=== Fetching Polymarket Markets for Backtesting ===\n');

  const allMarkets: Array<{
    slug: string;
    question: string;
    points: number;
    firstDate: string;
    lastDate: string;
    volume: string;
    hasTokens: boolean;
  }> = [];

  // Try direct slugs first
  console.log('--- Checking direct slugs ---');
  for (const slug of DIRECT_SLUGS) {
    const market = await getMarketBySlug(slug);
    await sleep(800);

    if (!market) {
      console.log(`  ${slug}: NOT FOUND`);
      continue;
    }

    let tokenId = '';
    try {
      const tokens = JSON.parse(market.clobTokenIds || '[]');
      tokenId = tokens[0] || '';
    } catch {}

    if (!tokenId) {
      console.log(`  ${slug}: NO TOKEN ID`);
      continue;
    }

    const history = await getPriceHistoryLength(tokenId);
    await sleep(800);

    const vol = market.volume || market.volumeNum?.toString() || '?';
    console.log(`  ${slug}: ${history.points} points, ${history.firstDate} to ${history.lastDate}, vol=$${vol}`);

    allMarkets.push({
      slug,
      question: market.question,
      points: history.points,
      firstDate: history.firstDate,
      lastDate: history.lastDate,
      volume: vol,
      hasTokens: true,
    });
  }

  // Also search by terms to find more markets
  console.log('\n--- Searching by terms ---');
  const seenSlugs = new Set(DIRECT_SLUGS);

  for (const term of SEARCH_TERMS.slice(0, 4)) { // Limit to save API calls
    const markets = await searchMarkets(term);
    await sleep(800);

    // Filter for binary markets with token IDs
    for (const m of markets) {
      if (seenSlugs.has(m.slug)) continue;
      if (!m.clobTokenIds) continue;
      seenSlugs.add(m.slug);

      let tokenId = '';
      try {
        const tokens = JSON.parse(m.clobTokenIds || '[]');
        tokenId = tokens[0] || '';
      } catch {}

      if (!tokenId) continue;

      const history = await getPriceHistoryLength(tokenId);
      await sleep(800);

      if (history.points > 5000) { // Only long-running markets (5000+ minutes of data)
        const vol = m.volume || m.volumeNum?.toString() || '?';
        console.log(`  ${m.slug}: ${history.points} points, ${history.firstDate} to ${history.lastDate}, vol=$${vol}`);
        allMarkets.push({
          slug: m.slug,
          question: m.question,
          points: history.points,
          firstDate: history.firstDate,
          lastDate: history.lastDate,
          volume: vol,
          hasTokens: true,
        });
      }
    }
  }

  // Sort by data points (longest history first)
  allMarkets.sort((a, b) => b.points - a.points);

  console.log('\n=== RESULTS (sorted by data length) ===\n');
  console.log('Slug | Points | Period | Volume');
  console.log('-----|--------|--------|-------');
  for (const m of allMarkets) {
    console.log(`${m.slug} | ${m.points} | ${m.firstDate} to ${m.lastDate} | $${m.volume}`);
  }

  // Output as JSON for programmatic use
  console.log('\n=== JSON ===');
  console.log(JSON.stringify(allMarkets.filter(m => m.points > 1000), null, 2));
}

main().catch(console.error);
