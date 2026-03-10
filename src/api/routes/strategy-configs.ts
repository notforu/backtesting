/**
 * Strategy Config API routes
 *
 * Provides CRUD endpoints for strategy_configs plus sub-resource endpoints
 * for linked backtest runs and paper sessions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import {
  findOrCreateStrategyConfig,
  listStrategyConfigs,
  getStrategyConfig,
  getStrategyConfigVersions,
  getStrategyConfigDeletionInfo,
  deleteStrategyConfig,
} from '../../data/strategy-config.js';
import { getBacktestSummaries, type HistoryFilters } from '../../data/db.js';
import { getPool } from '../../data/db.js';

// ============================================================================
// Zod schemas
// ============================================================================

const ListQuerySchema = z.object({
  strategy: z.string().optional(),
  symbol: z.string().optional(),
  timeframe: z.string().optional(),
});

const CreateBodySchema = z.object({
  strategyName: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

const VersionsQuerySchema = z.object({
  strategy: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
});

// ============================================================================
// Route registration
// ============================================================================

export async function strategyConfigRoutes(fastify: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /api/strategy-configs
  // List all strategy configs with optional filters.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/strategy-configs',
    async (
      request: FastifyRequest<{ Querystring: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      try {
        const { strategy, symbol, timeframe } = ListQuerySchema.parse(request.query);
        const configs = await listStrategyConfigs({
          strategyName: strategy,
          symbol,
          timeframe,
        });
        return reply.status(200).send(configs);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error listing strategy configs' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/strategy-configs/versions
  // Get all configs with the same strategy+symbol+timeframe (version history).
  // Must be registered BEFORE /:id to avoid route collision.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/strategy-configs/versions',
    async (
      request: FastifyRequest<{ Querystring: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      try {
        const { strategy, symbol, timeframe } = VersionsQuerySchema.parse(request.query);
        const versions = await getStrategyConfigVersions(strategy, symbol, timeframe);
        return reply.status(200).send(versions);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error fetching strategy config versions' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/strategy-configs/:id
  // Get a single strategy config by ID.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/strategy-configs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const config = await getStrategyConfig(request.params.id);
        if (!config) {
          return reply
            .status(404)
            .send({ error: `Strategy config "${request.params.id}" not found` });
        }
        return reply.status(200).send(config);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching strategy config' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/strategy-configs
  // Find-or-create a strategy config (content-hash deduplication).
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/strategy-configs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const parsed = CreateBodySchema.parse(request.body);
        const result = await findOrCreateStrategyConfig({
          strategyName: parsed.strategyName,
          symbol: parsed.symbol,
          timeframe: parsed.timeframe,
          params: parsed.params,
        });
        return reply.status(result.created ? 201 : 200).send(result);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error creating strategy config' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /api/strategy-configs/:id
  // Delete a config with cascade (deletes linked runs, unlinks sessions).
  // -------------------------------------------------------------------------
  fastify.delete(
    '/api/strategy-configs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // Verify the config exists before attempting deletion
        const config = await getStrategyConfig(id);
        if (!config) {
          return reply.status(404).send({ error: `Strategy config "${id}" not found` });
        }

        // Fetch deletion info so we can return meaningful counts
        const info = await getStrategyConfigDeletionInfo(id);

        // Perform cascading delete inside a transaction
        await deleteStrategyConfig(id);

        return reply.status(200).send({
          message: `Strategy config "${id}" deleted`,
          deletedRuns: info.runCount,
          unlinkedSessions: info.paperSessionCount,
        });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error deleting strategy config' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/strategy-configs/:id/runs
  // Get all backtest runs for a specific strategy config.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/strategy-configs/:id/runs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // Verify config exists
        const config = await getStrategyConfig(id);
        if (!config) {
          return reply.status(404).send({ error: `Strategy config "${id}" not found` });
        }

        const filters: HistoryFilters = { strategyConfigId: id };
        const { summaries, total } = await getBacktestSummaries(1000, 0, filters);

        const results = summaries.map((summary) => ({
          id: summary.id,
          strategyName: summary.config.strategyName,
          symbol: summary.config.symbol,
          timeframe: summary.config.timeframe,
          totalReturnPercent: summary.metrics.totalReturnPercent,
          sharpeRatio: summary.metrics.sharpeRatio,
          runAt: new Date(summary.createdAt).toISOString(),
          exchange: summary.config.exchange,
          startDate: summary.config.startDate,
          endDate: summary.config.endDate,
          params: summary.config.params,
          mode: summary.config.mode,
          maxDrawdownPercent: summary.metrics.maxDrawdownPercent,
          winRate: summary.metrics.winRate,
          profitFactor: summary.metrics.profitFactor,
          totalTrades: summary.metrics.totalTrades,
          totalFees: summary.metrics.totalFees,
          aggregationId: summary.aggregationId,
          aggregationName: summary.aggregationName,
          strategyConfigId: summary.strategyConfigId,
        }));

        return reply.status(200).send({ results, total });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching runs for strategy config' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/strategy-configs/:id/paper-sessions
  // Get paper trading sessions linked to this config (directly or via
  // aggregation configs that reference it).
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/strategy-configs/:id/paper-sessions',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // Verify config exists
        const config = await getStrategyConfig(id);
        if (!config) {
          return reply.status(404).send({ error: `Strategy config "${id}" not found` });
        }

        const pool = getPool();

        // Find sessions linked directly via strategy_config_id OR
        // via an aggregation config that contains this strategy config in its
        // sub_strategy_config_ids array.
        const { rows } = await pool.query<{
          id: string;
          name: string;
          status: string;
          initial_capital: string;
          current_equity: string;
          created_at: string;
          updated_at: string;
          aggregation_config_id: string | null;
        }>(
          `SELECT
             ps.id,
             ps.name,
             ps.status,
             ps.initial_capital,
             ps.current_equity,
             ps.created_at,
             ps.updated_at,
             ps.aggregation_config_id
           FROM paper_sessions ps
           WHERE ps.strategy_config_id = $1
              OR ps.aggregation_config_id IN (
                   SELECT id
                   FROM aggregation_configs
                   WHERE $1 = ANY(sub_strategy_config_ids)
                 )
           ORDER BY ps.created_at DESC`,
          [id]
        );

        const sessions = rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          initialCapital: Number(row.initial_capital),
          currentEquity: Number(row.current_equity),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
          aggregationConfigId: row.aggregation_config_id ?? undefined,
        }));

        return reply.status(200).send(sessions);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching paper sessions for strategy config' });
        return reply
          .status(500)
          .send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );
}
