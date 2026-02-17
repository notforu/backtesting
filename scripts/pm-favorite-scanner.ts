/**
 * Polymarket Favorite Compounder Scanner
 *
 * Exploits the Favorite-Longshot Bias: high-probability outcomes (YES price > 0.85)
 * resolve favorably more often than the price implies.
 *
 * Usage: npx tsx scripts/pm-favorite-scanner.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

interface GammaMarket {
  question: string;
  slug: string;
  clobTokenIds: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  volume: string;
  outcomePrices: string; // JSON array like "[0.95, 0.05]"
}

interface CLOBPriceResponse {
  price: string;
}

interface FavoriteMarket {
  question: string;
  slug: string;
  tokenId: string;
  price: number;
  volume: number;
  endDate: Date;
  daysToResolution: number;
  expectedYield: number; // e.g., 0.111 for 11.1%
  annualizedYield: number;
  riskAdjustedScore: number;
  allocation: number;
}

interface PortfolioRecommendation {
  markets: FavoriteMarket[];
  totalCapital: number;
  maxPerMarket: number;
  expectedPortfolioYield: number;
  expectedWinRate: number;
  expectedLossOnLosingMarket: number;
  netExpectedReturn: number;
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  GAMMA_API: 'https://gamma-api.polymarket.com',
  CLOB_API: 'https://clob.polymarket.com',
  MIN_PRICE: 0.85,
  MIN_VOLUME: 100_000,
  MIN_DAYS_TO_RESOLUTION: 7,
  MAX_DAYS_TO_RESOLUTION: 60,
  TOTAL_CAPITAL: 1000,
  MAX_PER_MARKET: 200,
  TARGET_NUM_MARKETS: 5, // Minimum markets
  MAX_NUM_MARKETS: 7, // Maximum markets
  RATE_LIMIT_MS: 6000, // 10 requests per minute = 6 seconds between requests
  EXPECTED_WIN_RATE: 0.875, // 87.5% based on Kalshi study (85-90% range)
};

// ============================================================================
// API Clients
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchActiveMarkets(): Promise<GammaMarket[]> {
  console.log('Fetching active markets from Gamma API...');

  let allMarkets: GammaMarket[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${CONFIG.GAMMA_API}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const markets = await response.json() as GammaMarket[];

    if (markets.length === 0) {
      break;
    }

    allMarkets = allMarkets.concat(markets);
    console.log(`  Fetched ${allMarkets.length} markets...`);

    if (markets.length < limit) {
      break; // Last page
    }

    offset += limit;
    await sleep(1000); // Be nice to the API
  }

  console.log(`Total active markets: ${allMarkets.length}`);
  return allMarkets;
}

async function fetchCLOBPrice(tokenId: string): Promise<number | null> {
  try {
    const url = `${CONFIG.CLOB_API}/price?token_id=${tokenId}&side=buy`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as CLOBPriceResponse;
    return parseFloat(data.price);
  } catch (error) {
    return null;
  }
}

// ============================================================================
// Market Analysis
// ============================================================================

function parseOutcomePrices(outcomePrices: string): number | null {
  try {
    const prices = JSON.parse(outcomePrices);
    if (Array.isArray(prices) && prices.length > 0) {
      const price = typeof prices[0] === 'string' ? parseFloat(prices[0]) : prices[0];
      return isNaN(price) ? null : price;
    }
    return null;
  } catch {
    return null;
  }
}

function calculateMetrics(price: number, daysToResolution: number): {
  expectedYield: number;
  annualizedYield: number;
  riskAdjustedScore: number;
} {
  // Expected yield: if price is 0.90, buying YES costs $0.90, pays $1.00 on resolution
  const expectedYield = (1.0 - price) / price;

  // Annualized yield
  const annualizedYield = expectedYield * (365 / daysToResolution);

  // Risk-adjusted score: penalize markets closer to 50%
  // Higher score = better (higher yield, higher confidence)
  const riskAdjustedScore = expectedYield / (1 - price);

  return { expectedYield, annualizedYield, riskAdjustedScore };
}

async function findFavoriteMarkets(markets: GammaMarket[]): Promise<FavoriteMarket[]> {
  console.log('\nAnalyzing markets for favorites...');

  const favorites: FavoriteMarket[] = [];
  const now = new Date();
  let rateLimitCount = 0;

  for (const market of markets) {
    // Check basic filters
    const volume = parseFloat(market.volume);
    if (volume < CONFIG.MIN_VOLUME) continue;

    if (!market.endDate) continue;
    const endDate = new Date(market.endDate);
    const daysToResolution = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysToResolution < CONFIG.MIN_DAYS_TO_RESOLUTION ||
        daysToResolution > CONFIG.MAX_DAYS_TO_RESOLUTION) {
      continue;
    }

    // Get YES price
    let yesPrice: number | null = null;

    // Try outcomePrices first (faster, no API call needed)
    if (market.outcomePrices) {
      yesPrice = parseOutcomePrices(market.outcomePrices);
    }

    // Fall back to CLOB API if needed
    if (yesPrice === null && market.clobTokenIds) {
      const tokenIds = market.clobTokenIds.split(',');
      if (tokenIds.length > 0) {
        const tokenId = tokenIds[0].trim();

        // Rate limiting
        if (rateLimitCount > 0) {
          await sleep(CONFIG.RATE_LIMIT_MS);
        }

        yesPrice = await fetchCLOBPrice(tokenId);
        rateLimitCount++;

        if (rateLimitCount % 10 === 0) {
          console.log(`  Checked ${rateLimitCount} markets via CLOB API...`);
        }
      }
    }

    if (yesPrice === null || yesPrice < CONFIG.MIN_PRICE) continue;

    // Calculate metrics
    const metrics = calculateMetrics(yesPrice, daysToResolution);

    favorites.push({
      question: market.question,
      slug: market.slug,
      tokenId: market.clobTokenIds.split(',')[0].trim(),
      price: yesPrice,
      volume,
      endDate,
      daysToResolution: Math.round(daysToResolution),
      expectedYield: metrics.expectedYield,
      annualizedYield: metrics.annualizedYield,
      riskAdjustedScore: metrics.riskAdjustedScore,
      allocation: 0, // Will be set later
    });
  }

  console.log(`Found ${favorites.length} favorite markets (price >= ${CONFIG.MIN_PRICE})`);
  return favorites;
}

// ============================================================================
// Portfolio Construction
// ============================================================================

function buildPortfolio(favorites: FavoriteMarket[]): PortfolioRecommendation {
  // Sort by risk-adjusted score (higher is better)
  const sorted = favorites.sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore);

  // Select top markets
  const numMarkets = Math.min(
    Math.max(sorted.length, CONFIG.TARGET_NUM_MARKETS),
    CONFIG.MAX_NUM_MARKETS
  );
  const selected = sorted.slice(0, numMarkets);

  // Allocate capital
  const allocationPerMarket = Math.min(
    CONFIG.MAX_PER_MARKET,
    CONFIG.TOTAL_CAPITAL / numMarkets
  );

  selected.forEach(market => {
    market.allocation = allocationPerMarket;
  });

  // Calculate portfolio metrics
  const totalAllocated = selected.reduce((sum, m) => sum + m.allocation, 0);
  const weightedYield = selected.reduce(
    (sum, m) => sum + (m.expectedYield * m.allocation / totalAllocated),
    0
  );

  // Expected outcomes
  const expectedWinRate = CONFIG.EXPECTED_WIN_RATE;
  const expectedWins = Math.floor(numMarkets * expectedWinRate);
  const expectedLosses = numMarkets - expectedWins;

  // Calculate expected return
  const avgWinAmount = selected
    .slice(0, expectedWins)
    .reduce((sum, m) => sum + (m.allocation * m.expectedYield), 0) / expectedWins;

  const avgLossAmount = allocationPerMarket; // Lose entire stake

  const expectedReturn = (expectedWins * avgWinAmount) - (expectedLosses * avgLossAmount);

  return {
    markets: selected,
    totalCapital: CONFIG.TOTAL_CAPITAL,
    maxPerMarket: allocationPerMarket,
    expectedPortfolioYield: weightedYield,
    expectedWinRate,
    expectedLossOnLosingMarket: avgLossAmount,
    netExpectedReturn: expectedReturn,
  };
}

// ============================================================================
// Output
// ============================================================================

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDollar(value: number): string {
  return `$${Math.round(value)}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function printPortfolio(portfolio: PortfolioRecommendation): void {
  console.log('\n' + '='.repeat(80));
  console.log('FAVORITE COMPOUNDER PORTFOLIO');
  console.log('='.repeat(80));
  console.log();
  console.log(`Capital: ${formatDollar(portfolio.totalCapital)} | ` +
              `Max per market: ${formatDollar(portfolio.maxPerMarket)} | ` +
              `Markets: ${portfolio.markets.length}`);
  console.log();

  // Header
  console.log(
    '#'.padEnd(3) +
    'Market'.padEnd(50) +
    'Price'.padStart(6) +
    'Yield%'.padStart(8) +
    'Days'.padStart(6) +
    'Ann%'.padStart(8) +
    'Score'.padStart(7) +
    'Allocation'.padStart(12)
  );
  console.log('-'.repeat(100));

  // Markets
  portfolio.markets.forEach((market, idx) => {
    console.log(
      `${idx + 1}`.padEnd(3) +
      truncate(market.question, 48).padEnd(50) +
      market.price.toFixed(2).padStart(6) +
      formatPercent(market.expectedYield).padStart(8) +
      market.daysToResolution.toString().padStart(6) +
      formatPercent(market.annualizedYield).padStart(8) +
      market.riskAdjustedScore.toFixed(2).padStart(7) +
      formatDollar(market.allocation).padStart(12)
    );
  });

  console.log();
  console.log('EXPECTED OUTCOMES:');
  console.log(`  Portfolio yield: ${formatPercent(portfolio.expectedPortfolioYield)}`);
  console.log(`  Win rate: ${formatPercent(portfolio.expectedWinRate)} (based on 3,587-market Kalshi study)`);
  console.log(`  Loss on 1 losing market: ${formatDollar(portfolio.expectedLossOnLosingMarket)}`);
  console.log(`  Net expected return: ${formatDollar(portfolio.netExpectedReturn)}`);
  console.log();
  console.log('='.repeat(80));
}

function saveResults(portfolio: PortfolioRecommendation): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const dir = join(process.cwd(), 'results', 'favorite-compounder');
  const filename = join(dir, `scan-${timestamp}.json`);

  mkdirSync(dir, { recursive: true });

  const output = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    portfolio: {
      totalCapital: portfolio.totalCapital,
      maxPerMarket: portfolio.maxPerMarket,
      numMarkets: portfolio.markets.length,
      expectedPortfolioYield: portfolio.expectedPortfolioYield,
      expectedWinRate: portfolio.expectedWinRate,
      expectedLossOnLosingMarket: portfolio.expectedLossOnLosingMarket,
      netExpectedReturn: portfolio.netExpectedReturn,
      markets: portfolio.markets.map(m => ({
        question: m.question,
        slug: m.slug,
        tokenId: m.tokenId,
        price: m.price,
        volume: m.volume,
        endDate: m.endDate.toISOString(),
        daysToResolution: m.daysToResolution,
        expectedYield: m.expectedYield,
        annualizedYield: m.annualizedYield,
        riskAdjustedScore: m.riskAdjustedScore,
        allocation: m.allocation,
      })),
    },
  };

  writeFileSync(filename, JSON.stringify(output, null, 2));
  return filename;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    console.log('Polymarket Favorite Compounder Scanner');
    console.log('Exploiting the Favorite-Longshot Bias\n');

    // Fetch and analyze markets
    const markets = await fetchActiveMarkets();
    const favorites = await findFavoriteMarkets(markets);

    if (favorites.length === 0) {
      console.log('\nNo qualifying favorite markets found.');
      console.log('Try adjusting MIN_PRICE or MIN_VOLUME in the configuration.');
      return;
    }

    // Build portfolio
    const portfolio = buildPortfolio(favorites);

    // Output results
    printPortfolio(portfolio);

    // Save to file
    const savedFile = saveResults(portfolio);
    console.log(`\nResults saved to: ${savedFile}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
