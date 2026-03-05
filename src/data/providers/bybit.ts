/**
 * Bybit data provider using CCXT
 * Fetches historical candle data and funding rates from Bybit perpetual futures
 */

import ccxt, { type Exchange } from 'ccxt';
import type { Candle, Timeframe, FundingRate, OpenInterestRecord, LongShortRatioRecord } from '../../core/types.js';
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
   * Fetch open interest history for a perpetual futures symbol.
   * Supports timeframes: '5m', '15m', '1h', '4h', '1d'.
   * Paginates automatically over the requested date range.
   *
   * @param symbol - Trading pair (e.g., 'BTC/USDT:USDT')
   * @param timeframe - Data granularity ('5m' | '15m' | '1h' | '4h' | '1d')
   * @param start - Start date for the range
   * @param end - End date for the range
   * @returns Array of open interest records sorted by timestamp ascending
   */
  async fetchOpenInterestHistory(
    symbol: string,
    timeframe: string,
    start: Date,
    end: Date
  ): Promise<OpenInterestRecord[]> {
    const allRecords: OpenInterestRecord[] = [];
    let since = start.getTime();
    const until = end.getTime();

    // Map timeframe string to milliseconds for pagination advancement
    const timeframeMs: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const stepMs = timeframeMs[timeframe] ?? 60 * 60 * 1000;

    while (since < until) {
      await this.rateLimiter.throttle();

      try {
        const data = await this.client.fetchOpenInterestHistory(symbol, timeframe, since, 200);

        if (!data || data.length === 0) break;

        for (const item of data) {
          const dataAny = item as unknown as Record<string, unknown>;
          const ts = typeof item.timestamp === 'number' ? item.timestamp : Number(dataAny['timestamp']);
          if (ts > until) break;

          const oiAmount =
            typeof item.openInterestAmount === 'number'
              ? item.openInterestAmount
              : Number(dataAny['openInterestAmount'] ?? dataAny['openInterest'] ?? 0);

          allRecords.push({
            timestamp: ts,
            openInterestAmount: oiAmount,
          });
        }

        const lastTs = data[data.length - 1];
        const lastTimestamp =
          typeof lastTs.timestamp === 'number'
            ? lastTs.timestamp
            : Number((lastTs as unknown as Record<string, unknown>)['timestamp']);

        if (data.length < 200 || !lastTimestamp) break;
        since = lastTimestamp + stepMs;
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

    allRecords.sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates
    const unique: OpenInterestRecord[] = [];
    let lastTs = -1;
    for (const rec of allRecords) {
      if (rec.timestamp !== lastTs) {
        unique.push(rec);
        lastTs = rec.timestamp;
      }
    }
    return unique;
  }

  /**
   * Fetch long/short ratio history for a perpetual futures symbol.
   * LSR is only available at 1h granularity on Bybit.
   * Paginates automatically over the requested date range.
   *
   * @param symbol - Trading pair (e.g., 'BTC/USDT:USDT')
   * @param start - Start date for the range
   * @param end - End date for the range
   * @returns Array of long/short ratio records sorted by timestamp ascending
   */
  async fetchLongShortRatioHistory(
    symbol: string,
    start: Date,
    end: Date
  ): Promise<LongShortRatioRecord[]> {
    const allRecords: LongShortRatioRecord[] = [];
    let since = start.getTime();
    const until = end.getTime();
    const stepMs = 60 * 60 * 1000; // 1h in ms

    while (since < until) {
      await this.rateLimiter.throttle();

      try {
        const data = await this.client.fetchLongShortRatioHistory(symbol, '1h', since, 200);

        if (!data || data.length === 0) break;

        for (const item of data) {
          const dataAny = item as unknown as Record<string, unknown>;
          const ts = typeof item.timestamp === 'number' ? item.timestamp : Number(dataAny['timestamp']);
          if (ts > until) break;

          const longShortRatioVal =
            typeof item.longShortRatio === 'number'
              ? item.longShortRatio
              : Number(dataAny['longShortRatio'] ?? 1);

          // longRatio and shortRatio may be present directly, or derive from longShortRatio
          const longRatio =
            typeof dataAny['longRatio'] === 'number'
              ? (dataAny['longRatio'] as number)
              : typeof dataAny['longAccount'] === 'number'
              ? (dataAny['longAccount'] as number)
              : longShortRatioVal / (1 + longShortRatioVal);

          const shortRatio =
            typeof dataAny['shortRatio'] === 'number'
              ? (dataAny['shortRatio'] as number)
              : typeof dataAny['shortAccount'] === 'number'
              ? (dataAny['shortAccount'] as number)
              : 1 / (1 + longShortRatioVal);

          allRecords.push({
            timestamp: ts,
            longRatio,
            shortRatio,
            longShortRatio: longShortRatioVal,
          });
        }

        const lastTs = data[data.length - 1];
        const lastTimestamp =
          typeof lastTs.timestamp === 'number'
            ? lastTs.timestamp
            : Number((lastTs as unknown as Record<string, unknown>)['timestamp']);

        if (data.length < 200 || !lastTimestamp) break;
        since = lastTimestamp + stepMs;
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

    allRecords.sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates
    const unique: LongShortRatioRecord[] = [];
    let lastTs = -1;
    for (const rec of allRecords) {
      if (rec.timestamp !== lastTs) {
        unique.push(rec);
        lastTs = rec.timestamp;
      }
    }
    return unique;
  }

  /**
   * Map our timeframe strings to Bybit V5 API intervalTime values
   */
  private toBybitOiInterval(timeframe: string): string {
    const map: Record<string, string> = {
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
    };
    const interval = map[timeframe];
    if (!interval) {
      throw new Error(
        `Unsupported timeframe for Bybit OI: "${timeframe}". Supported: ${Object.keys(map).join(', ')}`
      );
    }
    return interval;
  }

  /**
   * Convert a CCXT-style symbol to the Bybit REST API symbol format.
   * e.g. 'BTC/USDT:USDT' -> 'BTCUSDT'
   */
  private toBybitSymbol(symbol: string): string {
    // Strip the settlement part (':USDT') first, then the slash
    return symbol.replace(/:.*$/, '').replace('/', '');
  }

  /**
   * Fetch open interest history directly from the Bybit V5 REST API.
   *
   * Unlike `fetchOpenInterestHistory` (CCXT wrapper), this method correctly
   * honours `startTime`/`endTime` and handles cursor-based pagination so that
   * arbitrarily long date ranges can be fetched in a single call.
   *
   * The Bybit API returns data in REVERSE chronological order; after collecting
   * all pages the array is reversed so the result is ascending by timestamp.
   *
   * @param symbol    - Trading pair in CCXT format (e.g. 'BTC/USDT:USDT')
   * @param timeframe - Granularity: '5m' | '15m' | '30m' | '1h' | '4h' | '1d'
   * @param start     - Range start (inclusive)
   * @param end       - Range end   (inclusive)
   * @returns Array of open interest records sorted by timestamp ascending
   */
  async fetchOpenInterestHistoryDirect(
    symbol: string,
    timeframe: string,
    start: Date,
    end: Date
  ): Promise<OpenInterestRecord[]> {
    const bybitSymbol = this.toBybitSymbol(symbol);
    const intervalTime = this.toBybitOiInterval(timeframe);
    const startTime = start.getTime();
    const endTime = end.getTime();

    const allRecords: OpenInterestRecord[] = [];
    let cursor: string | undefined;

    do {
      await this.rateLimiter.throttle();

      // Build query string
      const params = new URLSearchParams({
        category: 'linear',
        symbol: bybitSymbol,
        intervalTime,
        startTime: String(startTime),
        endTime: String(endTime),
        limit: '200',
      });
      if (cursor) {
        params.set('cursor', cursor);
      }

      const url = `https://api.bybit.com/v5/market/open-interest?${params.toString()}`;

      // Native fetch (Node 20+)
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Bybit OI API HTTP error: ${response.status} ${response.statusText} for ${url}`
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as any;

      if (json.retCode !== 0) {
        throw new Error(
          `Bybit OI API error: retCode=${json.retCode} retMsg="${json.retMsg}" symbol=${bybitSymbol}`
        );
      }

      const list: Array<{ openInterest: string; timestamp: string }> =
        json.result?.list ?? [];

      for (const item of list) {
        const ts = Number(item.timestamp);
        const oi = parseFloat(item.openInterest);
        if (!isNaN(ts) && !isNaN(oi)) {
          allRecords.push({ timestamp: ts, openInterestAmount: oi });
        }
      }

      // Advance cursor (empty string means no more pages)
      cursor = (json.result?.nextPageCursor as string | undefined) || undefined;
      if (cursor === '') cursor = undefined;

      // If we got fewer than 200 records there are no more pages
      if (list.length < 200) {
        cursor = undefined;
      }
    } while (cursor !== undefined);

    // API returns newest-first; reverse to get ascending order
    allRecords.reverse();

    // Remove duplicates (defensive)
    const unique: OpenInterestRecord[] = [];
    let lastTs = -1;
    for (const rec of allRecords) {
      if (rec.timestamp !== lastTs) {
        unique.push(rec);
        lastTs = rec.timestamp;
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
