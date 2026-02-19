/**
 * Polymarket Dynamic Market Selector
 *
 * Screens active Polymarket markets for mean-reversion trading suitability.
 * Uses cached candle data from the DB to compute oscillation metrics without
 * making expensive API calls.
 *
 * Key insight: Markets that oscillate (price crosses SMA repeatedly) are more
 * suitable for mean-reversion than markets converging to 0 or 1.
 */

import { getPool } from './db.js';

// ============================================================================
// Types
// ============================================================================

export interface MarketSelectorOptions {
  /** Minimum current price (default: 0.15) */
  minPrice?: number;
  /** Maximum current price (default: 0.85) */
  maxPrice?: number;
  /** Minimum days until resolution (default: 30) */
  minDaysToResolution?: number;
  /** Minimum total USD volume (default: 5000) */
  minVolume?: number;
  /** Minimum days of cached candle data required (default: 14) */
  minDataDays?: number;
  /** Minimum fraction of bars with real volume (default: 0.3) */
  minVolumeActivity?: number;
  /** Minimum average Bollinger Band width to avoid flat markets (default: 0.05) */
  minBBWidth?: number;
  /** Minimum SMA crossover count in available data (default: 3) */
  minCrossovers?: number;
  /** Maximum markets to return (default: all that pass) */
  limit?: number;
}

export interface MarketSelection {
  slug: string;
  question: string;
  currentPrice: number;
  daysToResolution: number;
  volume: number;
  liquidity: number;
  oscillationScore: number;
  smaCrossovers: number;
  avgBBWidth: number;
  volumeActivity: number;
  priceRange: number;
  dataPoints: number;
  recommendation: 'strong' | 'moderate' | 'weak';
}

// ============================================================================
// Category / keyword blacklist
// ============================================================================

const BLACKLISTED_SLUG_PATTERNS = [
  'mlb', 'nba', 'nfl', 'nhl', 'epl', 'ufc', 'mls', 'laliga', 'serie-a',
  'bundesliga', 'champions-league', 'premier-league', 'la-liga', 'ligue-1',
  'cricket', 'tennis', 'f1', 'boxing', 'mma', 'wrestling', 'rugby',
  'hockey', 'volleyball', 'basketball', 'copa', 'wimbledon', 'grand-prix',
  'world-cup', 'cs2', 'lol-', 'dota', 'valorant', 'crint-',
  'bitcoin-up-or-down', 'eth-up-or-down', 'btc-up-or-down',
  'spread-home', 'spread-away',
];

// Date + team abbreviation: e.g. "2026-02-xyz-vs-abc"
const DATE_TEAM_PATTERN = /\d{4}-\d{2}-[a-z]{2,5}-[a-z]{2,5}/;

// Pure team abbreviation slug: e.g. "lal-gir-bar"
const TEAM_ABBREV_PATTERN = /^[a-z]{2,5}-[a-z]{2,5}-[a-z]{2,5}(-[a-z]{2,5})*$/;

function isBlacklisted(slug: string, question: string): boolean {
  const slugLower = slug.toLowerCase();
  const questionLower = question.toLowerCase();

  for (const pattern of BLACKLISTED_SLUG_PATTERNS) {
    if (slugLower.includes(pattern) || questionLower.includes(pattern)) {
      return true;
    }
  }

  if (DATE_TEAM_PATTERN.test(slugLower)) return true;

  const parts = slugLower.split('-');
  if (
    parts.length >= 3 &&
    parts.every((p) => p.length >= 2 && p.length <= 5 && /^[a-z]+$/.test(p)) &&
    TEAM_ABBREV_PATTERN.test(slugLower)
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Gamma API types and fetching
// ============================================================================

interface GammaApiMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices?: string; // JSON string like '["0.6","0.4"]'
  volume?: string;
  endDate?: string;
  startDate?: string;
  liquidityNum?: number;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  clobTokenIds?: string;
}

const GAMMA_API = 'https://gamma-api.polymarket.com';
const GAMMA_PAGE_SIZE = 100;

async function fetchGammaPage(offset: number): Promise<GammaApiMarket[]> {
  const url = `${GAMMA_API}/markets?limit=${GAMMA_PAGE_SIZE}&active=true&closed=false&order=volume&ascending=false&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Gamma API request failed: ${res.status} ${res.statusText} (offset=${offset})`
    );
  }
  return res.json() as Promise<GammaApiMarket[]>;
}

