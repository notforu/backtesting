/**
 * Config export/import logic
 * Handles converting DB rows to ExportedConfig and building/parsing export files
 */

import type { BacktestConfigExportFile, ExportedConfig } from './config-export-types.js';
import { BacktestConfigExportFileSchema } from './config-export-types.js';

// ============================================================================
// Row type for joined DB query
// ============================================================================

export interface BacktestRunExportRow {
  id: string;
  config: unknown;
  metrics: unknown;
  aggregation_id?: string | null;
  // From LEFT JOIN to aggregation_configs:
  agg_name?: string | null;
  agg_allocation_mode?: string | null;
  agg_max_positions?: number | null;
  agg_sub_strategies?: unknown;
  agg_exchange?: string | null;
  agg_mode?: string | null;
}

// ============================================================================
// Extract ExportedConfig from a DB row
// ============================================================================

/**
 * Extract an ExportedConfig from a DB backtest_runs row (with optional
 * LEFT JOIN aggregation_configs columns).
 */
export function extractExportConfig(row: BacktestRunExportRow): ExportedConfig {
  const config = typeof row.config === 'string'
    ? JSON.parse(row.config)
    : (row.config as Record<string, unknown>);

  const metrics = typeof row.metrics === 'string'
    ? JSON.parse(row.metrics)
    : (row.metrics as Record<string, unknown>);

  const originalMetrics = {
    sharpeRatio: (metrics.sharpeRatio as number) ?? 0,
    totalReturnPercent: (metrics.totalReturnPercent as number) ?? 0,
    maxDrawdownPercent: (metrics.maxDrawdownPercent as number) ?? 0,
  };

  // Detect aggregation: has aggregation_id OR symbol is MULTI with subStrategies in params
  if (row.aggregation_id || (config.symbol === 'MULTI' && (config.params as Record<string, unknown>)?.subStrategies)) {
    const rawSubStrategies = row.agg_sub_strategies
      ? (typeof row.agg_sub_strategies === 'string'
        ? JSON.parse(row.agg_sub_strategies)
        : row.agg_sub_strategies)
      : (config.params as Record<string, unknown>)?.subStrategies ?? [];

    const subStrategies = (rawSubStrategies as Array<Record<string, unknown>>).map((s) => ({
      strategyName: s.strategyName as string,
      symbol: s.symbol as string,
      timeframe: s.timeframe as string,
      params: (s.params as Record<string, unknown>) ?? {},
      exchange: s.exchange as string | undefined,
    }));

    const params = (config.params as Record<string, unknown>) ?? {};

    return {
      type: 'aggregation',
      name: row.agg_name ?? (params.aggregationName as string | undefined) ?? undefined,
      subStrategies,
      allocationMode: row.agg_allocation_mode ?? (params.allocationMode as string) ?? 'single_strongest',
      maxPositions: row.agg_max_positions ?? (params.maxPositions as number) ?? 3,
      startDate: new Date(config.startDate as number).toISOString(),
      endDate: new Date(config.endDate as number).toISOString(),
      initialCapital: (config.initialCapital as number) ?? 10000,
      exchange: row.agg_exchange ?? (config.exchange as string) ?? 'bybit',
      mode: (row.agg_mode as 'spot' | 'futures' | undefined) ?? (config.mode as 'spot' | 'futures' | undefined),
      feeRate: params.feeRate as number | undefined,
      slippagePercent: params.slippagePercent as number | undefined,
      originalRunId: row.id,
      originalMetrics,
    };
  }

  // Default: single strategy
  return {
    type: 'single',
    strategyName: config.strategyName as string,
    params: (config.params as Record<string, unknown>) ?? {},
    symbol: config.symbol as string,
    timeframe: (config.timeframe as string) ?? '1h',
    startDate: new Date(config.startDate as number).toISOString(),
    endDate: new Date(config.endDate as number).toISOString(),
    initialCapital: (config.initialCapital as number) ?? 10000,
    exchange: (config.exchange as string) ?? 'binance',
    mode: config.mode as 'spot' | 'futures' | undefined,
    originalRunId: row.id,
    originalMetrics,
  };
}

// ============================================================================
// Build export file
// ============================================================================

export function buildExportFile(
  configs: ExportedConfig[],
  environment?: string
): BacktestConfigExportFile {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    environment,
    configs,
  };
}

// ============================================================================
// Parse and validate an import file
// ============================================================================

export function parseImportFile(data: unknown): BacktestConfigExportFile {
  return BacktestConfigExportFileSchema.parse(data);
}
