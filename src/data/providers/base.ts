/**
 * Base interface for data providers
 * All exchange data providers must implement this interface
 */

import type { Candle, Timeframe } from '../../core/types.js';

/**
 * Trading fee rates
 */
export interface TradingFees {
  maker: number; // Maker fee as decimal (0.001 = 0.1%)
  taker: number; // Taker fee as decimal (0.001 = 0.1%)
}

/**
 * Data provider interface for fetching historical candle data
 */
export interface DataProvider {
  /**
   * Exchange identifier (e.g., 'binance', 'bybit')
   */
  readonly exchange: string;

  /**
   * Fetch historical candles for a symbol
   * @param symbol - Trading pair (e.g., 'BTC/USDT')
   * @param timeframe - Candle timeframe (e.g., '1h', '4h')
   * @param start - Start date for the range
   * @param end - End date for the range
   * @returns Array of candles sorted by timestamp ascending
   */
  fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    start: Date,
    end: Date
  ): Promise<Candle[]>;

  /**
   * Get list of available trading symbols
   * @returns Array of symbol strings (e.g., ['BTC/USDT', 'ETH/USDT'])
   */
  getAvailableSymbols(): Promise<string[]>;

  /**
   * Fetch trading fees for a symbol
   * @param symbol - Trading pair (e.g., 'BTC/USDT')
   * @returns Maker and taker fee rates as decimals
   */
  fetchTradingFees(symbol: string): Promise<TradingFees>;
}

/**
 * Rate limiter configuration for API calls
 */
export interface RateLimitConfig {
  /**
   * Maximum requests per time window
   */
  maxRequests: number;

  /**
   * Time window in milliseconds
   */
  windowMs: number;
}

/**
 * Default rate limit for most exchanges
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 1000,
};

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple rate limiter class
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT) {
    this.config = config;
  }

  /**
   * Wait if necessary to respect rate limits
   */
  async throttle(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter((ts) => ts > windowStart);

    // If at limit, wait until oldest timestamp expires
    if (this.timestamps.length >= this.config.maxRequests) {
      const oldestTimestamp = this.timestamps[0];
      const waitTime = oldestTimestamp - windowStart + 10; // +10ms buffer
      if (waitTime > 0) {
        await sleep(waitTime);
      }
      // Clean up again after waiting
      this.timestamps = this.timestamps.filter((ts) => ts > Date.now() - this.config.windowMs);
    }

    // Record this request
    this.timestamps.push(Date.now());
  }
}