async function fetchAllActiveMarkets(maxMarkets = 500): Promise<GammaApiMarket[]> {
  const all: GammaApiMarket[] = [];
  let offset = 0;

  while (offset < maxMarkets) {
    const batch = await fetchGammaPage(offset);
    all.push(...batch);
    if (batch.length < GAMMA_PAGE_SIZE) break;
    offset += GAMMA_PAGE_SIZE;
    // Small delay to be polite to the API
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}

// ============================================================================
// DB candle queries
// ============================================================================

interface CandleRow {
  timestamp: number;
  close: number;
  volume: number;
}

interface CachedSymbolSummary {
  symbol: string;
  candleCount: number;
  realCandleCount: number;
  minTs: number;
  maxTs: number;
}

/**
 * Get all PM symbols that have candles cached in the DB (1h timeframe).
 */
async function getCachedPMSymbols(): Promise<CachedSymbolSummary[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT symbol,
            COUNT(*) as "candleCount",
            SUM(CASE WHEN volume > 0 THEN 1 ELSE 0 END) as "realCandleCount",
            MIN(timestamp) as "minTs",
            MAX(timestamp) as "maxTs"
     FROM candles
     WHERE exchange = 'polymarket' AND timeframe = '1h'
     GROUP BY symbol`
  );
  return result.rows.map((row) => ({
    symbol: row.symbol,
    candleCount: Number(row.candleCount),
    realCandleCount: Number(row.realCandleCount),
    minTs: Number(row.minTs),
    maxTs: Number(row.maxTs),
  }));
}

/**
 * Get candles for a specific PM symbol from DB cache.
 */
async function getSymbolCandles(symbol: string): Promise<CandleRow[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT timestamp, close, volume
     FROM candles
     WHERE exchange = 'polymarket' AND symbol = $1 AND timeframe = '1h'
     ORDER BY timestamp ASC`,
    [symbol]
  );
  return result.rows.map((row) => ({
    timestamp: Number(row.timestamp),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

// ============================================================================
// Technical indicator calculations
// ============================================================================

/**
 * Calculate simple moving average over an array (returns array of same length,
 * leading values are NaN until enough data).
 */
function calcSMA(prices: number[], period: number): number[] {
  const sma: number[] = new Array(prices.length).fill(NaN);
  let sum = 0;

  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) {
      sum -= prices[i - period];
    }
    if (i >= period - 1) {
      sma[i] = sum / period;
    }
  }

  return sma;
}

/**
 * Calculate Bollinger Band width (upper - lower) / middle for each bar.
 * Returns array of widths (NaN for leading bars).
 */
function calcBBWidth(prices: number[], period = 20, stdDevMult = 2): number[] {
  const widths: number[] = new Array(prices.length).fill(NaN);

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);

    if (mean === 0) continue;

    const upper = mean + stdDevMult * stdDev;
    const lower = mean - stdDevMult * stdDev;
    widths[i] = (upper - lower) / mean;
  }

  return widths;
}

/**
 * Count SMA crossovers: number of times price crosses from above to below or
 * below to above the SMA line.
 */
function countSMACrossovers(prices: number[], sma: number[], maxBars = 200): number {
  const startIdx = Math.max(0, prices.length - maxBars);
  let crossovers = 0;
  let prevAbove: boolean | null = null;

  for (let i = startIdx; i < prices.length; i++) {
    if (isNaN(sma[i])) continue;

    const above = prices[i] > sma[i];
    if (prevAbove !== null && above !== prevAbove) {
      crossovers++;
    }
    prevAbove = above;
  }

  return crossovers;
}

// ============================================================================
// Oscillation scoring
// ============================================================================

interface OscillationMetrics {
  priceRange: number;
  smaCrossovers: number;
  avgBBWidth: number;
  volumeActivity: number;
  oscillationScore: number;
  currentPrice: number;
  dataPoints: number;
}

