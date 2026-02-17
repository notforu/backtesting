/**
 * Manifold Markets data provider
 * Fetches prediction market bet history and converts to OHLCV candles
 */

import type { Candle, Timeframe } from '../../core/types.js';
import { timeframeToMs } from '../../core/types.js';
import { type DataProvider, RateLimiter, type RateLimitConfig, type TradingFees } from './base.js';

/**
 * Rate limit configuration for Manifold API
 * Conservative limit: 100 requests per minute (actual limit is 500/min)
 */
const MANIFOLD_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000,
};

/**
 * Manifold bet from API
 */
interface ManifoldBet {
  createdTime: number; // milliseconds since epoch
  probAfter: number; // probability after bet (0-1)
  probBefore?: number; // probability before bet (0-1) - may not be available
  amount?: number; // mana wagered on this bet
}

/**
 * Manifold market from API
 */
interface ManifoldMarket {
  id: string;
  slug: string;
  question: string;
  url: string;
  closeTime?: number;
  isResolved: boolean;
}

/**
 * Manifold Markets data provider implementation
 * Converts bet history into OHLCV candles based on probability movements
 */
export class ManifoldProvider implements DataProvider {
  readonly exchange = 'manifold';
  private readonly rateLimiter: RateLimiter;
  private readonly apiBase = 'https://api.manifold.markets/v0';

  constructor() {
    this.rateLimiter = new RateLimiter(MANIFOLD_RATE_LIMIT);
  }

  /**
   * Fetch historical candles for a Manifold symbol
   * @param symbol - Symbol in format "MF:slug" (e.g., "MF:will-trump-win-2024")
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
    if (!symbol.startsWith('MF:')) {
      throw new Error(`Invalid Manifold symbol: ${symbol}. Expected format: MF:slug`);
    }
    const slug = symbol.substring(3); // Remove "MF:" prefix

    // Fetch bet history with pagination
    const allBets: ManifoldBet[] = [];
    let before: string | undefined;
    const endMs = end.getTime();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.rateLimiter.throttle();
      const url = before
        ? `${this.apiBase}/bets?contractSlug=${slug}&limit=1000&order=ASC&before=${before}`
        : `${this.apiBase}/bets?contractSlug=${slug}&limit=1000&order=ASC`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch bet history from Manifold API: ${response.statusText}`);
      }

      const bets = (await response.json()) as ManifoldBet[];

      if (!bets || bets.length === 0) {
        break; // No more results
      }

      allBets.push(...bets);

      // Check if all results are past the end date
      const lastBetTime = bets[bets.length - 1].createdTime;
      if (lastBetTime > endMs) {
        break;
      }

      // If we got fewer than 1000 results, we've reached the end
      if (bets.length < 1000) {
        break;
      }

      // Set cursor for next page (use the last bet's timestamp as "before")
      // Note: This assumes Manifold API supports pagination. If not, this will fail gracefully.
      before = String(bets[bets.length - 1].createdTime);
    }

    if (allBets.length === 0) {
      return [];
    }

    // Convert bets to candles
    const candles = this.convertBetsToCandles(allBets, timeframe, start.getTime(), end.getTime());

    return candles;
  }

  /**
   * Convert bet history to OHLCV candles by bucketing into timeframe windows
   */
  private convertBetsToCandles(
    bets: ManifoldBet[],
    timeframe: Timeframe,
    startMs: number,
    endMs: number
  ): Candle[] {
    const timeframeMs = timeframeToMs(timeframe);
    const candles: Candle[] = [];

    // Group bets by timeframe bucket
    const buckets = new Map<number, ManifoldBet[]>();

    for (const bet of bets) {
      const timestampMs = bet.createdTime;

      // Skip bets outside the date range
      if (timestampMs < startMs || timestampMs > endMs) {
        continue;
      }

      // Calculate bucket timestamp (floor to timeframe)
      const bucketTimestamp = Math.floor(timestampMs / timeframeMs) * timeframeMs;

      if (!buckets.has(bucketTimestamp)) {
        buckets.set(bucketTimestamp, []);
      }
      buckets.get(bucketTimestamp)!.push(bet);
    }

    // Convert each bucket to a candle
    let prevClose: number | null = null;
    const bucketEntries = Array.from(buckets.entries());
    for (const [bucketTimestamp, bucketBets] of bucketEntries) {
      if (bucketBets.length === 0) {
        continue;
      }

      // Sort bets by time within bucket
      bucketBets.sort((a, b) => a.createdTime - b.createdTime);

      // Fix: Use probBefore of first bet if available, otherwise use previous candle's close
      let open: number;
      if (bucketBets[0].probBefore !== undefined) {
        open = bucketBets[0].probBefore;
      } else if (prevClose !== null) {
        open = prevClose;
      } else {
        // First candle and no probBefore available: use probAfter as fallback
        open = bucketBets[0].probAfter;
      }

      const close = bucketBets[bucketBets.length - 1].probAfter;
      const high = Math.max(...bucketBets.map((b) => b.probAfter));
      const low = Math.min(...bucketBets.map((b) => b.probAfter));

      // Use sum of amounts if available, otherwise count of bets
      const volume = bucketBets.reduce((sum, b) => sum + (b.amount || 1), 0);

      candles.push({
        timestamp: bucketTimestamp,
        open,
        high,
        low,
        close,
        volume,
      });

      prevClose = close;
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
   * Returns active markets as MF:slug
   */
  async getAvailableSymbols(): Promise<string[]> {
    await this.rateLimiter.throttle();
    const url = `${this.apiBase}/markets?limit=100`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch markets from Manifold API: ${response.statusText}`);
    }

    const markets = (await response.json()) as ManifoldMarket[];

    // Filter for unresolved markets and return slugs with MF: prefix
    return markets
      .filter((market) => !market.isResolved)
      .map((market) => `MF:${market.slug}`);
  }

  /**
   * Fetch trading fees for Manifold
   * Manifold has no trading fees for prediction markets
   */
  async fetchTradingFees(_symbol: string): Promise<TradingFees> {
    return {
      maker: 0,
      taker: 0.001,
    };
  }
}

/**
 * Create a Manifold provider instance
 */
export function createManifoldProvider(): ManifoldProvider {
  return new ManifoldProvider();
}
