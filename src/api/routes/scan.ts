/**
 * Scanner API routes
 * Routes for running multi-market backtests with SSE streaming
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { runBacktest } from '../../core/engine.js';
import type { BacktestConfig } from '../../core/types.js';

// Request schema for scanner
const ScanRequestSchema = z.object({
  strategy: z.string().min(1),
  symbols: z.array(z.string()).min(1).max(50),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']),
  from: z.string(),
  to: z.string(),
  exchange: z.string().optional().default('bybit'),
  slippage: z.number().min(0).max(100).optional().default(0),
  initialCapital: z.number().positive().optional().default(10000),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

type ScanRequest = z.infer<typeof ScanRequestSchema>;

interface ScanSummary {
  total: number;
  profitable: number;
  avgSharpe: number;
  avgReturn: number;
}

export async function scanRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/backtest/scan
   * Run backtests across multiple markets with SSE streaming
   */
  fastify.post('/api/backtest/scan', async (
    request: FastifyRequest<{ Body: ScanRequest }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse request body
      const parsed = ScanRequestSchema.parse(request.body);

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const symbols = parsed.symbols;
      const total = symbols.length;

      // Track summary stats
      const summary: ScanSummary = {
        total,
        profitable: 0,
        avgSharpe: 0,
        avgReturn: 0,
      };

      let sharpeSum = 0;
      let returnSum = 0;
      let completedCount = 0;

      // Loop through symbols sequentially
      for (let i = 0; i < total; i++) {
        const symbol = symbols[i];

        // Send progress event
        const progressEvent = {
          type: 'progress',
          current: i + 1,
          total,
        };
        reply.raw.write(`data: ${JSON.stringify(progressEvent)}\n\n`);

        try {
          // Build BacktestConfig for this symbol
          const config: BacktestConfig = {
            id: uuidv4(),
            strategyName: parsed.strategy,
            params: parsed.params,
            symbol,
            timeframe: parsed.timeframe,
            startDate: new Date(parsed.from).getTime(),
            endDate: new Date(parsed.to).getTime(),
            initialCapital: parsed.initialCapital,
            exchange: parsed.exchange,
          };

          // Run backtest with saveResults disabled (scanner doesn't persist)
          const result = await runBacktest(config, {
            saveResults: false,
            enableLogging: false,
            skipFeeFetch: false, // Fetch fees for accuracy
            broker: {
              slippagePercent: parsed.slippage,
            },
          });

          // Extract key metrics
          const { metrics, trades } = result;
          const isProfitable = metrics.totalReturnPercent > 0;

          if (isProfitable) {
            summary.profitable++;
          }

          sharpeSum += metrics.sharpeRatio;
          returnSum += metrics.totalReturnPercent;
          completedCount++;

          // Send result event
          const resultEvent = {
            type: 'result',
            symbol,
            metrics: {
              totalReturnPercent: metrics.totalReturnPercent,
              sharpeRatio: metrics.sharpeRatio,
              maxDrawdownPercent: metrics.maxDrawdownPercent,
              winRate: metrics.winRate,
              profitFactor: metrics.profitFactor,
            },
            tradesCount: trades.length,
            status: 'complete',
          };
          reply.raw.write(`data: ${JSON.stringify(resultEvent)}\n\n`);
        } catch (error) {
          // Send error result for this symbol and continue
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorEvent = {
            type: 'result',
            symbol,
            error: errorMessage,
            status: 'error',
          };
          reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);

          fastify.log.error(`Error backtesting ${symbol}: ${errorMessage}`);
        }
      }

      // Calculate summary averages
      if (completedCount > 0) {
        summary.avgSharpe = sharpeSum / completedCount;
        summary.avgReturn = returnSum / completedCount;
      }

      // Send done event
      const doneEvent = {
        type: 'done',
        summary,
      };
      reply.raw.write(`data: ${JSON.stringify(doneEvent)}\n\n`);

      // End the response
      reply.raw.end();
    } catch (error) {
      // Validation or setup error - send error and close
      if (error instanceof ZodError) {
        const errorEvent = {
          type: 'error',
          error: 'Validation error',
          details: error.issues,
        };
        reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        const errorEvent = {
          type: 'error',
          error: errorMessage,
        };
        reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      }

      reply.raw.end();
      fastify.log.error({ err: error, msg: 'Error in /api/backtest/scan' });
    }

    // Return reply to prevent Fastify from trying to serialize
    return reply;
  });
}
