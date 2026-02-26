/**
 * Paper Trading - Live Data Fetcher
 *
 * Wraps BybitProvider to fetch real-time OHLCV data and funding rates.
 * No API keys required - Bybit public endpoints only.
 */

import { BybitProvider } from '../data/providers/bybit.js';
import type { Candle, FundingRate, Timeframe } from '../core/types.js';
import { timeframeToMs } from '../core/types.js';

export class LiveDataFetcher {
  private provider: BybitProvider;

  constructor() {
    this.provider = new BybitProvider();
  }

  /**
   * Fetch the N most recent CLOSED candles for warmup + signal generation.
   *
   * For a 4h timeframe with count=200, this fetches ~33 days of data.
   * Only returns CLOSED candles (excludes the currently forming bar).
   */
  async fetchLatestCandles(symbol: string, timeframe: Timeframe, count: number): Promise<Candle[]> {
    const tfMs = timeframeToMs(timeframe);
    const now = Date.now();

    // Go back count+2 candles worth of time to ensure we have enough data
    // after filtering the forming bar and edge cases
    const start = new Date(now - (count + 2) * tfMs);
    const end = new Date(now);

    const candles = await this.provider.fetchCandles(symbol, timeframe, start, end);

    // Remove the last candle if it is still forming.
    // A candle is considered closed if its open timestamp + timeframeMs <= now.
    const closedCandles = candles.filter(c => c.timestamp + tfMs <= now);

    // Return only the last `count` candles
    return closedCandles.slice(-count);
  }

  /**
   * Fetch recent funding rate history for a symbol.
   * Goes back `count` funding periods (each typically 8h on Bybit).
   */
  async fetchLatestFundingRates(symbol: string, count: number): Promise<FundingRate[]> {
    const hoursBack = count * 8; // Each FR period is ~8h on Bybit
    const now = Date.now();
    const start = new Date(now - hoursBack * 60 * 60 * 1000);
    const end = new Date(now);

    return this.provider.fetchFundingRateHistory(symbol, start, end);
  }

  /**
   * Get the close price of the last closed candle.
   * Throws if no closed candles are available.
   */
  async fetchCurrentPrice(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<{ price: number; timestamp: number }> {
    const candles = await this.fetchLatestCandles(symbol, timeframe, 1);
    if (candles.length === 0) {
      throw new Error(`No closed candles available for ${symbol} ${timeframe}`);
    }
    const last = candles[candles.length - 1];
    return { price: last.close, timestamp: last.timestamp };
  }
}
