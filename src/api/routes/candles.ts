/**
 * Candles API routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import type { Timeframe } from '../../core/types.js';

const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
import { getCandles, getCandleDateRange, saveCandles } from '../../data/index.js';
import { getProvider, getSupportedExchanges } from '../../data/providers/index.js';

// Query schema for fetching candles
const CandlesQuerySchema = z.object({
  exchange: z.string().default('binance'),
  symbol: z.string(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1h'),
  start: z.string().or(z.number()).transform((s) =>
    typeof s === 'number' ? s : new Date(s).getTime()
  ),
  end: z.string().or(z.number()).transform((s) =>
    typeof s === 'number' ? s : new Date(s).getTime()
  ),
  forceRefresh: z.string().optional().transform((s) => s === 'true'),
});

type CandlesQuery = z.infer<typeof CandlesQuerySchema>;

export async function candleRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/candles
   * Get candles for a symbol (from cache or fetch from exchange)
   */
  fastify.get('/api/candles', async (
    request: FastifyRequest<{ Querystring: CandlesQuery }>,
    reply: FastifyReply
  ) => {
    try {
      const query = CandlesQuerySchema.parse(request.query);
      const { exchange, symbol, timeframe, start, end, forceRefresh } = query;

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedRange = await getCandleDateRange(exchange, symbol, timeframe);

        if (cachedRange.start !== null && cachedRange.end !== null && cachedRange.start <= start) {
          // Full cache hit: cache covers entire requested range
          if (cachedRange.end >= end) {
            const candles = await getCandles(exchange, symbol, timeframe as Timeframe, start, end);
            return reply.status(200).send({ candles, source: 'cache', count: candles.length });
          }

          // Partial cache hit: cache covers start but end is slightly behind (within 1 day).
          // Serve cached data + fetch only the gap from exchange.
          const cacheGapMs = end - cachedRange.end;
          const ONE_DAY_MS = 86_400_000;
          if (cacheGapMs <= ONE_DAY_MS) {
            const cached = await getCandles(exchange, symbol, timeframe as Timeframe, start, cachedRange.end);
            // Fetch just the gap from the exchange (cachedRange.end → now)
            try {
              const provider = getProvider(exchange);
              const gapCandles = await provider.fetchCandles(
                symbol,
                timeframe as Timeframe,
                new Date(cachedRange.end),
                new Date(end)
              );
              if (gapCandles.length > 0) {
                await saveCandles(gapCandles, exchange, symbol, timeframe as Timeframe);
              }
              // Merge: append gap candles that are newer than the last cached candle
              const lastCachedTs = cached.length > 0 ? cached[cached.length - 1].timestamp : 0;
              const newCandles = gapCandles.filter(c => c.timestamp > lastCachedTs);
              const merged = [...cached, ...newCandles];
              return reply.status(200).send({ candles: merged, source: 'cache+gap', count: merged.length });
            } catch {
              // Gap fetch failed — serve cached portion anyway
              return reply.status(200).send({ candles: cached, source: 'cache-partial', count: cached.length });
            }
          }
        }
      }

      // Fetch from exchange
      const provider = getProvider(exchange);
      const candles = await provider.fetchCandles(
        symbol,
        timeframe as Timeframe,
        new Date(start),
        new Date(end)
      );

      // Cache the fetched candles
      if (candles.length > 0) {
        await saveCandles(candles, exchange, symbol, timeframe as Timeframe);
      }

      return reply.status(200).send({
        candles,
        source: 'exchange',
        count: candles.length,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.issues,
        });
      }

      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }

      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/candles/range
   * Get the date range of cached candles
   */
  fastify.get('/api/candles/range', async (
    request: FastifyRequest<{
      Querystring: { exchange?: string; symbol: string; timeframe?: string }
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { exchange = 'binance', symbol, timeframe = '1h' } = request.query;

      if (!symbol) {
        return reply.status(400).send({
          error: 'Symbol is required',
        });
      }

      // Validate timeframe
      const validTimeframe = VALID_TIMEFRAMES.includes(timeframe as Timeframe)
        ? (timeframe as Timeframe)
        : '1h';

      const range = await getCandleDateRange(exchange, symbol, validTimeframe);

      return reply.status(200).send({
        exchange,
        symbol,
        timeframe,
        ...range,
        startDate: range.start ? new Date(range.start).toISOString() : null,
        endDate: range.end ? new Date(range.end).toISOString() : null,
      });
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }
      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/exchanges
   * List supported exchanges
   */
  fastify.get('/api/exchanges', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const exchanges = getSupportedExchanges();
      return reply.status(200).send(exchanges);
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }
      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/symbols
   * List available symbols for an exchange
   */
  fastify.get('/api/symbols', async (
    request: FastifyRequest<{ Querystring: { exchange?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { exchange = 'binance' } = request.query;
      const provider = getProvider(exchange);
      const symbols = await provider.getAvailableSymbols();

      return reply.status(200).send(symbols);
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }
      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });
}
