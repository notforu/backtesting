#!/usr/bin/env npx tsx
/**
 * Polymarket Market Discovery and Cache Population Script
 *
 * Discovers top active Polymarket markets and pre-caches their full hourly history.
 * Supports resume capability: markets already cached are skipped on re-run.
 *
 * Usage: npx tsx scripts/pm-discover-and-cache.ts
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { PolymarketProvider } from '../src/data/providers/polymarket.js';
import { saveCandles } from '../src/data/db.js';
import type { GammaMarket } from '../src/data/providers/polymarket-types.js';

// ============================================================================
// Configuration
// ============================================================================

const GAMMA_API = 'https://gamma-api.polymarket.com';
const RESULTS_DIR = '/workspace/results/pm-pipeline';
const MANIFEST_PATH = join(RESULTS_DIR, 'manifest.json');

const MIN_VOLUME = 5_000;
const MIN_AGE_DAYS = 30;
const MIN_DAYS_UNTIL_RESOLUTION = 14;
const MIN_PROBABILITY = 0.05;
const MAX_PROBABILITY = 0.95;

const GAMMA_PAGE_SIZE = 100;
const GAMMA_MAX_MARKETS = 1000;
const GAMMA_PAGE_DELAY_MS = 500;

const CACHE_START_DATE = new Date('2024-01-01');

// ============================================================================
// Blacklist keyword patterns
// ============================================================================

// Sports keywords to match against slug and question
const SPORTS_KEYWORDS = [
  'mlb', 'nba', 'nfl', 'nhl', 'epl', 'ufc', 'mls', 'laliga', 'serie-a',
  'bundesliga', 'champions-league', 'cricket', 'tennis', 'f1', 'boxing',
  'mma', 'wrestling', 'rugby', 'hockey', 'volleyball', 'basketball',
  'copa', 'wimbledon', 'grand-prix', 'world-cup',
];

// Football/soccer specific patterns
const FOOTBALL_PATTERNS = [
  'premier-league', 'la-liga', 'serie-a', 'ligue-1', 'eredivisie',
  'champions-league', 'europa-league', 'fa-cup', 'world-cup', 'euro-',
  'copa-america', 'concacaf',
];

// Short-term event keywords
const SHORT_TERM_KEYWORDS = [
  'bitcoin-up-or-down', 'eth-up-or-down', 'btc-up-or-down',
  'spread-home', 'spread-away', 'total-',
];

// CS2 / esports patterns
const ESPORTS_PATTERNS = ['cs2-', 'crint-'];

// Date-in-slug with team abbreviation pattern: e.g. "2026-02-xyz-vs-abc"
const DATE_TEAM_PATTERN = /\d{4}-\d{2}-[a-z]{2,5}-[a-z]{2,5}/;

// Team abbreviation slug: e.g. "lal-gir-bar" (3-4 letter codes separated by dashes, 3+ groups)
const TEAM_ABBREV_PATTERN = /^[a-z]{2,5}-[a-z]{2,5}-[a-z]{2,5}(-[a-z]{2,5})*$/;

// ============================================================================
// Manifest types
// ============================================================================

interface ManifestMarket {
  slug: string;
  question: string;
  volume: string;
  category: string;
  endDate: string;
  cacheStatus: 'pending' | 'cached' | 'failed';
  candleCount: number;
  realCandleCount: number;
  dataSpanDays: number;
  errorMessage: string | null;
}

interface Manifest {
  timestamp: string;
  discoveredTotal: number;
  afterScreening: number;
  markets: ManifestMarket[];
}

// ============================================================================
// Utility functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

// ============================================================================
// Discovery: Fetch markets from Gamma API
// ============================================================================

async function fetchGammaPage(offset: number): Promise<GammaMarket[]> {
  const url = `${GAMMA_API}/markets?limit=${GAMMA_PAGE_SIZE}&active=true&closed=false&order=volume&ascending=false&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma API request failed: ${res.status} ${res.statusText} (offset=${offset})`);
  }
  return res.json() as Promise<GammaMarket[]>;
}

async function discoverMarkets(): Promise<GammaMarket[]> {
  const allMarkets: GammaMarket[] = [];
  let offset = 0;

  console.log(`[Discovery] Fetching markets from Gamma API (page size: ${GAMMA_PAGE_SIZE}, max: ${GAMMA_MAX_MARKETS})...`);

  while (offset < GAMMA_MAX_MARKETS) {
    const batch = await fetchGammaPage(offset);
    allMarkets.push(...batch);

    if (batch.length < GAMMA_PAGE_SIZE) {
      // Fewer results than requested means we've reached the end
      break;
    }

    offset += GAMMA_PAGE_SIZE;

    if (offset < GAMMA_MAX_MARKETS) {
      await sleep(GAMMA_PAGE_DELAY_MS);
    }
  }

  console.log(`[Discovery] Fetched ${allMarkets.length} markets from Gamma API`);
  return allMarkets;
}

// ============================================================================
// Screening: Filter markets based on criteria
// ============================================================================

interface ScreeningStats {
  sports: number;
  shortTerm: number;
  extremePrice: number;
  noData: number;
  lowVolume: number;
  tooNew: number;
  resolvingTooSoon: number;
}

function isBlacklistedSlug(slug: string, question: string): { excluded: boolean; reason: 'sports' | 'shortTerm' | null } {
  const slugLower = slug.toLowerCase();
  const questionLower = question.toLowerCase();

  // Check sports keywords against both slug and question
  for (const kw of SPORTS_KEYWORDS) {
    if (slugLower.includes(kw) || questionLower.includes(kw)) {
      return { excluded: true, reason: 'sports' };
    }
  }

  // Check football patterns
  for (const kw of FOOTBALL_PATTERNS) {
    if (slugLower.includes(kw)) {
      return { excluded: true, reason: 'sports' };
    }
  }

  // Check short-term keywords
  for (const kw of SHORT_TERM_KEYWORDS) {
    if (slugLower.includes(kw)) {
      return { excluded: true, reason: 'shortTerm' };
    }
  }

  // Check esports patterns
  for (const kw of ESPORTS_PATTERNS) {
    if (slugLower.startsWith(kw) || slugLower.includes(kw)) {
      return { excluded: true, reason: 'sports' };
    }
  }

  // Check date + team abbreviation pattern (e.g. "2026-02-xyz-vs-abc")
  if (DATE_TEAM_PATTERN.test(slugLower)) {
    return { excluded: true, reason: 'sports' };
  }

  // Check pure team abbreviation slug (e.g. "lal-gir-bar")
  // Only for short slugs that look like sports team codes
  const slugParts = slugLower.split('-');
  if (slugParts.length >= 3 && slugParts.every((p) => p.length >= 2 && p.length <= 5 && /^[a-z]+$/.test(p))) {
    if (TEAM_ABBREV_PATTERN.test(slugLower)) {
      return { excluded: true, reason: 'sports' };
    }
  }

  return { excluded: false, reason: null };
}

function screenMarkets(markets: GammaMarket[]): { passed: ManifestMarket[]; stats: ScreeningStats } {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const fourteenDaysFromNow = now + 14 * 24 * 60 * 60 * 1000;

  const stats: ScreeningStats = {
    sports: 0,
    shortTerm: 0,
    extremePrice: 0,
    noData: 0,
    lowVolume: 0,
    tooNew: 0,
    resolvingTooSoon: 0,
  };

  const passed: ManifestMarket[] = [];

  for (const market of markets) {
    // Volume filter
    const volume = parseFloat(market.volume ?? '0');
    if (isNaN(volume) || volume < MIN_VOLUME) {
      stats.lowVolume++;
      continue;
    }

    // Age filter: market must have been created > 30 days ago
    // Use startDate or createdAt if available; fall back to endDate as proxy if not available
    // GammaMarket interface doesn't have startDate, but the API may return it
    const marketData = market as GammaMarket & { startDate?: string; createdAt?: string };
    const createdAtStr = marketData.startDate ?? marketData.createdAt;
    if (createdAtStr) {
      const createdAt = new Date(createdAtStr).getTime();
      if (isNaN(createdAt) || createdAt > thirtyDaysAgo) {
        stats.tooNew++;
        continue;
      }
    }

    // Resolution date filter: must resolve > 14 days from now
    const endDate = market.endDate ? new Date(market.endDate).getTime() : null;
    if (!endDate || isNaN(endDate) || endDate < fourteenDaysFromNow) {
      stats.resolvingTooSoon++;
      continue;
    }

    // Blacklist filter
    const blacklistResult = isBlacklistedSlug(market.slug, market.question);
    if (blacklistResult.excluded) {
      if (blacklistResult.reason === 'sports') stats.sports++;
      else if (blacklistResult.reason === 'shortTerm') stats.shortTerm++;
      continue;
    }

    // clobTokenIds filter: must have valid JSON array with >= 1 element
    if (!market.clobTokenIds) {
      stats.noData++;
      continue;
    }
    let tokenIds: string[];
    try {
      tokenIds = JSON.parse(market.clobTokenIds);
    } catch {
      stats.noData++;
      continue;
    }
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      stats.noData++;
      continue;
    }

    // Extreme price filter: check outcomePrices field
    const marketWithPrices = market as GammaMarket & { outcomePrices?: string };
    if (marketWithPrices.outcomePrices) {
      let prices: number[];
      try {
        prices = JSON.parse(marketWithPrices.outcomePrices) as number[];
        if (Array.isArray(prices) && prices.length > 0) {
          const yesProbability = Number(prices[0]);
          if (!isNaN(yesProbability)) {
            if (yesProbability < MIN_PROBABILITY || yesProbability > MAX_PROBABILITY) {
              stats.extremePrice++;
              continue;
            }
          }
        }
      } catch {
        // If outcomePrices can't be parsed, allow through (don't exclude)
      }
    }

    passed.push({
      slug: market.slug,
      question: market.question,
      volume: market.volume ?? '0',
      category: market.category ?? 'unknown',
      endDate: market.endDate ?? '',
      cacheStatus: 'pending',
      candleCount: 0,
      realCandleCount: 0,
      dataSpanDays: 0,
      errorMessage: null,
    });
  }

  return { passed, stats };
}

// ============================================================================
// Caching: Fetch and save candles for each market
// ============================================================================

async function cacheMarket(
  provider: PolymarketProvider,
  market: ManifestMarket,
  index: number,
  total: number,
  startTime: number
): Promise<void> {
  const symbol = `PM:${market.slug}`;
  const now = new Date();

  const elapsed = Date.now() - startTime;
  const cachedSoFar = index; // markets already processed before this one
  const remaining = total - cachedSoFar;
  const avgTimePerMarket = cachedSoFar > 0 ? elapsed / cachedSoFar : 0;
  const estimatedRemaining = avgTimePerMarket > 0 ? Math.round((remaining * avgTimePerMarket) / 60000) : null;
  const etaStr = estimatedRemaining !== null ? `~${estimatedRemaining} min remaining` : 'calculating...';

  const pct = Math.round(((index + 1) / total) * 100);
  process.stdout.write(`[${index + 1}/${total}] ${pct}% cached | ${symbol} -> `);

  try {
    const candles = await provider.fetchCandles(symbol, '1h', CACHE_START_DATE, now);

    if (candles.length > 0) {
      await saveCandles(candles, 'polymarket', symbol, '1h');

      const realCandles = candles.filter((c) => c.volume > 0);
      const firstTs = candles[0].timestamp;
      const lastTs = candles[candles.length - 1].timestamp;
      const dataSpanDays = Math.round((lastTs - firstTs) / (1000 * 60 * 60 * 24));

      market.cacheStatus = 'cached';
      market.candleCount = candles.length;
      market.realCandleCount = realCandles.length;
      market.dataSpanDays = dataSpanDays;
      market.errorMessage = null;

      console.log(`${candles.length.toLocaleString()} candles (${dataSpanDays} days) | ${etaStr}`);
    } else {
      market.cacheStatus = 'failed';
      market.errorMessage = 'No candles returned (empty result)';
      console.log(`FAILED: No candles returned | ${etaStr}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    market.cacheStatus = 'failed';
    market.errorMessage = errorMessage;
    console.log(`FAILED: ${errorMessage} | ${etaStr}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Ensure output directory exists
  mkdirSync(RESULTS_DIR, { recursive: true });

  let manifest = loadManifest();

  if (manifest) {
    const pendingCount = manifest.markets.filter((m) => m.cacheStatus !== 'cached').length;
    const cachedCount = manifest.markets.filter((m) => m.cacheStatus === 'cached').length;
    console.log(`[Resume] Loaded existing manifest with ${manifest.markets.length} markets`);
    console.log(`[Resume] ${cachedCount} already cached, ${pendingCount} pending/failed - will skip cached`);
  } else {
    // Discovery phase
    const allMarkets = await discoverMarkets();

    // Screening phase
    const { passed, stats } = screenMarkets(allMarkets);

    // Sort by volume DESC
    passed.sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume));

    const totalExcluded = allMarkets.length - passed.length;
    console.log(
      `[Screening] ${passed.length} markets passed filters ` +
      `(${totalExcluded} excluded: ${stats.sports} sports, ` +
      `${stats.shortTerm} short-term, ` +
      `${stats.extremePrice} extreme price, ` +
      `${stats.noData} no data, ` +
      `${stats.lowVolume} low volume, ` +
      `${stats.tooNew} too new, ` +
      `${stats.resolvingTooSoon} resolving soon)`
    );

    manifest = {
      timestamp: new Date().toISOString(),
      discoveredTotal: allMarkets.length,
      afterScreening: passed.length,
      markets: passed,
    };

    saveManifest(manifest);
    console.log(`[Manifest] Saved to ${MANIFEST_PATH}`);
  }

  // Caching phase
  const marketsToDo = manifest.markets.filter((m) => m.cacheStatus !== 'cached');
  const totalMarkets = manifest.markets.length;
  const alreadyCached = totalMarkets - marketsToDo.length;

  if (marketsToDo.length === 0) {
    console.log(`[Caching] All ${totalMarkets} markets already cached. Nothing to do.`);
    return;
  }

  console.log(`[Caching] Starting cache population for ${marketsToDo.length} markets (${alreadyCached} already cached)...`);

  const provider = new PolymarketProvider();
  const cacheStartTime = Date.now();

  // We process markets in the order they appear in the manifest
  // Track global index for progress display
  let processedCount = alreadyCached;

  for (const market of manifest.markets) {
    if (market.cacheStatus === 'cached') continue;

    await cacheMarket(provider, market, processedCount, totalMarkets, cacheStartTime);
    processedCount++;

    // Save manifest after every market for resume capability
    saveManifest(manifest);
  }

  // Final summary
  const cachedCount = manifest.markets.filter((m) => m.cacheStatus === 'cached').length;
  const failedCount = manifest.markets.filter((m) => m.cacheStatus === 'failed').length;
  const totalElapsed = Date.now() - cacheStartTime;

  console.log('\n=== CACHE POPULATION COMPLETE ===');
  console.log(`Total markets: ${totalMarkets}`);
  console.log(`Cached: ${cachedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Time elapsed: ${formatDuration(totalElapsed)}`);
  console.log(`Manifest: ${MANIFEST_PATH}`);

  if (failedCount > 0) {
    console.log('\nFailed markets:');
    for (const m of manifest.markets.filter((m) => m.cacheStatus === 'failed')) {
      console.log(`  - ${m.slug}: ${m.errorMessage}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
