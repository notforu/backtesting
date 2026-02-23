/**
 * Signal Aggregation Framework - Type Definitions
 */

import type { Candle, Trade, EquityPoint, PerformanceMetrics, RollingMetrics, Timeframe, BacktestResult } from './types.js';

/** Direction of a trading signal */
export type SignalDirection = 'long' | 'short' | 'flat';

/** A trading signal emitted by a sub-strategy */
export interface Signal {
  symbol: string;
  direction: SignalDirection;
  weight: number; // 0-1, strength of signal
  strategyName: string;
  timestamp: number;
}

/** Interface for anything that provides trading signals */
export interface SignalProvider {
  /** Unique key for this provider (e.g., "funding-rate-spike:BTC/USDT:USDT:4h") */
  key: string;
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;

  /** Initialize with candles and funding rates */
  init(candles: Candle[], fundingRates?: import('./types.js').FundingRate[]): void;

  /** Get signal for a specific bar index */
  getSignal(barIndex: number): Signal | null;

  /** Check if this provider currently has an open position (in shadow) */
  isInPosition(): boolean;

  /** Check if the strategy wants to exit its current position */
  wantsExit(barIndex: number): boolean;

  /** Confirm that the engine executed the signal (update shadow state) */
  confirmExecution(direction: SignalDirection): void;

  /** Reset shadow state when engine closes position externally */
  resetShadow(): void;
}

/** How to allocate capital across signals */
export type AllocationMode = 'single_strongest' | 'weighted_multi' | 'top_n';

/** Configuration for a sub-strategy within the aggregate */
export interface SubStrategyConfig {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  params: Record<string, unknown>;
  exchange: string;
}

/** Configuration for running an aggregate backtest */
export interface AggregateBacktestConfig {
  subStrategies: SubStrategyConfig[];
  allocationMode: AllocationMode;
  maxPositions: number; // For top_n mode
  initialCapital: number;
  startDate: number; // Unix ms
  endDate: number; // Unix ms
  exchange: string;
  mode?: 'spot' | 'futures';
}

/** Per-asset result data */
export interface PerAssetResult {
  symbol: string;
  timeframe: string;
  trades: Trade[];
  equity: EquityPoint[];
  metrics: PerformanceMetrics;
  rollingMetrics?: RollingMetrics;
  fundingIncome: number;
  tradingPnl: number;
}

/** Result of an aggregate backtest */
export interface AggregateBacktestResult extends BacktestResult {
  perAssetResults: Record<string, PerAssetResult>; // keyed by symbol
  signalHistory: Signal[];
}

/** Interface for calculating signal weights */
export interface WeightCalculator {
  calculateWeight(context: WeightContext): number;
}

/** Context passed to weight calculators */
export interface WeightContext {
  currentFundingRate?: number;
  fundingRates?: import('./types.js').FundingRate[];
  currentPrice: number;
  barIndex: number;
  symbol: string;
}
