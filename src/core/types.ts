/**
 * Core type definitions for the backtesting system
 */

import { z } from 'zod';

// ============================================================================
// Timeframe
// ============================================================================

export const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

// ============================================================================
// Candle (OHLCV)
// ============================================================================

export const CandleSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export type Candle = z.infer<typeof CandleSchema>;

// ============================================================================
// Order Types
// ============================================================================

export const OrderSideSchema = z.enum(['buy', 'sell']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

export const OrderTypeSchema = z.enum(['market', 'limit']);
export type OrderType = z.infer<typeof OrderTypeSchema>;

export const OrderStatusSchema = z.enum(['pending', 'filled', 'cancelled']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: OrderSideSchema,
  type: OrderTypeSchema,
  amount: z.number().positive(),
  price: z.number().positive().optional(),
  status: OrderStatusSchema,
  createdAt: z.number(),
  filledAt: z.number().optional(),
  filledPrice: z.number().positive().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

// ============================================================================
// Trade Action Types
// ============================================================================

export const TradeActionSchema = z.enum([
  'OPEN_LONG',
  'CLOSE_LONG',
  'OPEN_SHORT',
  'CLOSE_SHORT',
]);
export type TradeAction = z.infer<typeof TradeActionSchema>;

// ============================================================================
// Trade (Event-Based)
// ============================================================================

export const TradeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  action: TradeActionSchema,
  price: z.number().positive(),
  amount: z.number().positive(),
  timestamp: z.number(),

  // Only for close trades
  pnl: z.number().optional(),
  pnlPercent: z.number().optional(),
  closedPositionId: z.string().optional(), // References the open trade

  // Balance tracking
  balanceAfter: z.number(),
});

export type Trade = z.infer<typeof TradeSchema>;

// ============================================================================
// Position Side
// ============================================================================

export const PositionSideSchema = z.enum(['long', 'short']);
export type PositionSide = z.infer<typeof PositionSideSchema>;

// ============================================================================
// Position (Open)
// ============================================================================

export const PositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: PositionSideSchema,
  amount: z.number().positive(),
  entryPrice: z.number().positive(),
  entryTime: z.number(),
  unrealizedPnl: z.number(),
});

export type Position = z.infer<typeof PositionSchema>;

// ============================================================================
// Equity Point
// ============================================================================

export const EquityPointSchema = z.object({
  timestamp: z.number(),
  equity: z.number(),
  drawdown: z.number(),
});

export type EquityPoint = z.infer<typeof EquityPointSchema>;

// ============================================================================
// Backtest Configuration
// ============================================================================

export const BacktestConfigSchema = z.object({
  id: z.string(),
  strategyName: z.string(),
  params: z.record(z.string(), z.unknown()),
  symbol: z.string(),
  timeframe: TimeframeSchema,
  startDate: z.number(),
  endDate: z.number(),
  initialCapital: z.number().positive(),
  exchange: z.string(),
});

export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;

// ============================================================================
// Performance Metrics
// ============================================================================

export const PerformanceMetricsSchema = z.object({
  totalReturn: z.number(),
  totalReturnPercent: z.number(),
  maxDrawdown: z.number(),
  maxDrawdownPercent: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  avgWin: z.number(),
  avgLoss: z.number(),
  avgWinPercent: z.number(),
  avgLossPercent: z.number(),
  expectancy: z.number(),
  expectancyPercent: z.number(),
  largestWin: z.number(),
  largestLoss: z.number(),
  avgTradeDuration: z.number(),
  exposureTime: z.number(),
});

export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

// ============================================================================
// Backtest Result
// ============================================================================

export const BacktestResultSchema = z.object({
  id: z.string(),
  config: BacktestConfigSchema,
  trades: z.array(TradeSchema),
  equity: z.array(EquityPointSchema),
  metrics: PerformanceMetricsSchema,
  createdAt: z.number(),
});

export type BacktestResult = z.infer<typeof BacktestResultSchema>;

// ============================================================================
// Utility functions for timeframe conversion
// ============================================================================

/**
 * Convert timeframe string to milliseconds
 */
export function timeframeToMs(timeframe: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
  };
  return map[timeframe];
}

/**
 * Convert timeframe to CCXT format
 */
export function timeframeToCCXT(timeframe: Timeframe): string {
  // CCXT uses the same format for most exchanges
  return timeframe;
}
