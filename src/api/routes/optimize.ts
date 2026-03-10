/**
 * Optimization API routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { runOptimization, runMultiOptimization } from '../../core/optimizer.js';
import {
  getOptimizedParams,
  getOptimizationHistory,
  getAllOptimizedParams,
  deleteOptimizedParams,
  deleteOptimizationById,
} from '../../data/db.js';

// Request schema for optimization
const OptimizeRequestSchema = z.object({
  strategyName: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1h'),
  startDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  endDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  initialCapital: z.number().positive().default(10000),
  exchange: z.string().default('binance'),
  optimizeFor: z.enum(['sharpeRatio', 'totalReturnPercent', 'profitFactor', 'winRate', 'composite']).default('totalReturnPercent'),
  maxCombinations: z.number().positive().optional().default(500),
  batchSize: z.number().positive().optional().default(4),
  minTrades: z.number().positive().optional().default(15),
  leverage: z.number().positive().optional().default(1),
  saveAllRuns: z.boolean().optional().default(false),
  mode: z.enum(['spot', 'futures']).optional(),
  symbols: z.array(z.string()).optional(),
  timeframes: z.array(z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'])).optional(),
});

type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export async function optimizeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/optimize
   * Start an optimization job with Server-Sent Events (SSE) for progress updates
   */
  fastify.post('/api/optimize', async (
    request: FastifyRequest<{ Body: OptimizeRequest }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse request
      const parsed = OptimizeRequestSchema.parse(request.body);

      // Set up SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      reply.raw.write(`data: ${JSON.stringify({ type: 'start', message: 'Starting optimization...' })}\n\n`);

      const startTime = Date.now();

      const baseConfig = {
        strategyName: parsed.strategyName,
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        initialCapital: parsed.initialCapital,
        exchange: parsed.exchange,
        optimizeFor: parsed.optimizeFor,
        maxCombinations: parsed.maxCombinations,
        batchSize: parsed.batchSize,
        minTrades: parsed.minTrades,
        leverage: parsed.leverage,
        saveAllRuns: parsed.saveAllRuns,
        mode: parsed.mode,
      };

      // Check if multi-symbol/timeframe optimization
      const multiSymbols = parsed.symbols && parsed.symbols.length > 0 ? parsed.symbols : null;
      const multiTimeframes = parsed.timeframes && parsed.timeframes.length > 0 ? parsed.timeframes : null;

      if (multiSymbols || multiTimeframes) {
        // Multi-symbol/timeframe optimization
        const symbols = multiSymbols || [parsed.symbol];
        const timeframes = multiTimeframes || [parsed.timeframe];

        const results = await runMultiOptimization(
          baseConfig,
          symbols,
          timeframes as any,
          (progress) => {
            try {
              reply.raw.write(`data: ${JSON.stringify({
                type: 'progress',
                ...progress,
              })}\n\n`);
            } catch (err) {
              console.error('Error sending progress update:', err);
            }
          }
        );

        const duration = Date.now() - startTime;

        reply.raw.write(`data: ${JSON.stringify({
          type: 'complete',
          result: {
            results,
            totalJobs: symbols.length * timeframes.length,
            completedJobs: results.length,
            duration,
          },
        })}\n\n`);
      } else {
        // Single optimization (existing behavior)
        const result = await runOptimization(
          baseConfig,
          (progress) => {
            try {
              reply.raw.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
            } catch (err) {
              console.error('Error sending progress update:', err);
            }
          }
        );
        const duration = Date.now() - startTime;

        reply.raw.write(`data: ${JSON.stringify({
          type: 'complete',
          result: { ...result, duration }
        })}\n\n`);
      }

      // Close the connection
      reply.raw.end();
    } catch (error) {
      // Send error event via SSE if connection is still open
      try {
        if (error instanceof ZodError) {
          reply.raw.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Validation error',
            details: error.issues
          })}\n\n`);
        } else if (error instanceof Error) {
          reply.raw.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
          })}\n\n`);
        } else {
          reply.raw.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Unknown error occurred'
          })}\n\n`);
        }
        reply.raw.end();
      } catch {
        // If we can't send error via SSE, connection might be closed
        console.error('Error during optimization:', error);
      }
    }
  });

  /**
   * GET /api/optimize/:strategyName/:symbol/:timeframe
   * Get all optimization runs for a strategy, symbol, and timeframe
   * Returns an array of optimization results sorted by most recent first
   */
  fastify.get('/api/optimize/:strategyName/:symbol/:timeframe', async (
    request: FastifyRequest<{ Params: { strategyName: string; symbol: string; timeframe: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { strategyName, symbol, timeframe } = request.params;
      const results = await getOptimizationHistory(strategyName, symbol, timeframe);

      if (results.length === 0) {
        return reply.status(404).send({
          error: `No optimization results found for strategy "${strategyName}", symbol "${symbol}", and timeframe "${timeframe}"`,
        });
      }

      return reply.status(200).send(results);
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
   * GET /api/optimize/:strategyName/:symbol/:timeframe/latest
   * Get the most recent optimization run for a strategy, symbol, and timeframe
   */
  fastify.get('/api/optimize/:strategyName/:symbol/:timeframe/latest', async (
    request: FastifyRequest<{ Params: { strategyName: string; symbol: string; timeframe: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { strategyName, symbol, timeframe } = request.params;
      const result = await getOptimizedParams(strategyName, symbol, timeframe);

      if (!result) {
        return reply.status(404).send({
          error: `No optimization results found for strategy "${strategyName}", symbol "${symbol}", and timeframe "${timeframe}"`,
        });
      }

      return reply.status(200).send(result);
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
   * GET /api/optimize/all
   * List all saved optimization results
   */
  fastify.get('/api/optimize/all', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const results = await getAllOptimizedParams();
      return reply.status(200).send(results);
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
   * DELETE /api/optimize/:strategyName/:symbol/:timeframe
   * Delete all optimization runs for a strategy, symbol, and timeframe
   */
  fastify.delete('/api/optimize/:strategyName/:symbol/:timeframe', async (
    request: FastifyRequest<{ Params: { strategyName: string; symbol: string; timeframe: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { strategyName, symbol, timeframe } = request.params;
      const deleted = await deleteOptimizedParams(strategyName, symbol, timeframe);

      if (!deleted) {
        return reply.status(404).send({
          error: `No optimization results found for strategy "${strategyName}", symbol "${symbol}", and timeframe "${timeframe}"`,
        });
      }

      return reply.status(200).send({
        message: `All optimization results for "${strategyName}" on "${symbol}" at "${timeframe}" deleted successfully`,
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
   * DELETE /api/optimize/id/:id
   * Delete a specific optimization run by ID
   */
  fastify.delete('/api/optimize/id/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const deleted = await deleteOptimizationById(id);

      if (!deleted) {
        return reply.status(404).send({
          error: `Optimization result with id "${id}" not found`,
        });
      }

      return reply.status(200).send({
        message: `Optimization result deleted successfully`,
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
}
