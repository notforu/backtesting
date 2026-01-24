/**
 * Binance data provider using CCXT
 * Fetches historical candle data from Binance exchange
 */

import ccxt, { type Exchange } from 'ccxt';
import type { Candle, Timeframe } from '../../core/types.js';
import { timeframeToMs, timeframeToCCXT } from '../../core/types.js';
import { type DataProvider, RateLimiter, type RateLimitConfig } from './base.js';

/**
 * Rate limit configuration for Binance
 * Binance allows 1200 requests per minute for most endpoints
 */
const BINANCE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 1000,
};

/**
 * Maximum candles per request (Binance limit is 1000)
 */
const MAX_CANDLES_PER_REQUEST = 1000;

/**
 * Binance data provider implementation
 */
export class BinanceProvider implements DataProvider {
  readonly exchange = 'binance';
  private readonly client: Exchange;
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.client = new ccxt.binance({
      enableRateLimit: false, // We handle rate limiting ourselves
    });
    this.rateLimiter = new RateLimiter(BINANCE_RATE_LIMIT);
  }

  /**
   * Fetch historical candles for a symbol
   * Handles pagination for large date ranges automatically
   */
  async fetchCandles(
    symbol: string,
    timeframe: Timeframe,
    start: Date,
    end: Date
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    const timeframeMs = timeframeToMs(timeframe);
    const ccxtTimeframe = timeframeToCCXT(timeframe);

    let since = start.getTime();
    const until = end.getTime();

    while (since < until) {
      await this.rateLimiter.throttle();

      try {
        // Fetch candles from CCXT
        const ohlcv = await this.client.fetchOHLCV(
          symbol,
          ccxtTimeframe,
          since,
          MAX_CANDLES_PER_REQUEST
        );

        if (!ohlcv || ohlcv.length === 0) {
          break;
        }

        // Convert CCXT format to our Candle type
        for (const bar of ohlcv) {
          const timestamp = bar[0] as number;

          // Stop if we've gone past the end date
          if (timestamp > until) {
            break;
          }

          allCandles.push({
            timestamp,
            open: bar[1] as number,
            high: bar[2] as number,
            low: bar[3] as number,
            close: bar[4] as number,
            volume: bar[5] as number,
          });
        }

        // Get the last timestamp and move forward
        const lastTimestamp = ohlcv[ohlcv.length - 1][0] as number;

        // If we received fewer candles than requested, we've reached the end
        if (ohlcv.length < MAX_CANDLES_PER_REQUEST) {
          break;
        }

        // Move to next batch
        since = lastTimestamp + timeframeMs;
      } catch (error) {
        // Handle specific CCXT errors
        if (error instanceof ccxt.RateLimitExceeded) {
          // Wait and retry
          await new Promise((resolve) => setTimeout(resolve, 60000));
          continue;
        }

        if (error instanceof ccxt.NetworkError) {
          // Wait briefly and retry
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Re-throw other errors
        throw error;
      }
    }

    // Ensure candles are sorted by timestamp
    allCandles.sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates (can happen with pagination edge cases)
    const uniqueCandles: Candle[] = [];
    let lastTimestamp = -1;
    for (const candle of allCandles) {
      if (candle.timestamp !== lastTimestamp) {
        uniqueCandles.push(candle);
        lastTimestamp = candle.timestamp;
      }
    }

    return uniqueCandles;
  }

  /**
   * Get list of available trading symbols
   */
  async getAvailableSymbols(): Promise<string[]> {
    await this.rateLimiter.throttle();

    try {
      const markets = await this.client.loadMarkets();
      return Object.keys(markets).filter((symbol) => {
        const market = markets[symbol];
        // Only include spot markets with USDT quote
        return market && market.spot && market.quote === 'USDT' && market.active;
      });
    } catch (error) {
      if (error instanceof ccxt.NetworkError) {
        throw new Error(`Failed to fetch symbols from Binance: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get exchange info (useful for debugging)
   */
  async getExchangeInfo(): Promise<{
    name: string;
    countries: string[];
    rateLimit: number;
  }> {
    return {
      name: this.client.name ?? 'binance',
      countries: (this.client.countries as string[]) ?? [],
      rateLimit: this.client.rateLimit ?? 0,
    };
  }

  /**
   * Fetch trading fees for a symbol
   * Uses CCXT to get actual exchange fee rates
   * @param symbol - Trading pair (e.g., 'BTC/USDT')
   * @returns Maker and taker fee rates as decimals (0.001 = 0.1%)
   */
  async fetchTradingFees(symbol: string): Promise<{ maker: number; taker: number }> {
    await this.rateLimiter.throttle();

    try {
      // Load markets to get fee information
      await this.client.loadMarkets();

      // Try to get fees from the market info
      const market = this.client.market(symbol);
      if (market && market.maker !== undefined && market.taker !== undefined) {
        return {
          maker: market.maker,
          taker: market.taker,
        };
      }

      // Try fetchTradingFees if available (requires API key for some exchanges)
      if (this.client.has['fetchTradingFees']) {
        try {
          const fees = await this.client.fetchTradingFees();
          if (fees && fees[symbol]) {
            return {
              maker: fees[symbol].maker ?? 0.001,
              taker: fees[symbol].taker ?? 0.001,
            };
          }
        } catch {
          // fetchTradingFees may require authentication, fall through to defaults
        }
      }

      // Default Binance fees (0.1% for both maker and taker)
      return {
        maker: 0.001,
        taker: 0.001,
      };
    } catch (error) {
      if (error instanceof ccxt.NetworkError) {
        console.warn(`Failed to fetch fees for ${symbol}, using defaults: ${error.message}`);
      }
      // Return default Binance fees on error
      return {
        maker: 0.001,
        taker: 0.001,
      };
    }
  }
}

/**
 * Create a Binance provider instance
 */
export function createBinanceProvider(): BinanceProvider {
  return new BinanceProvider();
}