function computeOscillationMetrics(candles: CandleRow[]): OscillationMetrics | null {
  if (candles.length < 20) return null;

  const prices = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  // Price range
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  // Current price (last close)
  const currentPrice = prices[prices.length - 1];

  // SMA crossovers over last 200 bars
  const sma = calcSMA(prices, 20);
  const smaCrossovers = countSMACrossovers(prices, sma, 200);

  // BB width
  const bbWidths = calcBBWidth(prices, 20, 2);
  const validWidths = bbWidths.filter((w) => !isNaN(w));
  const avgBBWidth = validWidths.length > 0
    ? validWidths.reduce((a, b) => a + b, 0) / validWidths.length
    : 0;

  // Volume activity: fraction of bars with non-zero volume
  const barsWithVolume = volumes.filter((v) => v > 0).length;
  const volumeActivity = barsWithVolume / candles.length;

  // Oscillation score: product of key metrics (normalized)
  // smaCrossovers is bounded by dividing by expected max (e.g. 50 crossovers = very active)
  const normalizedCrossovers = Math.min(smaCrossovers / 50, 1);
  const oscillationScore = normalizedCrossovers * avgBBWidth * volumeActivity;

  return {
    priceRange,
    smaCrossovers,
    avgBBWidth,
    volumeActivity,
    oscillationScore,
    currentPrice,
    dataPoints: candles.length,
  };
}

// ============================================================================
// Recommendation logic
// ============================================================================

function getRecommendation(
  metrics: OscillationMetrics,
  _selection: Omit<MarketSelection, 'recommendation'>
): 'strong' | 'moderate' | 'weak' {
  // Thresholds calibrated from walk-forward survivor data:
  // WF survivors scored 0.087-0.245, with crossovers 16-58, BBW 0.16-0.28
  // P75 of qualifying markets = ~0.11
  const isStrong =
    metrics.oscillationScore >= 0.10 &&
    metrics.smaCrossovers >= 20 &&
    metrics.volumeActivity > 0.5 &&
    metrics.currentPrice >= 0.15 &&
    metrics.currentPrice <= 0.85;

  if (isStrong) return 'strong';

  const isModerate =
    metrics.oscillationScore >= 0.04 &&
    metrics.smaCrossovers >= 10 &&
    metrics.avgBBWidth >= 0.05 &&
    metrics.volumeActivity >= 0.3;

  if (isModerate) return 'moderate';

  return 'weak';
}

// ============================================================================
// Main selector function
// ============================================================================

const DEFAULT_OPTIONS: Required<MarketSelectorOptions> = {
  minPrice: 0.15,
  maxPrice: 0.85,
  minDaysToResolution: 30,
  minVolume: 5000,
  minDataDays: 14,
  minVolumeActivity: 0.3,
  minBBWidth: 0.05,
  minCrossovers: 3,
  limit: Infinity,
};

/**
 * Select Polymarket markets suitable for mean-reversion trading.
 *
 * Fetches active markets from Gamma API, then filters and scores them
 * using cached candle data from the local DB. Markets without cached data
 * are skipped to avoid expensive API calls.
 *
 * @param options - Filter and scoring options
 * @returns Ranked list of market selections, sorted by oscillation score descending
 */
