/**
 * Types and Zod schemas for backtest config export/import
 */

import { z } from 'zod';

// ============================================================================
// TypeScript Interfaces (for type-safe usage throughout the codebase)
// ============================================================================

export interface SingleStrategyExport {
  type: 'single';
  strategyName: string;
  params: Record<string, unknown>;
  symbol: string;
  timeframe: string;
  startDate: string; // ISO date string for portability
  endDate: string;
  initialCapital: number;
  exchange: string;
  mode?: 'spot' | 'futures';
  originalRunId?: string;
  originalMetrics?: {
    sharpeRatio: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
  };
}

export interface AggregationExport {
  type: 'aggregation';
  name?: string; // aggregation config name if from saved config
  subStrategies: Array<{
    strategyName: string;
    symbol: string;
    timeframe: string;
    params: Record<string, unknown>;
    exchange?: string;
  }>;
  allocationMode: string;
  maxPositions: number;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange: string;
  mode?: 'spot' | 'futures';
  feeRate?: number;
  slippagePercent?: number;
  originalRunId?: string;
  originalMetrics?: {
    sharpeRatio: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
  };
}

export interface PairsExport {
  type: 'pairs';
  strategyName: string;
  params: Record<string, unknown>;
  symbolA: string;
  symbolB: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange: string;
  originalRunId?: string;
  originalMetrics?: {
    sharpeRatio: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
  };
}

export type ExportedConfig = SingleStrategyExport | AggregationExport | PairsExport;

export interface BacktestConfigExportFile {
  version: 1;
  exportedAt: string; // ISO timestamp
  environment?: string;
  configs: ExportedConfig[];
}

// ============================================================================
// Zod Schemas (for runtime validation on import)
// ============================================================================

const OriginalMetricsSchema = z.object({
  sharpeRatio: z.number(),
  totalReturnPercent: z.number(),
  maxDrawdownPercent: z.number(),
});

export const SingleStrategyExportSchema = z.object({
  type: z.literal('single'),
  strategyName: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  symbol: z.string(),
  timeframe: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.number().positive(),
  exchange: z.string(),
  mode: z.enum(['spot', 'futures']).optional(),
  originalRunId: z.string().optional(),
  originalMetrics: OriginalMetricsSchema.optional(),
});

const SubStrategyExportSchema = z.object({
  strategyName: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  exchange: z.string().optional(),
});

export const AggregationExportSchema = z.object({
  type: z.literal('aggregation'),
  name: z.string().optional(),
  subStrategies: z.array(SubStrategyExportSchema),
  allocationMode: z.string(),
  maxPositions: z.number().int().positive(),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.number().positive(),
  exchange: z.string(),
  mode: z.enum(['spot', 'futures']).optional(),
  feeRate: z.number().optional(),
  slippagePercent: z.number().optional(),
  originalRunId: z.string().optional(),
  originalMetrics: OriginalMetricsSchema.optional(),
});

export const PairsExportSchema = z.object({
  type: z.literal('pairs'),
  strategyName: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  symbolA: z.string(),
  symbolB: z.string(),
  timeframe: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.number().positive(),
  exchange: z.string(),
  originalRunId: z.string().optional(),
  originalMetrics: OriginalMetricsSchema.optional(),
});

export const ExportedConfigSchema = z.discriminatedUnion('type', [
  SingleStrategyExportSchema,
  AggregationExportSchema,
  PairsExportSchema,
]);

export const BacktestConfigExportFileSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  environment: z.string().optional(),
  configs: z.array(ExportedConfigSchema),
});
