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

    // Fetch BOTH fidelities and merge for maximum coverage
    // fidelity=900 gives ~650 pts over 13+ months (sparse, ~1 sample/15h)
    // fidelity=60 gives ~740 pts over ~31 days (dense, ~1 sample/h)

    // Request 1: long-range sparse data (13+ months of history)
    await this.rateLimiter.throttle();
    const longRangeUrl = `${this.clobApiBase}/prices-history?market=${yesTokenId}&interval=all&fidelity=900`;
    const longRangeResponse = await fetch(longRangeUrl);
    if (!longRangeResponse.ok) {
      throw new Error(`Failed to fetch long-range price history from CLOB API: ${longRangeResponse.statusText}`);
    }
    const longRangeData = (await longRangeResponse.json()) as CLOBPriceHistory;
    const longRangeHistory = longRangeData.history ?? [];

    // Request 2: short-range dense data (last ~31 days, higher resolution)
    await this.rateLimiter.throttle();
    const shortRangeUrl = `${this.clobApiBase}/prices-history?market=${yesTokenId}&interval=all&fidelity=60`;
    const shortRangeResponse = await fetch(shortRangeUrl);
    if (!shortRangeResponse.ok) {
      throw new Error(`Failed to fetch short-range price history from CLOB API: ${shortRangeResponse.statusText}`);
    }
    const shortRangeData = (await shortRangeResponse.json()) as CLOBPriceHistory;
    const shortRangeHistory = shortRangeData.history ?? [];

    // Edge case: if long-range returned no data, fall back to short-range only
    let mergedHistory: Array<{ t: number; p: number }>;
    if (longRangeHistory.length === 0) {
      mergedHistory = shortRangeHistory;
    } else {
      // Merge: prefer fidelity=60 data for timestamps it covers (more granular)
      // The fidelity=60 data starts ~31 days ago - use it from that point forward
      // Find the earliest timestamp in the short-range data
      const shortRangeStart = shortRangeHistory.length > 0
        ? Math.min(...shortRangeHistory.map((p) => p.t))
        : Infinity;

      // Use long-range data for everything before short-range starts
      const longRangeOnly = longRangeHistory.filter((p) => p.t < shortRangeStart);

      // Combine: old sparse data + recent dense data
      const combined = [...longRangeOnly, ...shortRangeHistory];

      // Deduplicate by timestamp (keep the fidelity=60 one if same second)
      // Since short-range is appended after long-range-only, and we dedup by keeping
      // the last occurrence per timestamp, the short-range data naturally wins
      const seenTimestamps = new Map<number, { t: number; p: number }>();
      for (const point of combined) {
        seenTimestamps.set(point.t, point);
      }

      mergedHistory = Array.from(seenTimestamps.values());
      // Sort by timestamp ascending
      mergedHistory.sort((a, b) => a.t - b.t);
    }

    if (mergedHistory.length === 0) {
      return [];
    }

    // Log data range for debugging
    const firstTs = mergedHistory[0].t;
    const lastTs = mergedHistory[mergedHistory.length - 1].t;
    const firstDate = new Date(firstTs * 1000).toISOString().split('T')[0];
    const lastDate = new Date(lastTs * 1000).toISOString().split('T')[0];
    console.log(
      `[Polymarket] ${slug}: ${mergedHistory.length} price points fetched ` +
      `(fidelity=900: ${longRangeHistory.length} pts, fidelity=60: ${shortRangeHistory.length} pts) ` +
      `covering ${firstDate} to ${lastDate}`
    );

    // Convert price points to candles
    const candles = this.convertPricePointsToCandles(mergedHistory, timeframe, start.getTime(), end.getTime());

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
    const bucketEntries = Array.from(buckets.entries());
    for (const [bucketTimestamp, points] of bucketEntries) {
      if (points.length === 0) {
        continue;
      }

      // Sort points by time
      points.sort((a, b) => a.t - b.t);

      const open = points[0].p;
      const close = points[points.length - 1].p;
      const high = Math.max(...points.map((p) => p.p));
      const low = Math.min(...points.map((p) => p.p));
      // Note: CLOB API /prices-history only provides {t, p} pairs without volume data.
      // Using count of data points as a proxy, though this is not real dollar volume.
      const volume = points.length;

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

    // Forward-fill missing candles
    if (candles.length === 0) {
      return candles;
    }

    const filledCandles: Candle[] = [];
    const firstTimestamp = candles[0].timestamp;
    const lastTimestamp = candles[candles.length - 1].timestamp;

    let candleIndex = 0;
    let lastCandle = candles[0];

    for (let t = firstTimestamp; t <= lastTimestamp; t += timeframeMs) {
      // Check if we have a candle for this timestamp
      if (candleIndex < candles.length && candles[candleIndex].timestamp === t) {
        filledCandles.push(candles[candleIndex]);
        lastCandle = candles[candleIndex];
        candleIndex++;
      } else {
        // Forward-fill missing candle
        filledCandles.push({
          timestamp: t,
          open: lastCandle.close,
          high: lastCandle.close,
          low: lastCandle.close,
          close: lastCandle.close,
          volume: 0,
        });
      }
    }

    return filledCandles;
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
   * Polymarket CLOB has zero trading fees; real cost is bid-ask spread (modeled via slippage)
   */
  async fetchTradingFees(_symbol: string): Promise<TradingFees> {
    return {
      maker: 0,
      taker: 0, // Polymarket CLOB has zero trading fees; real cost is bid-ask spread (modeled via slippage)
    };
  }
}

/**
 * Create a Polymarket provider instance
 */
export function createPolymarketProvider(): PolymarketProvider {
  return new PolymarketProvider();
}
