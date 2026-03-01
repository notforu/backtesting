/**
 * Paper Trading API Routes
 *
 * Provides REST endpoints for managing paper trading sessions, including:
 * - Session lifecycle (create, start, pause, resume, stop, delete)
 * - Trade and equity history queries
 * - SSE live event streaming
 * - Force-tick endpoint for development/testing
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { sessionManager } from '../../paper-trading/session-manager.js';
import { getAggregationConfig, getBacktestRun } from '../../data/db.js';
import { getPaperSession, listPaperSessions, getPaperPositions, getPaperTrades, getPaperEquitySnapshots } from '../../paper-trading/db.js';
import type { AggregateBacktestConfig } from '../../core/signal-types.js';

// ============================================================================
// Zod schemas
// ============================================================================

const SimpleStrategyConfigSchema = z.object({
  strategyName: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']),
  exchange: z.string().min(1).default('bybit'),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  mode: z.enum(['spot', 'futures']).default('spot').optional(),
});

const CreateSessionSchema = z
  .object({
    name: z.string().min(1),
    aggregationConfigId: z.string().min(1).optional(),
    strategyConfig: SimpleStrategyConfigSchema.optional(),
    backtestRunId: z.string().min(1).optional(),
    initialCapital: z.number().positive().optional(),
  })
  .refine((data) => data.aggregationConfigId || data.strategyConfig || data.backtestRunId, {
    message: 'Either aggregationConfigId, strategyConfig, or backtestRunId is required',
  });

const TradesQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional().default(50),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).optional().default(0),
});

// ============================================================================
// Route plugin
// ============================================================================

export async function paperTradingRoutes(fastify: FastifyInstance) {
  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions — create session
  // --------------------------------------------------------------------------
  fastify.post('/api/paper-trading/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = CreateSessionSchema.parse(request.body);

      let aggregationConfig: AggregateBacktestConfig;
      let aggregationConfigId: string | undefined;

      if (parsed.aggregationConfigId) {
        // Existing flow: load aggregation config from DB
        const config = await getAggregationConfig(parsed.aggregationConfigId);
        if (!config) {
          return reply.status(404).send({
            error: `Aggregation config "${parsed.aggregationConfigId}" not found`,
            code: 'SESSION_NOT_FOUND',
          });
        }

        // Transform DB AggregationConfig -> AggregateBacktestConfig
        // startDate/endDate set to 0 since they are not used in paper trading (live data only)
        aggregationConfig = {
          subStrategies: config.subStrategies.map((s) => ({
            strategyName: s.strategyName,
            symbol: s.symbol,
            timeframe: s.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
            params: s.params ?? {},
            exchange: s.exchange ?? config.exchange,
          })),
          allocationMode: config.allocationMode as AggregateBacktestConfig['allocationMode'],
          maxPositions: config.maxPositions,
          initialCapital: parsed.initialCapital ?? config.initialCapital,
          startDate: 0,
          endDate: 0,
          exchange: config.exchange,
          mode: config.mode as 'spot' | 'futures' | undefined,
        };
        aggregationConfigId = parsed.aggregationConfigId;
      } else if (parsed.backtestRunId) {
        // Load config from a saved backtest run (supports ad-hoc aggregation runs without a saved aggregation config)
        const run = await getBacktestRun(parsed.backtestRunId);
        if (!run) {
          return reply.status(404).send({
            error: `Backtest run "${parsed.backtestRunId}" not found`,
            code: 'SESSION_NOT_FOUND',
          });
        }

        const runConfig = run.config;
        const params = runConfig.params as Record<string, unknown> | undefined;
        const subStrats = params?.subStrategies as
          | Array<{
              strategyName: string;
              symbol: string;
              timeframe: string;
              params?: Record<string, unknown>;
              exchange?: string;
            }>
          | undefined;

        if (subStrats && Array.isArray(subStrats) && subStrats.length > 0) {
          // Aggregation run — reconstruct from stored sub-strategies
          aggregationConfig = {
            subStrategies: subStrats.map((s) => ({
              strategyName: s.strategyName,
              symbol: s.symbol,
              timeframe: s.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
              params: s.params ?? {},
              exchange: s.exchange ?? runConfig.exchange ?? 'bybit',
            })),
            allocationMode: (
              params?.allocationMode as string ?? 'single_strongest'
            ) as AggregateBacktestConfig['allocationMode'],
            maxPositions: (params?.maxPositions as number) ?? 1,
            initialCapital: parsed.initialCapital ?? runConfig.initialCapital ?? 10000,
            startDate: 0,
            endDate: 0,
            exchange: runConfig.exchange ?? 'bybit',
            mode: runConfig.mode as 'spot' | 'futures' | undefined,
          };
        } else {
          // Single strategy run — wrap as a single sub-strategy aggregation
          aggregationConfig = {
            subStrategies: [
              {
                strategyName: runConfig.strategyName,
                symbol: runConfig.symbol,
                timeframe: runConfig.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
                params: (params as Record<string, unknown>) ?? {},
                exchange: runConfig.exchange ?? 'bybit',
              },
            ],
            allocationMode: 'single_strongest',
            maxPositions: 1,
            initialCapital: parsed.initialCapital ?? runConfig.initialCapital ?? 10000,
            startDate: 0,
            endDate: 0,
            exchange: runConfig.exchange ?? 'bybit',
            mode: runConfig.mode as 'spot' | 'futures' | undefined,
          };
        }
        aggregationConfigId = undefined;
      } else {
        // New flow: wrap single strategy config as a single-sub-strategy AggregateBacktestConfig
        const sc = parsed.strategyConfig!;
        aggregationConfig = {
          subStrategies: [
            {
              strategyName: sc.strategyName,
              symbol: sc.symbol,
              timeframe: sc.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
              params: sc.params ?? {},
              exchange: sc.exchange,
            },
          ],
          allocationMode: 'single_strongest',
          maxPositions: 1,
          initialCapital: parsed.initialCapital ?? 10000,
          startDate: 0,
          endDate: 0,
          exchange: sc.exchange,
          mode: sc.mode,
        };
        aggregationConfigId = undefined;
      }

      const session = await sessionManager.createSession({
        name: parsed.name,
        aggregationConfig,
        aggregationConfigId,
        initialCapital: parsed.initialCapital,
      });

      return reply.status(201).send(session);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      fastify.log.error({ err: error, msg: 'Error creating paper trading session' });
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: message,
        code: 'INTERNAL_ERROR',
        timestamp: Date.now(),
      });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/paper-trading/sessions — list all sessions
  // --------------------------------------------------------------------------
  fastify.get('/api/paper-trading/sessions', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessions = await listPaperSessions();
      return reply.status(200).send(sessions);
    } catch (error) {
      fastify.log.error({ err: error, msg: 'Error listing paper trading sessions' });
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: message,
        code: 'INTERNAL_ERROR',
        timestamp: Date.now(),
      });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/paper-trading/sessions/:id — session detail + open positions
  // --------------------------------------------------------------------------
  fastify.get(
    '/api/paper-trading/sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        const positions = await getPaperPositions(request.params.id);

        return reply.status(200).send({ ...session, openPositions: positions });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error getting paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // DELETE /api/paper-trading/sessions/:id — delete session (stops engine if running)
  // --------------------------------------------------------------------------
  fastify.delete(
    '/api/paper-trading/sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        await sessionManager.deleteSession(request.params.id);
        return reply.status(200).send({ message: `Session "${request.params.id}" deleted` });
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error deleting paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions/:id/start — start session
  // --------------------------------------------------------------------------
  fastify.post(
    '/api/paper-trading/sessions/:id/start',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        if (session.status === 'running') {
          return reply.status(409).send({
            error: `Session "${request.params.id}" is already running`,
            code: 'SESSION_ALREADY_RUNNING',
            sessionId: request.params.id,
          });
        }

        await sessionManager.startSession(request.params.id);
        const updatedSession = await getPaperSession(request.params.id);
        return reply.status(200).send(updatedSession);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error starting paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions/:id/pause — pause session
  // --------------------------------------------------------------------------
  fastify.post(
    '/api/paper-trading/sessions/:id/pause',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        if (session.status !== 'running') {
          return reply.status(409).send({
            error: `Session "${request.params.id}" is not running (current status: ${session.status})`,
            code: 'SESSION_NOT_RUNNING',
            sessionId: request.params.id,
          });
        }

        await sessionManager.pauseSession(request.params.id);
        const updatedSession = await getPaperSession(request.params.id);
        return reply.status(200).send(updatedSession);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error pausing paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions/:id/resume — resume session
  // --------------------------------------------------------------------------
  fastify.post(
    '/api/paper-trading/sessions/:id/resume',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        // Accept paused or error status — error state sessions can be resumed (engine recovers)
        if (session.status !== 'paused' && session.status !== 'error') {
          return reply.status(409).send({
            error: `Session "${request.params.id}" cannot be resumed (current status: ${session.status})`,
            code: 'SESSION_NOT_RUNNING',
            sessionId: request.params.id,
          });
        }

        await sessionManager.resumeSession(request.params.id);
        const updatedSession = await getPaperSession(request.params.id);
        return reply.status(200).send(updatedSession);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error resuming paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions/:id/stop — stop session
  // --------------------------------------------------------------------------
  fastify.post(
    '/api/paper-trading/sessions/:id/stop',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        if (session.status === 'stopped') {
          return reply.status(409).send({
            error: `Session "${request.params.id}" is already stopped`,
            code: 'SESSION_NOT_RUNNING',
            sessionId: request.params.id,
          });
        }

        await sessionManager.stopSession(request.params.id);
        const updatedSession = await getPaperSession(request.params.id);
        return reply.status(200).send(updatedSession);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error stopping paper trading session' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // GET /api/paper-trading/sessions/:id/trades?limit=50&offset=0 — paginated trades
  // --------------------------------------------------------------------------
  fastify.get(
    '/api/paper-trading/sessions/:id/trades',
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      try {
        const query = TradesQuerySchema.parse(request.query);

        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        const { trades, total } = await getPaperTrades(request.params.id, query.limit, query.offset);
        return reply.status(200).send({ trades, total, limit: query.limit, offset: query.offset });
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error fetching paper trading trades' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // GET /api/paper-trading/sessions/:id/equity — equity snapshots for chart
  // --------------------------------------------------------------------------
  fastify.get(
    '/api/paper-trading/sessions/:id/equity',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const session = await getPaperSession(request.params.id);
        if (!session) {
          return reply.status(404).send({
            error: `Session "${request.params.id}" not found`,
            code: 'SESSION_NOT_FOUND',
            sessionId: request.params.id,
          });
        }

        const snapshots = await getPaperEquitySnapshots(request.params.id);
        return reply.status(200).send(snapshots);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error fetching paper trading equity snapshots' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: message,
          code: 'INTERNAL_ERROR',
          sessionId: request.params.id,
          timestamp: Date.now(),
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // GET /api/paper-trading/sessions/:id/stream — SSE live updates
  // --------------------------------------------------------------------------
  fastify.get(
    '/api/paper-trading/sessions/:id/stream',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id: sessionId } = request.params;

      // Verify the session exists before opening SSE connection
      const session = await getPaperSession(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: `Session "${sessionId}" not found`,
          code: 'SESSION_NOT_FOUND',
          sessionId,
        });
      }

      // Set SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      // Send initial connected event
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

      // Subscribe to engine events for this session
      const unsubscribe = sessionManager.subscribe(sessionId, (event) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch (err) {
          fastify.log.error({ err, msg: `Error writing SSE event for session ${sessionId}` });
        }
      });

      // Clean up subscription when client disconnects
      request.raw.on('close', () => {
        unsubscribe();
      });

      // Keep the connection open — never resolves until client disconnects
      await new Promise<void>(() => {});
    }
  );

  // --------------------------------------------------------------------------
  // POST /api/paper-trading/sessions/:id/tick — force-trigger tick (dev only)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    fastify.post(
      '/api/paper-trading/sessions/:id/tick',
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        try {
          const result = await sessionManager.forceTick(request.params.id);
          return reply.status(200).send(result);
        } catch (error) {
          fastify.log.error({ err: error, msg: 'Error force-ticking paper trading session' });
          const message = error instanceof Error ? error.message : 'Unknown error';
          return reply.status(500).send({
            error: message,
            code: 'INTERNAL_ERROR',
            sessionId: request.params.id,
            timestamp: Date.now(),
          });
        }
      }
    );
  }
}
