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

    // Step 1: Discovery request - get the full market time range using fidelity=900 with interval=all
    // This is cheap (1 request) and tells us the oldest and newest available data points
    await this.rateLimiter.throttle();
    const discoveryUrl = `${this.clobApiBase}/prices-history?market=${yesTokenId}&interval=all&fidelity=900`;
    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) {
      throw new Error(`Failed to fetch discovery price history from CLOB API: ${discoveryResponse.statusText}`);
    }
    const discoveryData = (await discoveryResponse.json()) as CLOBPriceHistory;
    const discoveryHistory = discoveryData.history ?? [];

    if (discoveryHistory.length === 0) {
      console.log(`[Polymarket] ${slug}: No data available from discovery request`);
      return [];
    }

    // Determine the market's full data range from discovery
    const marketFirstTs = discoveryHistory[0].t; // seconds
    const marketLastTs = discoveryHistory[discoveryHistory.length - 1].t; // seconds

    const discoveryFirstDate = new Date(marketFirstTs * 1000).toISOString().split('T')[0];
    const discoveryLastDate = new Date(marketLastTs * 1000).toISOString().split('T')[0];
    console.log(
      `[Polymarket] ${slug}: Discovery: ${discoveryHistory.length} pts, ` +
      `range ${discoveryFirstDate} to ${discoveryLastDate}`
    );

    // Step 2: Calculate the effective fetch range, constrained by both market data and caller params
    // startTs/endTs are Unix seconds
    const requestedStartSec = Math.floor(start.getTime() / 1000);
    const requestedEndSec = Math.floor(end.getTime() / 1000);

    const effectiveStartSec = Math.max(marketFirstTs, requestedStartSec);
    const effectiveEndSec = Math.min(marketLastTs, requestedEndSec);

    if (effectiveStartSec >= effectiveEndSec) {
      console.log(`[Polymarket] ${slug}: Requested date range has no overlap with market data`);
      return [];
    }

    // Step 3: Build 15-day windows covering the effective range (working backwards from end)
    // 15 days in seconds = 15 * 24 * 60 * 60 = 1,296,000 seconds
    // At fidelity=60 (~1 point/hour), 15 days = ~360 points, safely under the ~740 cap
    const WINDOW_SIZE_SEC = 15 * 24 * 60 * 60; // 1,296,000 seconds

    const windows: Array<{ start: number; end: number }> = [];
    let windowEnd = effectiveEndSec;
    while (windowEnd > effectiveStartSec) {
      const windowStart = Math.max(effectiveStartSec, windowEnd - WINDOW_SIZE_SEC);
      windows.push({ start: windowStart, end: windowEnd });
      windowEnd = windowStart;
    }

    console.log(`[Polymarket] ${slug}: Fetching ${windows.length} windows of hourly data...`);

    // Step 4: Fetch each window using startTs/endTs (mutually exclusive with interval=)
    // Accumulate all price points across windows
    const allPoints = new Map<number, { t: number; p: number }>();

    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      const windowStartDate = new Date(window.start * 1000).toISOString().split('T')[0];
      const windowEndDate = new Date(window.end * 1000).toISOString().split('T')[0];

      try {
        await this.rateLimiter.throttle();
        const windowUrl =
          `${this.clobApiBase}/prices-history?market=${yesTokenId}` +
          `&startTs=${window.start}&endTs=${window.end}&fidelity=60`;
        const windowResponse = await fetch(windowUrl);

        if (!windowResponse.ok) {
          console.warn(
            `[Polymarket] ${slug}: Window ${i + 1}/${windows.length} failed: ${windowResponse.statusText} ` +
            `(${windowStartDate} to ${windowEndDate}) - skipping`
          );
          continue;
        }

        const windowData = (await windowResponse.json()) as CLOBPriceHistory;
        const windowHistory = windowData.history ?? [];

        // Deduplicate by timestamp - last write wins (later windows override earlier for same ts)
        for (const point of windowHistory) {
          allPoints.set(point.t, point);
        }

        console.log(
          `[Polymarket] ${slug}: Window ${i + 1}/${windows.length}: ` +
          `${windowStartDate} to ${windowEndDate} -> ${windowHistory.length} pts`
        );
      } catch (err) {
        console.warn(
          `[Polymarket] ${slug}: Window ${i + 1}/${windows.length} error ` +
          `(${windowStartDate} to ${windowEndDate}): ` +
          `${err instanceof Error ? err.message : String(err)} - skipping`
        );
      }
    }

    // Step 5: Merge, sort, and log final result
    const mergedHistory = Array.from(allPoints.values());
    mergedHistory.sort((a, b) => a.t - b.t);

    if (mergedHistory.length === 0) {
      console.log(`[Polymarket] ${slug}: No price points collected after windowed fetch`);
      return [];
    }

    const firstTs = mergedHistory[0].t;
    const lastTs = mergedHistory[mergedHistory.length - 1].t;
    const finalFirstDate = new Date(firstTs * 1000).toISOString().split('T')[0];
    const finalLastDate = new Date(lastTs * 1000).toISOString().split('T')[0];
    console.log(
      `[Polymarket] ${slug}: Total: ${mergedHistory.length.toLocaleString()} real price points ` +
      `covering ${finalFirstDate} to ${finalLastDate}`
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
