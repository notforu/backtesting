/**
 * Polymarket data provider
 * Fetches prediction market price history and converts to OHLCV candles
 */

import type { Candle, Timeframe } from '../../core/types.js';
import { timeframeToMs } from '../../core/types.js';
import { type DataProvider, RateLimiter, type RateLimitConfig, type TradingFees } from './base.js';
import type { GammaMarket, CLOBPriceHistory } from './polymarket-types.js';
import { getMarketBySlug, saveMarket } from '../polymarket-cache.js';

/**
 * Rate limit configuration for Polymarket APIs
 * Conservative limits: 15 requests per minute
 */
const POLYMARKET_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 15,
  windowMs: 60000,
};

/**
 * Polymarket data provider implementation
 * Converts prediction market probabilities into OHLCV candles
 */
export class PolymarketProvider implements DataProvider {
  readonly exchange = 'polymarket';
  private readonly rateLimiter: RateLimiter;
  private readonly gammaApiBase = 'https://gamma-api.polymarket.com';
  private readonly clobApiBase = 'https://clob.polymarket.com';

  constructor() {
    this.rateLimiter = new RateLimiter(POLYMARKET_RATE_LIMIT);
  }

  /**
   * Fetch historical candles for a Polymarket symbol
   * @param symbol - Symbol in format "PM:slug" (e.g., "PM:will-trump-deport-less-than-250000")
   * @param timeframe - Candle timeframe
   * @param start - Start date for the range
   * @param end - End date for the range
   * @returns Array of candles sorted by timestamp ascending
   */
  async fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    start: Date,
    end: Date
  ): Promise<Candle[]> {
    // Parse slug from symbol
    if (!symbol.startsWith('PM:')) {
      throw new Error(`Invalid Polymarket symbol: ${symbol}. Expected format: PM:slug`);
    }
    const slug = symbol.substring(3); // Remove "PM:" prefix

    // Get market metadata
    const market = await this.getMarketMetadata(slug);

    // Parse clobTokenIds JSON string and take the YES token (index 0)
    let tokenIds: string[];
    try {
      tokenIds = JSON.parse(market.clobTokenIds);
    } catch (error) {
      throw new Error(`Failed to parse clobTokenIds for ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!tokenIds || tokenIds.length === 0) {
      throw new Error(`No token IDs found for market ${slug}`);
    }

    const yesTokenId = tokenIds[0];

    // Fetch price history
    await this.rateLimiter.throttle();
    const url = `${this.clobApiBase}/prices-history?market=${yesTokenId}&interval=all&fidelity=60`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch price history from CLOB API: ${response.statusText}`);
    }

    const data = (await response.json()) as CLOBPriceHistory;

    if (!data.history || data.history.length === 0) {
      return [];
    }

    // Convert price points to candles
    const candles = this.convertPricePointsToCandles(data.history, timeframe, start.getTime(), end.getTime());

    return candles;
  }

  /**
   * Get market metadata from Gamma API or cache
   */
  private async getMarketMetadata(slug: string): Promise<GammaMarket> {
    // Check cache first
    const cached = getMarketBySlug(slug);
    if (cached) {
      return cached;
    }

    // Fetch from API
    await this.rateLimiter.throttle();
    const url = `${this.gammaApiBase}/markets?slug=${slug}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch market metadata from Gamma API: ${response.statusText}`);
    }

    const markets = (await response.json()) as GammaMarket[];

    if (!markets || markets.length === 0) {
      throw new Error(`Market not found: ${slug}`);
    }

    const market = markets[0];

    // Save to cache
    saveMarket(market);

    return market;
  }

  /**
   * Convert price points to OHLCV candles by bucketing into timeframe windows
   */
  private convertPricePointsToCandles(
    pricePoints: Array<{ t: number; p: number }>,
    timeframe: Timeframe,
    startMs: number,
    endMs: number
  ): Candle[] {
    const timeframeMs = timeframeToMs(timeframe);
    const candles: Candle[] = [];

    // Group price points by timeframe bucket
    const buckets = new Map<number, Array<{ t: number; p: number }>>();

    for (const point of pricePoints) {
      const timestampMs = point.t * 1000; // Convert seconds to milliseconds

      // Skip points outside the date range
      if (timestampMs < startMs || timestampMs > endMs) {
        continue;
      }

      // Calculate bucket timestamp (floor to timeframe)
      const bucketTimestamp = Math.floor(timestampMs / timeframeMs) * timeframeMs;

      if (!buckets.has(bucketTimestamp)) {
        buckets.set(bucketTimestamp, []);
      }
      buckets.get(bucketTimestamp)!.push(point);
    }

    // Convert each bucket to a candle
    for (const [bucketTimestamp, points] of buckets.entries()) {
      if (points.length === 0) {
        continue;
      }

      // Sort points by time
      points.sort((a, b) => a.t - b.t);

      const open = points[0].p;
      const close = points[points.length - 1].p;
      const high = Math.max(...points.map((p) => p.p));
      const low = Math.min(...points.map((p) => p.p));
      const volume = points.length; // Use count of data points as volume

      candles.push({
        timestamp: bucketTimestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    // Sort candles by timestamp ascending
    candles.sort((a, b) => a.timestamp - b.timestamp);

    return candles;
  }

  /**
   * Get list of available trading symbols
   * Returns active markets as PM:slug
   */
  async getAvailableSymbols(): Promise<string[]> {
    await this.rateLimiter.throttle();
    const url = `${this.gammaApiBase}/markets?limit=100&active=true`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch markets from Gamma API: ${response.statusText}`);
    }

    const markets = (await response.json()) as GammaMarket[];

    // Cache all markets
    for (const market of markets) {
      saveMarket(market);
    }

    // Return slugs with PM: prefix
    return markets.map((market) => `PM:${market.slug}`);
  }

  /**
   * Fetch trading fees for Polymarket
   * Polymarket charges ~2% fee on trades
   */
  async fetchTradingFees(_symbol: string): Promise<TradingFees> {
    return {
      maker: 0,
      taker: 0.002, // ~0.2% effective fee (Polymarket charges on profit, not notional)
    };
  }
}

/**
 * Create a Polymarket provider instance
 */
export function createPolymarketProvider(): PolymarketProvider {
  return new PolymarketProvider();
}
