import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  saveAggregationConfig,
  getAggregationConfig,
  getAggregationConfigs,
  updateAggregationConfig,
  deleteAggregationConfig,
  getPool,
  getBacktestSummaries,
  type AggregationConfig,
  type HistoryFilters,
} from '../../data/db.js';
import { findOrCreateStrategyConfig } from '../../data/strategy-config.js';
import { computeAggregationConfigHash } from '../../utils/content-hash.js';
import type { Timeframe } from '../../core/types.js';
import type { AllocationMode } from '../../core/signal-types.js';

// Zod schemas for validation
const SubStrategySchema = z.object({
  strategyName: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  exchange: z.string().optional(),
});

const CreateAggregationSchema = z.object({
  name: z.string().min(1),
  allocationMode: z.enum(['single_strongest', 'weighted_multi', 'top_n']).default('single_strongest'),
  maxPositions: z.number().int().min(1).default(3),
  subStrategies: z.array(SubStrategySchema).min(1),
  initialCapital: z.number().positive().default(10000),
  exchange: z.string().default('bybit'),
  mode: z.enum(['spot', 'futures']).default('futures'),
});

const UpdateAggregationSchema = z.object({
  name: z.string().min(1).optional(),
  allocationMode: z.enum(['single_strongest', 'weighted_multi', 'top_n']).optional(),
  maxPositions: z.number().int().min(1).optional(),
  subStrategies: z.array(SubStrategySchema).min(1).optional(),
  initialCapital: z.number().positive().optional(),
  exchange: z.string().optional(),
  mode: z.enum(['spot', 'futures']).optional(),
});

const RunAggregationSchema = z.object({
  startDate: z.union([
    z.number(),
    z.string().transform((s) => new Date(s).getTime()),
  ]),
  endDate: z.union([
    z.number(),
    z.string().transform((s) => new Date(s).getTime()),
  ]),
  initialCapital: z.number().positive().optional(),
});