export async function selectMarkets(
  options?: MarketSelectorOptions
): Promise<MarketSelection[]> {
  const opts: Required<MarketSelectorOptions> = { ...DEFAULT_OPTIONS, ...options };
  const now = Date.now();

  // Step 1: Fetch active markets from Gamma API
  let gammaMarkets: GammaApiMarket[];
  try {
    gammaMarkets = await fetchAllActiveMarkets(1000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch markets from Gamma API: ${msg}`);
  }

  // Step 2: Build a lookup map from slug -> gamma market data
  const gammaBySlug = new Map<string, GammaApiMarket>();
  for (const m of gammaMarkets) {
    if (m.slug) {
      gammaBySlug.set(m.slug, m);
    }
  }

  // Step 3: Get all cached PM symbols from DB
  const cachedSymbols = await getCachedPMSymbols();

  // Build slug -> cached summary map
  // PM symbols in DB are stored as "PM:slug-name"
  const cachedBySlug = new Map<
    string,
    CachedSymbolSummary & { slug: string }
  >();
  for (const row of cachedSymbols) {
    if (!row.symbol.startsWith('PM:')) continue;
    const slug = row.symbol.slice(3);
    cachedBySlug.set(slug, { ...row, slug });
  }

  // Step 4: For each cached symbol, apply filters and compute metrics
  const results: MarketSelection[] = [];

  for (const [slug, cached] of cachedBySlug) {
    // Check if we have Gamma API data for this market
    const gamma = gammaBySlug.get(slug);

    // --- Filter: Blacklist check ---
    const question = gamma?.question ?? slug;
    if (isBlacklisted(slug, question)) continue;

    // --- Filter: Volume ---
    const volume = parseFloat(gamma?.volume ?? '0') || 0;
    if (volume < opts.minVolume) continue;

    // --- Filter: Days to resolution ---
    let daysToResolution = Infinity;
    if (gamma?.endDate) {
      const endTs = new Date(gamma.endDate).getTime();
      if (!isNaN(endTs)) {
        daysToResolution = (endTs - now) / (24 * 60 * 60 * 1000);
        if (daysToResolution < opts.minDaysToResolution) continue;
      }
    } else {
      // No end date — skip (can't assess resolution timing)
      continue;
    }

    // --- Filter: Minimum data days ---
    const dataSpanDays = (cached.maxTs - cached.minTs) / (24 * 60 * 60 * 1000);
    if (dataSpanDays < opts.minDataDays) continue;

    // --- Load candles and compute metrics ---
    const candles = await getSymbolCandles(cached.symbol);
    if (candles.length < 20) continue;

    const metrics = computeOscillationMetrics(candles);
    if (!metrics) continue;

    // --- Filter: Price range ---
    if (metrics.currentPrice < opts.minPrice || metrics.currentPrice > opts.maxPrice) continue;

    // --- Filter: Volume activity ---
    if (metrics.volumeActivity < opts.minVolumeActivity) continue;

    // --- Filter: BB width ---
    if (metrics.avgBBWidth < opts.minBBWidth) continue;

    // --- Filter: SMA crossovers ---
    if (metrics.smaCrossovers < opts.minCrossovers) continue;

    // --- Parse liquidity ---
    const liquidity =
      gamma?.liquidityNum ?? (parseFloat(gamma?.liquidity ?? '0') || 0);

    // --- Parse current price from outcomePrices if gamma data available ---
    // Prefer live price from Gamma API over DB last close
    let currentPrice = metrics.currentPrice;
    if (gamma?.outcomePrices) {
      try {
        const prices = JSON.parse(gamma.outcomePrices) as (number | string)[];
        if (Array.isArray(prices) && prices.length > 0) {
          const parsed = Number(prices[0]);
          if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
            currentPrice = parsed;
          }
        }
      } catch {
        // Keep DB price
      }
    }

    const selectionWithoutRec: Omit<MarketSelection, 'recommendation'> = {
      slug,
      question,
      currentPrice,
      daysToResolution: Math.round(daysToResolution),
      volume,
      liquidity,
      oscillationScore: metrics.oscillationScore,
      smaCrossovers: metrics.smaCrossovers,
      avgBBWidth: metrics.avgBBWidth,
      volumeActivity: metrics.volumeActivity,
      priceRange: metrics.priceRange,
      dataPoints: metrics.dataPoints,
    };

    const recommendation = getRecommendation(metrics, selectionWithoutRec);

    results.push({
      ...selectionWithoutRec,
      recommendation,
    });
  }

  // Sort by oscillation score descending, then by volume as tiebreaker
  results.sort((a, b) => {
    if (b.oscillationScore !== a.oscillationScore) {
      return b.oscillationScore - a.oscillationScore;
    }
    return b.volume - a.volume;
  });

  // Apply limit
  if (opts.limit !== Infinity && results.length > opts.limit) {
    return results.slice(0, opts.limit);
  }

  return results;
}
