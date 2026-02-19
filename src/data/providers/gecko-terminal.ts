/**
 * GeckoTerminal OHLCV data fetcher
 * Fetches DEX pool OHLCV data from GeckoTerminal's free API
 *
 * API docs: https://www.geckoterminal.com/dex-api
 * Rate limit: ~30 calls/min on free tier (we use conservative 5/min)
 *
 * NOT a full DataProvider - utility class for research/analysis only
 */

import type { Candle } from '../../core/types.js';

/** Supported GeckoTerminal timeframes */
type GeckoTimeframe = 'minute' | 'hour' | 'day';

/** Pool configuration for a known DEX pair */
interface PoolConfig {
  network: string;
  poolAddress: string;
  label: string;
}

/** Well-known DEX pool addresses */
const KNOWN_POOLS: Record<string, PoolConfig> = {
  'eth-uniswap-v3-eth-usdc': {
    network: 'eth',
    poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
    label: 'Ethereum Uniswap V3 ETH/USDC',
  },
  'arbitrum-uniswap-v3-eth-usdc': {
    network: 'arbitrum',
    poolAddress: '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443',
    label: 'Arbitrum Uniswap V3 ETH/USDC',
  },
  'base-aerodrome-eth-usdc': {
    network: 'base',
    poolAddress: '0xb4cb800910b228ed3d0834cf79d697127bbb00e5',
    label: 'Base Aerodrome ETH/USDC',
  },
  'solana-raydium-sol-usdc': {
    network: 'solana',
    poolAddress: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',
    label: 'Solana Raydium SOL/USDC',
  },
};

export class GeckoTerminalFetcher {
  private readonly baseUrl = 'https://api.geckoterminal.com/api/v2';
  private lastRequestTime = 0;
  private readonly minRequestInterval = 12000; // 5 calls/min = one per 12 seconds

  /**
   * Get known pool configurations
   */
  static getKnownPools(): Record<string, PoolConfig> {
    return { ...KNOWN_POOLS };
  }

  /**
   * Rate-limited fetch
   */
  private async rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise<void>((r) =>
        setTimeout(r, this.minRequestInterval - timeSinceLastRequest)
      );
    }
    this.lastRequestTime = Date.now();

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `GeckoTerminal API error: ${response.status} ${response.statusText}`
      );
    }

    return response;
  }

  /**
   * Fetch OHLCV data for a specific pool
   *
   * @param network - Network identifier (e.g., 'eth', 'arbitrum', 'solana')
   * @param poolAddress - Pool contract address
   * @param timeframe - 'minute', 'hour', or 'day'
   * @param aggregate - Aggregation period (e.g., 1 for 1h, 4 for 4h when timeframe='hour')
   * @param beforeTimestamp - Fetch candles before this unix timestamp (for pagination)
   * @param limit - Number of candles (max 1000)
   * @returns Array of Candle objects
   */
  async fetchPoolOHLCV(
    network: string,
    poolAddress: string,
    timeframe: GeckoTimeframe = 'hour',
    aggregate: number = 1,
    beforeTimestamp?: number,
    limit: number = 1000
  ): Promise<Candle[]> {
    let url = `${this.baseUrl}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}`;
    url += `?aggregate=${aggregate}&limit=${limit}&currency=usd`;
    if (beforeTimestamp !== undefined) {
      url += `&before_timestamp=${beforeTimestamp}`;
    }

    const response = await this.rateLimitedFetch(url);
    const data = (await response.json()) as Record<string, unknown>;

    const attrs = (data?.data as Record<string, unknown>)
      ?.attributes as Record<string, unknown> | undefined;
    const ohlcvList = attrs?.ohlcv_list;

    if (!Array.isArray(ohlcvList)) {
      return [];
    }

    // GeckoTerminal returns [timestamp, open, high, low, close, volume]
    // Timestamps are unix seconds
    const candles: Candle[] = (ohlcvList as number[][]).map((ohlcv) => ({
      timestamp: ohlcv[0] * 1000, // Convert to milliseconds
      open: ohlcv[1],
      high: ohlcv[2],
      low: ohlcv[3],
      close: ohlcv[4],
      volume: ohlcv[5],
    }));

    // Sort ascending by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);
    return candles;
  }

  /**
   * Fetch full OHLCV history for a pool using pagination
   *
   * @param network - Network identifier
   * @param poolAddress - Pool contract address
   * @param timeframe - Candle timeframe
   * @param aggregate - Aggregation period
   * @param startTimestamp - Start time in milliseconds
   * @param endTimestamp - End time in milliseconds (default: now)
   * @returns Array of all candles in the date range
   */
  async fetchFullHistory(
    network: string,
    poolAddress: string,
    timeframe: GeckoTimeframe = 'hour',
    aggregate: number = 1,
    startTimestamp: number = 0,
    endTimestamp: number = Date.now()
  ): Promise<Candle[]> {
    const allCandles: Candle[] = [];
    let beforeTs = Math.floor(endTimestamp / 1000); // Convert to unix seconds

    while (true) {
      console.error(
        `Fetching OHLCV before ${new Date(beforeTs * 1000).toISOString().slice(0, 10)}...`
      );
      const batch = await this.fetchPoolOHLCV(
        network,
        poolAddress,
        timeframe,
        aggregate,
        beforeTs
      );

      if (batch.length === 0) break;

      // Filter to only include candles in our date range
      const filtered = batch.filter(
        (c) => c.timestamp >= startTimestamp && c.timestamp <= endTimestamp
      );
      allCandles.push(...filtered);

      // If earliest candle is before our start, we're done
      const earliestTs = batch[0].timestamp;
      if (earliestTs <= startTimestamp) break;

      // Move pagination cursor before the earliest candle we got
      beforeTs = Math.floor(earliestTs / 1000) - 1;

      // Safety: if we got fewer than expected, we've reached the end
      if (batch.length < 100) break;
    }

    // Sort and deduplicate
    allCandles.sort((a, b) => a.timestamp - b.timestamp);
    const unique: Candle[] = [];
    let lastTs = -1;
    for (const c of allCandles) {
      if (c.timestamp !== lastTs) {
        unique.push(c);
        lastTs = c.timestamp;
      }
    }

    return unique;
  }

  /**
   * Convenience method: fetch OHLCV for a known pool by key
   */
  async fetchKnownPool(
    poolKey: string,
    timeframe: GeckoTimeframe = 'hour',
    aggregate: number = 1,
    startTimestamp?: number,
    endTimestamp?: number
  ): Promise<Candle[]> {
    const pool = KNOWN_POOLS[poolKey];
    if (!pool) {
      throw new Error(
        `Unknown pool: ${poolKey}. Available: ${Object.keys(KNOWN_POOLS).join(', ')}`
      );
    }

    return this.fetchFullHistory(
      pool.network,
      pool.poolAddress,
      timeframe,
      aggregate,
      startTimestamp,
      endTimestamp
    );
  }
}

export { KNOWN_POOLS, type PoolConfig, type GeckoTimeframe };