export async function aggregationRoutes(fastify: FastifyInstance) {
  // GET /api/aggregations - list all
  fastify.get('/api/aggregations', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const configs = await getAggregationConfigs();
      return reply.status(200).send(configs);
    } catch (error) {
      fastify.log.error({ err: error, msg: 'Error listing aggregations' });
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // POST /api/aggregations - create new
  fastify.post('/api/aggregations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = CreateAggregationSchema.parse(request.body);
      const now = Date.now();

      // Find or create a strategy_config record for each sub-strategy so the UI
      // can navigate to individual sub-strategy configs.
      const subStrategyConfigIds: string[] = await Promise.all(
        parsed.subStrategies.map(async (sub) => {
          const { config: strategyConfig } = await findOrCreateStrategyConfig({
            strategyName: sub.strategyName,
            symbol: sub.symbol,
            timeframe: sub.timeframe,
            params: sub.params ?? {},
          });
          return strategyConfig.id;
        })
      );

      const contentHash = computeAggregationConfigHash({
        allocationMode: parsed.allocationMode,
        maxPositions: parsed.maxPositions,
        strategyConfigIds: subStrategyConfigIds,
      });

      const config: AggregationConfig = {
        id: uuidv4(),
        name: parsed.name,
        allocationMode: parsed.allocationMode,
        maxPositions: parsed.maxPositions,
        subStrategies: parsed.subStrategies,
        subStrategyConfigIds,
        contentHash,
        initialCapital: parsed.initialCapital,
        exchange: parsed.exchange,
        mode: parsed.mode,
        createdAt: now,
        updatedAt: now,
      };
      await saveAggregationConfig(config);
      return reply.status(201).send(config);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      if (
        error instanceof Error &&
        error.message.includes('Cannot create strategy config') &&
        error.message.includes('empty params')
      ) {
        return reply.status(400).send({ error: error.message });
      }
      fastify.log.error({ err: error, msg: 'Error creating aggregation' });
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // GET /api/aggregations/:id - get single
  fastify.get(
    '/api/aggregations/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const config = await getAggregationConfig(request.params.id);
        if (!config) {
          return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
        }
        return reply.status(200).send(config);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error getting aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // PUT /api/aggregations/:id - update
  fastify.put(
    '/api/aggregations/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const parsed = UpdateAggregationSchema.parse(request.body);

        // When subStrategies is being updated, regenerate subStrategyConfigIds and contentHash
        // so the stored IDs stay in sync with the current sub-strategy list.
        let extraFields: { subStrategyConfigIds?: string[]; contentHash?: string } = {};
        if (parsed.subStrategies) {
          // Load existing config to resolve allocationMode/maxPositions when not included in update.
          const existing = await getAggregationConfig(request.params.id);
          if (!existing) {
            return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
          }

          const subStrategyConfigIds: string[] = await Promise.all(
            parsed.subStrategies.map(async (sub) => {
              const { config: strategyConfig } = await findOrCreateStrategyConfig({
                strategyName: sub.strategyName,
                symbol: sub.symbol,
                timeframe: sub.timeframe,
                params: sub.params ?? {},
              });
              return strategyConfig.id;
            })
          );

          const contentHash = computeAggregationConfigHash({
            allocationMode: parsed.allocationMode ?? existing.allocationMode,
            maxPositions: parsed.maxPositions ?? existing.maxPositions,
            strategyConfigIds: subStrategyConfigIds,
          });

          extraFields = { subStrategyConfigIds, contentHash };
        }

        const updated = await updateAggregationConfig(request.params.id, {
          ...parsed,
          ...extraFields,
        });
        if (!updated) {
          return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
        }
        return reply.status(200).send(updated);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        if (
          error instanceof Error &&
          error.message.includes('Cannot create strategy config') &&
          error.message.includes('empty params')
        ) {
          return reply.status(400).send({ error: error.message });
        }
        fastify.log.error({ err: error, msg: 'Error updating aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // POST /api/aggregations/:id/regenerate-ids - repair stale subStrategyConfigIds
  fastify.post(
    '/api/aggregations/:id/regenerate-ids',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const config = await getAggregationConfig(request.params.id);
        if (!config) {
          return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
        }

        const subStrategyConfigIds: string[] = await Promise.all(
          config.subStrategies.map(async (sub) => {
            const { config: strategyConfig } = await findOrCreateStrategyConfig({
              strategyName: sub.strategyName,
              symbol: sub.symbol,
              timeframe: sub.timeframe,
              params: sub.params ?? {},
            });
            return strategyConfig.id;
          })
        );

        const contentHash = computeAggregationConfigHash({
          allocationMode: config.allocationMode,
          maxPositions: config.maxPositions,
          strategyConfigIds: subStrategyConfigIds,
        });

        const updated = await updateAggregationConfig(request.params.id, {
          subStrategyConfigIds,
          contentHash,
        });

        return reply.status(200).send(updated);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Cannot create strategy config') &&
          error.message.includes('empty params')
        ) {
          return reply.status(400).send({ error: error.message });
        }
        fastify.log.error({ err: error, msg: 'Error regenerating sub-strategy config IDs' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // GET /api/aggregations/:id/paper-sessions
  fastify.get(
    '/api/aggregations/:id/paper-sessions',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const config = await getAggregationConfig(id);
        if (!config) {
          return reply.status(404).send({ error: `Aggregation "${id}" not found` });
        }

        const pool = getPool();

        const { rows } = await pool.query<{
          id: string;
          name: string;
          status: string;
          initial_capital: string;
          current_equity: string;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, name, status, initial_capital, current_equity, created_at, updated_at
           FROM paper_sessions
           WHERE aggregation_config_id = $1
           ORDER BY created_at DESC`,
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
        }));

        return reply.status(200).send(sessions);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching paper sessions for aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // GET /api/aggregations/:id/runs
  fastify.get(
    '/api/aggregations/:id/runs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        const config = await getAggregationConfig(id);
        if (!config) {
          return reply.status(404).send({ error: `Aggregation "${id}" not found` });
        }

        const filters: HistoryFilters = { aggregationId: id };
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
        }));

        return reply.status(200).send({ results, total });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching runs for aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // DELETE /api/aggregations/:id - delete
  fastify.delete(
    '/api/aggregations/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const deleted = await deleteAggregationConfig(request.params.id);
        if (!deleted) {
          return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
        }
        return reply.status(200).send({ message: `Aggregation "${request.params.id}" deleted` });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error deleting aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // POST /api/aggregations/:id/run - run aggregation
  fastify.post(
    '/api/aggregations/:id/run',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const config = await getAggregationConfig(request.params.id);
        if (!config) {
          return reply.status(404).send({ error: `Aggregation "${request.params.id}" not found` });
        }

        const parsed = RunAggregationSchema.parse(request.body);

        const { runAggregateBacktest } = await import('../../core/aggregate-engine.js');

        const aggregateConfig = {
          subStrategies: config.subStrategies.map((s) => ({
            strategyName: s.strategyName,
            symbol: s.symbol,
            timeframe: s.timeframe as Timeframe,
            params: s.params ?? {},
            exchange: s.exchange ?? config.exchange,
          })),
          allocationMode: config.allocationMode as AllocationMode,
          maxPositions: config.maxPositions,
          initialCapital: parsed.initialCapital ?? config.initialCapital,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          exchange: config.exchange,
          mode: config.mode as 'spot' | 'futures',
        };

        const startTime = Date.now();
        const result = await runAggregateBacktest(aggregateConfig, {
          enableLogging: true,
          saveResults: false, // We save manually with aggregation_id link
        });
        const duration = Date.now() - startTime;

        // Save result with aggregation_id link
        const { saveBacktestRun } = await import('../../data/db.js');
        await saveBacktestRun(result, request.params.id);

        return reply.status(200).send({
          ...result,
          aggregationId: request.params.id,
          aggregationName: config.name,
          candles: [],
          duration,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error running aggregation' });
        return reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );
}
