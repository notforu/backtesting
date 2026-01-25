/**
 * Optimization API routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { runOptimization } from '../../core/optimizer.js';
import {
  getOptimizedParams,
  getAllOptimizedParams,
  deleteOptimizedParams,
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
  optimizeFor: z.enum(['sharpeRatio', 'totalReturnPercent', 'profitFactor', 'winRate']).default('sharpeRatio'),
  maxCombinations: z.number().positive().optional().default(100),
  batchSize: z.number().positive().optional().default(4),
});

type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export async function optimizeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/optimize
   * Start an optimization job
   */
  fastify.post('/api/optimize', async (
    request: FastifyRequest<{ Body: OptimizeRequest }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse request
      const parsed = OptimizeRequestSchema.parse(request.body);

      // Run the optimization
      const startTime = Date.now();
      const result = await runOptimization({
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
      });
      const duration = Date.now() - startTime;

      // Result is already saved to database by runOptimization

      // Return the result with duration
      return reply.status(200).send({
        ...result,
        duration,
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
   * GET /api/optimize/:strategyName/:symbol
   * Get saved optimized parameters for a strategy and symbol
   */
  fastify.get('/api/optimize/:strategyName/:symbol', async (
    request: FastifyRequest<{ Params: { strategyName: string; symbol: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { strategyName, symbol } = request.params;
      const result = getOptimizedParams(strategyName, symbol);

      if (!result) {
        return reply.status(404).send({
          error: `Optimization result for strategy "${strategyName}" and symbol "${symbol}" not found`,
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
      const results = getAllOptimizedParams();
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
   * DELETE /api/optimize/:strategyName/:symbol
   * Delete a saved optimization result
   */
  fastify.delete('/api/optimize/:strategyName/:symbol', async (
    request: FastifyRequest<{ Params: { strategyName: string; symbol: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { strategyName, symbol } = request.params;
      const deleted = deleteOptimizedParams(strategyName, symbol);

      if (!deleted) {
        return reply.status(404).send({
          error: `Optimization result for strategy "${strategyName}" and symbol "${symbol}" not found`,
        });
      }

      return reply.status(200).send({
        message: `Optimization result for "${strategyName}" on "${symbol}" deleted successfully`,
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
