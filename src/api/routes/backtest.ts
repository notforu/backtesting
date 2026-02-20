/**
 * Backtest API routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { runBacktest, BacktestConfigSchema, createBacktestConfig } from '../../core/index.js';
import { runPairsBacktest } from '../../core/pairs-engine.js';
import type { PairsBacktestConfig, Timeframe, Trade, EquityPoint, BacktestResult } from '../../core/types.js';
import {
  getBacktestRun,
  getBacktestSummaries,
  getBacktestGroups,
  deleteBacktestRun,
  deleteAllBacktestRuns,
  getCandles,
  saveBacktestRun,
  type HistoryFilters,
} from '../../data/index.js';
import { calculateMetrics, generateEquityCurve } from '../../analysis/metrics.js';

// Request schema for running a backtest
const RunBacktestRequestSchema = z.object({
  strategyName: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  symbol: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1h'),
  startDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  endDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  initialCapital: z.number().positive().default(10000),
  exchange: z.string().default('binance'),
  mode: z.enum(['spot', 'futures']).default('spot').optional(),
});

type RunBacktestRequest = z.infer<typeof RunBacktestRequestSchema>;

// Query params for history
const HistoryQuerySchema = z.object({
  limit: z.string().optional().transform((s) => (s ? parseInt(s, 10) : 10)),
  offset: z.string().optional().transform((s) => (s ? parseInt(s, 10) : 0)),
  strategy: z.string().optional(),
  symbol: z.string().optional(),
  timeframe: z.string().optional(),
  exchange: z.string().optional(),
  mode: z.string().optional(),
  fromDate: z.string().optional().transform((s) => (s ? parseInt(s, 10) : undefined)),
  toDate: z.string().optional().transform((s) => (s ? parseInt(s, 10) : undefined)),
  minSharpe: z.string().optional().transform((s) => (s ? parseFloat(s) : undefined)),
  maxSharpe: z.string().optional().transform((s) => (s ? parseFloat(s) : undefined)),
  minReturn: z.string().optional().transform((s) => (s ? parseFloat(s) : undefined)),
  maxReturn: z.string().optional().transform((s) => (s ? parseFloat(s) : undefined)),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

// Request schema for pairs backtest
const RunPairsBacktestRequestSchema = z.object({
  strategyName: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
  symbolA: z.string().min(1),
  symbolB: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1h'),
  startDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  endDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  initialCapital: z.number().positive().default(10000),
  exchange: z.string().default('binance'),
  leverage: z.number().min(1).max(125).default(1),
});

type RunPairsBacktestRequest = z.infer<typeof RunPairsBacktestRequestSchema>;

// Request schema for multi-asset backtest
const RunMultiBacktestRequestSchema = z.object({
  strategyName: z.string().min(1),
  assets: z.string().min(1), // comma-separated 'SYMBOL@TF'
  startDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  endDate: z.number().or(z.string().transform((s) => new Date(s).getTime())),
  initialCapital: z.number().positive().default(10000),
  exchange: z.string().default('bybit'),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

type RunMultiBacktestRequest = z.infer<typeof RunMultiBacktestRequestSchema>;

interface AssetConfig {
  symbol: string;
  timeframe: Timeframe;
}

interface AssetResult {
  symbol: string;
  timeframe: string;
  metrics: any;
  trades: Trade[];
  equity: EquityPoint[];
  fundingIncome: number;
  tradingPnl: number;
  error?: string;
}

export async function backtestRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/backtest/run
   * Execute a new backtest
   */
  fastify.post('/api/backtest/run', async (
    request: FastifyRequest<{ Body: RunBacktestRequest }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse request
      const parsed = RunBacktestRequestSchema.parse(request.body);

      // Create backtest config with generated ID
      const config = BacktestConfigSchema.parse({
        id: uuidv4(),
        strategyName: parsed.strategyName,
        params: parsed.params,
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        initialCapital: parsed.initialCapital,
        exchange: parsed.exchange,
        mode: parsed.mode,
      });

      // Run the backtest and track duration
      const startTime = Date.now();
      const result = await runBacktest(config);
      const duration = Date.now() - startTime;

      // Fetch candles for the chart display
      const candles = await getCandles(
        config.exchange,
        config.symbol,
        config.timeframe,
        config.startDate,
        config.endDate
      );

      // Return extended result with candles and duration
      return reply.status(200).send({
        ...result,
        candles,
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
   * GET /api/backtest/:id
   * Get a specific backtest result
   */
  fastify.get('/api/backtest/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const result = await getBacktestRun(id);

      if (!result) {
        return reply.status(404).send({
          error: `Backtest with id "${id}" not found`,
        });
      }

      const config = result.config as any;

      // Check if this is a pairs result (has symbolA/symbolB)
      if (config.symbolA && config.symbolB) {
        // Fetch candles for both symbols
        const candlesA = await getCandles(
          config.exchange,
          config.symbolA,
          config.timeframe,
          config.startDate,
          config.endDate
        );
        const candlesB = await getCandles(
          config.exchange,
          config.symbolB,
          config.timeframe,
          config.startDate,
          config.endDate
        );

        return reply.status(200).send({
          ...result,
          candlesA,
          candlesB,
          duration: 0,
        });
      }

      // Single-market result
      const candles = await getCandles(
        result.config.exchange,
        result.config.symbol,
        result.config.timeframe,
        result.config.startDate,
        result.config.endDate
      );

      // Return extended result with candles (duration not available for historical)
      return reply.status(200).send({
        ...result,
        candles,
        duration: 0, // Not stored for historical runs
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
   * GET /api/backtest/history
   * List all backtest runs (returns summaries for efficiency)
   */
  fastify.get('/api/backtest/history', async (
    request: FastifyRequest<{ Querystring: Record<string, string> }>,
    reply: FastifyReply
  ) => {
    try {
      fastify.log.info('GET /api/backtest/history called');
      const {
        limit,
        offset,
        strategy,
        symbol,
        timeframe,
        exchange,
        mode,
        fromDate,
        toDate,
        minSharpe,
        maxSharpe,
        minReturn,
        maxReturn,
        sortBy,
        sortDir,
      } = HistoryQuerySchema.parse(request.query);

      const { summaries, total } = await getBacktestSummaries(limit, offset, {
        strategy,
        symbol,
        timeframe,
        exchange,
        mode,
        fromDate,
        toDate,
        minSharpe,
        maxSharpe,
        minReturn,
        maxReturn,
        sortBy: sortBy as HistoryFilters['sortBy'],
        sortDir,
      });

      // Transform to frontend format with extended fields
      const results = summaries.map((summary) => ({
        id: summary.id,
        strategyName: summary.config.strategyName,
        symbol: summary.config.symbol,
        timeframe: summary.config.timeframe,
        totalReturnPercent: summary.metrics.totalReturnPercent,
        sharpeRatio: summary.metrics.sharpeRatio,
        runAt: new Date(summary.createdAt).toISOString(),
        // Extended fields
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
      }));

      fastify.log.info(`Returning ${results.length} backtest summaries (total: ${total})`);
      return reply.status(200).send({
        results,
        total,
        hasMore: offset + results.length < total,
      });
    } catch (error) {
      // Log full error with stack trace
      fastify.log.error({
        err: error,
        msg: 'Error in /api/backtest/history',
        stack: error instanceof Error ? error.stack : undefined,
      });

      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
          stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
        });
      }
      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/backtest/history/groups
   * Get backtest runs grouped by symbol
   */
  fastify.get('/api/backtest/history/groups', async (
    request: FastifyRequest<{ Querystring: Record<string, string> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = request.query;
      const filters: HistoryFilters = {
        ...(query.strategy ? { strategy: query.strategy } : {}),
        ...(query.timeframe ? { timeframe: query.timeframe } : {}),
        ...(query.exchange ? { exchange: query.exchange } : {}),
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.minSharpe ? { minSharpe: parseFloat(query.minSharpe) } : {}),
        ...(query.minReturn ? { minReturn: parseFloat(query.minReturn) } : {}),
      };
      const groups = await getBacktestGroups(filters);
      return reply.status(200).send({ groups });
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Unknown error occurred' });
    }
  });

  /**
   * DELETE /api/backtest/history
   * Delete all backtest runs
   */
  fastify.delete('/api/backtest/history', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const count = await deleteAllBacktestRuns();
      return reply.status(200).send({
        message: `Deleted ${count} backtest run${count !== 1 ? 's' : ''}`,
        count,
      });
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Unknown error occurred' });
    }
  });

  /**
   * DELETE /api/backtest/:id
   * Delete a backtest run
   */
  fastify.delete('/api/backtest/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const deleted = await deleteBacktestRun(id);

      if (!deleted) {
        return reply.status(404).send({
          error: `Backtest with id "${id}" not found`,
        });
      }

      return reply.status(200).send({
        message: `Backtest "${id}" deleted successfully`,
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
   * POST /api/backtest/pairs/run
   * Execute a new pairs trading backtest
   */
  fastify.post('/api/backtest/pairs/run', async (
    request: FastifyRequest<{ Body: RunPairsBacktestRequest }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse request
      const parsed = RunPairsBacktestRequestSchema.parse(request.body);

      // Create pairs backtest config
      const config: PairsBacktestConfig = {
        id: uuidv4(),
        strategyName: parsed.strategyName,
        params: parsed.params,
        symbolA: parsed.symbolA,
        symbolB: parsed.symbolB,
        timeframe: parsed.timeframe,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        initialCapital: parsed.initialCapital,
        exchange: parsed.exchange,
        leverage: parsed.leverage,
      };

      // Run the pairs backtest and track duration
      const startTime = Date.now();
      const result = await runPairsBacktest(config);
      const duration = Date.now() - startTime;

      // Return result with duration
      return reply.status(200).send({
        ...result,
        duration,
      });
    } catch (error) {
      // Log full error with stack trace
      fastify.log.error({
        err: error,
        msg: 'Error in /api/backtest/pairs/run',
        stack: error instanceof Error ? error.stack : undefined,
      });

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
   * POST /api/backtest/multi/run
   * Execute a multi-asset backtest (runs funding-rate-spike independently on N assets)
   */
  fastify.post('/api/backtest/multi/run', async (
    request: FastifyRequest<{ Body: RunMultiBacktestRequest }>,
    reply: FastifyReply
  ) => {
    try {
      const parsed = RunMultiBacktestRequestSchema.parse(request.body);
      const { assets: assetsStr, startDate, endDate, initialCapital, exchange } = parsed;

      // Parse assets string into {symbol, timeframe}[]
      const assets: AssetConfig[] = [];
      const parts = assetsStr.split(',');
      for (const part of parts) {
        const [symbol, timeframe] = part.trim().split('@');
        if (!symbol || !timeframe) {
          return reply.status(400).send({
            error: `Invalid asset format: ${part}. Expected format: SYMBOL@TIMEFRAME`,
          });
        }
        assets.push({ symbol, timeframe: timeframe as Timeframe });
      }

      if (assets.length === 0) {
        return reply.status(400).send({
          error: 'At least one asset must be provided',
        });
      }

      const perAssetCapital = initialCapital / assets.length;
      const startTime = Date.now();

      // Run backtest for each asset independently
      const assetResults: AssetResult[] = [];

      for (const asset of assets) {
        try {
          const config = createBacktestConfig({
            strategyName: 'funding-rate-spike', // Use the underlying single-asset strategy
            symbol: asset.symbol,
            timeframe: asset.timeframe,
            startDate,
            endDate,
            initialCapital: perAssetCapital,
            exchange,
            params: {}, // Use default params (proven best in WF tests)
            mode: 'futures',
          });

          const result = await runBacktest(config, {
            enableLogging: false,
            saveResults: false, // Don't save individual runs
            skipFeeFetch: true,
            broker: {
              feeRate: 0.00055, // Bybit taker fee
              slippagePercent: 0,
            },
          });

          assetResults.push({
            symbol: asset.symbol,
            timeframe: asset.timeframe,
            metrics: result.metrics,
            trades: result.trades,
            equity: result.equity,
            fundingIncome: (result.metrics as any).totalFundingIncome ?? 0,
            tradingPnl: (result.metrics as any).tradingPnl ?? 0,
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          assetResults.push({
            symbol: asset.symbol,
            timeframe: asset.timeframe,
            metrics: {} as any,
            trades: [],
            equity: [],
            fundingIncome: 0,
            tradingPnl: 0,
            error: msg,
          });
        }
      }

      // Filter out errors for combining
      const validResults = assetResults.filter((r) => !r.error);

      if (validResults.length === 0) {
        return reply.status(500).send({
          error: 'All asset backtests failed',
          details: assetResults.map((r) => ({ symbol: r.symbol, error: r.error })),
        });
      }

      // Combine all trades and sort by timestamp
      const allTrades: Trade[] = [];
      for (const result of validResults) {
        allTrades.push(...result.trades);
      }
      allTrades.sort((a, b) => a.timestamp - b.timestamp);

      // Merge equity curves: collect all unique timestamps and sum equity
      const timestampSet = new Set<number>();
      for (const result of validResults) {
        for (const point of result.equity) {
          timestampSet.add(point.timestamp);
        }
      }
      const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

      // For each timestamp, sum equity from all assets (using last known equity for each)
      const equityValues: number[] = [];
      for (const ts of timestamps) {
        let totalEquity = 0;
        for (const result of validResults) {
          // Find the last equity point <= ts
          let lastEquity = result.metrics.initialCapital ?? 0;
          for (const point of result.equity) {
            if (point.timestamp <= ts) {
              lastEquity = point.equity;
            } else {
              break;
            }
          }
          totalEquity += lastEquity;
        }
        equityValues.push(totalEquity);
      }

      const combinedEquity = generateEquityCurve(timestamps, equityValues, initialCapital);

      // Determine dominant timeframe (most common)
      const timeframeCounts: Record<string, number> = {};
      for (const asset of assets) {
        timeframeCounts[asset.timeframe] = (timeframeCounts[asset.timeframe] ?? 0) + 1;
      }
      const dominantTimeframe = Object.entries(timeframeCounts).sort((a, b) => b[1] - a[1])[0][0] as Timeframe;

      // Calculate portfolio metrics
      const portfolioMetrics = calculateMetrics(allTrades, combinedEquity, initialCapital, dominantTimeframe);

      // Sum funding income and trading PnL
      const totalFundingIncome = validResults.reduce((sum, r) => sum + r.fundingIncome, 0);
      const totalTradingPnl = validResults.reduce((sum, r) => sum + r.tradingPnl, 0);

      // Build per-asset summary for storage
      const perAssetSummary = validResults.map((r) => ({
        symbol: r.symbol,
        timeframe: r.timeframe,
        sharpe: r.metrics.sharpeRatio,
        returnPct: r.metrics.totalReturnPercent,
        trades: r.metrics.totalTrades,
        fundingIncome: r.fundingIncome,
        tradingPnl: r.tradingPnl,
      }));

      // Create a BacktestResult for the portfolio
      const duration = Date.now() - startTime;
      const portfolioResult: BacktestResult = {
        id: `fr-spike-aggr-${Date.now()}`,
        config: {
          id: `fr-spike-aggr-config-${Date.now()}`,
          strategyName: 'fr-spike-aggr',
          symbol: 'MULTI',
          timeframe: dominantTimeframe,
          startDate,
          endDate,
          initialCapital,
          exchange,
          params: {
            assets: assetsStr,
            perAssetCapital,
            assetCount: assets.length,
            perAssetSummary,
          },
          mode: 'futures',
        },
        trades: allTrades,
        equity: combinedEquity,
        metrics: {
          ...portfolioMetrics,
          totalFundingIncome,
          tradingPnl: totalTradingPnl,
        } as any,
        rollingMetrics: {
          timestamps: [],
          cumulativeReturn: [],
          drawdown: [],
          rollingSharpe: [],
          cumulativeWinRate: [],
          cumulativeProfitFactor: [],
        },
        createdAt: Date.now(),
      };

      // Save the combined result to DB
      await saveBacktestRun(portfolioResult);

      // Return result (candles empty since multi-asset views load per-asset candles)
      return reply.status(200).send({
        ...portfolioResult,
        candles: [], // Empty - frontend loads candles per-asset via /api/candles
        duration,
      });
    } catch (error) {
      fastify.log.error({
        err: error,
        msg: 'Error in /api/backtest/multi/run',
        stack: error instanceof Error ? error.stack : undefined,
      });

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
}
