/**
 * Config Export/Import API Routes
 *
 * POST /api/configs/export  — Export backtest run configs by ID as a JSON file
 * POST /api/configs/import  — Validate and optionally re-run imported configs
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getBacktestRunsByIds, saveBacktestRun } from '../../data/db.js';
import { extractExportConfig, buildExportFile, parseImportFile } from '../../core/config-export.js';
import type { ExportedConfig } from '../../core/config-export-types.js';
import { runBacktest } from '../../core/engine.js';
import { runAggregateBacktest } from '../../core/aggregate-engine.js';
import type { Timeframe } from '../../core/types.js';
import type { AllocationMode } from '../../core/signal-types.js';

// ============================================================================
// Request Schemas
// ============================================================================

const ExportRequestSchema = z.object({
  runIds: z.array(z.string()).min(1),
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run a single exported config and return the resulting run ID.
 */
async function executeConfig(config: ExportedConfig): Promise<string> {
  if (config.type === 'single') {
    const result = await runBacktest({
      id: uuidv4(),
      strategyName: config.strategyName,
      params: config.params,
      symbol: config.symbol,
      timeframe: config.timeframe as Timeframe,
      startDate: new Date(config.startDate).getTime(),
      endDate: new Date(config.endDate).getTime(),
      initialCapital: config.initialCapital,
      exchange: config.exchange,
      mode: config.mode,
    });
    await saveBacktestRun(result);
    return result.id;
  }

  if (config.type === 'aggregation') {
    const result = await runAggregateBacktest({
      subStrategies: config.subStrategies.map((s) => ({
        strategyName: s.strategyName,
        symbol: s.symbol,
        timeframe: s.timeframe as Timeframe,
        params: s.params,
        exchange: s.exchange ?? config.exchange,
      })),
      allocationMode: config.allocationMode as AllocationMode,
      maxPositions: config.maxPositions,
      initialCapital: config.initialCapital,
      startDate: new Date(config.startDate).getTime(),
      endDate: new Date(config.endDate).getTime(),
      exchange: config.exchange,
      mode: config.mode,
      feeRate: config.feeRate,
      slippagePercent: config.slippagePercent,
    });
    // runAggregateBacktest calls saveBacktestRun internally (saveResults=true by default)
    return result.id;
  }

  throw new Error(`Unknown config type: ${(config as ExportedConfig).type}`);
}

// ============================================================================
// Route Registration
// ============================================================================

export async function configExportRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/configs/export
   * Body: { runIds: string[] }
   * Returns: BacktestConfigExportFile as a downloadable JSON attachment
   */
  fastify.post(
    '/api/configs/export',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { runIds } = ExportRequestSchema.parse(request.body);
        const rows = await getBacktestRunsByIds(runIds);

        if (rows.length === 0) {
          return reply.status(404).send({ message: 'No backtest runs found for the provided IDs' });
        }

        const configs = rows.map(extractExportConfig);
        const exportFile = buildExportFile(configs);
        const filename = `backtest-configs-${new Date().toISOString().slice(0, 10)}.json`;

        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(exportFile);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ message: 'Invalid request', errors: error.issues });
        }
        throw error;
      }
    }
  );

  /**
   * POST /api/configs/import
   * Body: { file: BacktestConfigExportFile, rerun?: boolean }
   *
   * When rerun=false (default): validates the file and returns a summary.
   * When rerun=true: executes each config and returns run results.
   */
  fastify.post(
    '/api/configs/import',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as Record<string, unknown>;
        const rerun = body.rerun === true;

        // Parse and validate the import file
        const importFile = parseImportFile(body.file);

        if (!rerun) {
          // Dry run — return summary without running anything
          const summary = importFile.configs.map((c, i) => {
            let strategy: string;
            let symbols: string;

            if (c.type === 'aggregation') {
              strategy = c.name ?? 'Unnamed Aggregation';
              symbols = c.subStrategies.map((s) => s.symbol).join(', ');
            } else {
              strategy = c.strategyName;
              symbols = c.symbol;
            }

            const timeframe = c.type === 'aggregation'
              ? [...new Set(c.subStrategies.map((s) => s.timeframe))].join(', ')
              : c.timeframe;

            return {
              index: i,
              type: c.type,
              strategy,
              symbols,
              timeframe,
              originalMetrics: c.originalMetrics,
            };
          });

          return reply.send({
            validated: true,
            configs: summary,
            total: summary.length,
          });
        }

        // Actually run each config sequentially
        const results: Array<{
          index: number;
          type: string;
          status: 'success' | 'error';
          runId?: string;
          error?: string;
        }> = [];

        for (let i = 0; i < importFile.configs.length; i++) {
          const config = importFile.configs[i];
          try {
            const runId = await executeConfig(config);
            results.push({ index: i, type: config.type, status: 'success', runId });
          } catch (error) {
            results.push({
              index: i,
              type: config.type,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return reply.send({
          results,
          total: results.length,
          succeeded: results.filter((r) => r.status === 'success').length,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ message: 'Invalid import file', errors: error.issues });
        }
        throw error;
      }
    }
  );
}
