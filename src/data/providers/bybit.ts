/**
 * Bybit data provider using CCXT
 * Fetches historical candle data and funding rates from Bybit perpetual futures
 */

import ccxt, { type Exchange } from 'ccxt';
import type { Candle, Timeframe, FundingRate } from '../../core/types.js';
import { timeframeToMs, timeframeToCCXT } from '../../core/types.js';
import { type DataProvider, RateLimiter, type RateLimitConfig } from './base.js';

/**
 * Rate limit configuration for Bybit
 * Bybit allows 10 requests per second for most endpoints
 */
const BYBIT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 1000,
};

/**
 * Maximum candles per request (Bybit limit is 200)
 */
const MAX_CANDLES_PER_REQUEST = 200;

/**
 * Bybit perpetual futures data provider implementation
 */
export class BybitProvider implements DataProvider {
  readonly exchange = 'bybit';
  private readonly client: Exchange;
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.client = new ccxt.bybit({
      enableRateLimit: false, // We handle rate limiting ourselves
      options: {
        defaultType: 'swap', // Use perpetual futures (swap) markets
      },
    });
    this.rateLimiter = new RateLimiter(BYBIT_RATE_LIMIT);
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
   * Filters for swap (perpetual futures) markets with USDT settlement
   */
  async getAvailableSymbols(): Promise<string[]> {
    await this.rateLimiter.throttle();

    try {
      const markets = await this.client.loadMarkets();
      return Object.keys(markets).filter((symbol) => {
        const market = markets[symbol];
        // Only include swap markets with USDT settlement that are active
        return (
          market &&
          market.swap === true &&
          market.settle === 'USDT' &&
          market.active
        );
      });
    } catch (error) {
      if (error instanceof ccxt.NetworkError) {
        throw new Error(`Failed to fetch symbols from Bybit: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetch trading fees for a symbol
   * Bybit perpetual futures: maker 0.02%, taker 0.055%
   * @param symbol - Trading pair (e.g., 'BTC/USDT:USDT')
   * @returns Maker and taker fee rates as decimals (0.0002 = 0.02%)
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
              maker: fees[symbol].maker ?? 0.0002,
              taker: fees[symbol].taker ?? 0.00055,
            };
          }
        } catch {
          // fetchTradingFees may require authentication, fall through to defaults
        }
      }

      // Default Bybit perpetual futures fees: maker 0.02%, taker 0.055%
      return {
        maker: 0.0002,
        taker: 0.00055,
      };
    } catch (error) {
      if (error instanceof ccxt.NetworkError) {
        console.warn(`Failed to fetch fees for ${symbol}, using defaults: ${error.message}`);
      }
      // Return default Bybit fees on error
      return {
        maker: 0.0002,
        taker: 0.00055,
      };
    }
  }

  /**
   * Fetch funding rate history for a perpetual futures symbol
   * Bybit pays funding every 8 hours (~3 records/day, ~1095/year)
   * CCXT returns up to 200 records per call
   *
   * @param symbol - Trading pair (e.g., 'BTC/USDT:USDT')
   * @param start - Start date for the range
   * @param end - End date for the range
   * @returns Array of funding rates sorted by timestamp ascending
   */
  async fetchFundingRateHistory(
    symbol: string,
    start: Date,
    end: Date
  ): Promise<FundingRate[]> {
    const allRates: FundingRate[] = [];
    let since = start.getTime();
    const until = end.getTime();

    while (since < until) {
      await this.rateLimiter.throttle();
      try {
        const rates = await this.client.fetchFundingRateHistory(symbol, since, 200);

        if (!rates || rates.length === 0) break;

        for (const rate of rates) {
          if (rate.timestamp && rate.timestamp <= until) {
            // markPrice is not in CCXT types but may be present in the raw data
            const rateAny = rate as unknown as Record<string, unknown>;
            allRates.push({
              timestamp: rate.timestamp,
              fundingRate: rate.fundingRate,
              markPrice: typeof rateAny['markPrice'] === 'number' ? rateAny['markPrice'] : undefined,
            });
          }
        }

        const lastTs = rates[rates.length - 1].timestamp;
        if (rates.length < 200 || !lastTs) break;
        since = lastTs + 1;
      } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded) {
          await new Promise((r) => setTimeout(r, 60000));
          continue;
        }
        if (error instanceof ccxt.NetworkError) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        throw error;
      }
    }

    allRates.sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates
    const unique: FundingRate[] = [];
    let lastTs = -1;
    for (const rate of allRates) {
      if (rate.timestamp !== lastTs) {
        unique.push(rate);
        lastTs = rate.timestamp;
      }
    }
    return unique;
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
      name: this.client.name ?? 'bybit',
      countries: (this.client.countries as string[]) ?? [],
      rateLimit: this.client.rateLimit ?? 0,
    };
  }
}

/**
 * Create a Bybit provider instance
 */
export function createBybitProvider(): BybitProvider {
  return new BybitProvider();
}
