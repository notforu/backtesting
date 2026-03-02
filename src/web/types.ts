/**
 * Frontend type definitions for the backtesting platform.
 * These mirror the backend types to ensure type safety across the stack.
 */

// ============================================================================
// Core Data Types
// ============================================================================

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledAmount: number;
  filledPrice?: number;
  createdAt: number;
  filledAt?: number;
}

// ============================================================================
// Trade Action Types
// ============================================================================

export type TradeAction = 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT';

// ============================================================================
// Position Types
// ============================================================================

export type PositionSide = 'long' | 'short';

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  amount: number;
  entryPrice: number;
  entryTime: number;
  unrealizedPnl: number;
}

// ============================================================================
// Trade Types (Event-Based)
// ============================================================================

export interface Trade {
  id: string;
  symbol: string;
  action: TradeAction;
  price: number;
  amount: number;
  timestamp: number;

  // Only for close trades
  pnl?: number;
  pnlPercent?: number;
  closedPositionId?: string;

  // Balance tracking
  balanceAfter: number;

  // Fee information
  fee?: number;      // Fee amount in quote currency
  feeRate?: number;  // Fee rate as decimal (e.g., 0.001 = 0.1%)

  // Slippage information
  slippage?: number; // Slippage cost in quote currency

  // Funding rate at trade time (futures mode only)
  fundingRate?: number;

  // Funding income accumulated during position (futures mode, close trades only)
  fundingIncome?: number;
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown: number;
  drawdownPercent?: number;
}

export interface RollingMetrics {
  timestamps: number[];
  cumulativeReturn: number[];
  drawdown: number[];
  rollingSharpe: number[];
  cumulativeWinRate: number[];
  cumulativeProfitFactor: number[];
}

// ============================================================================
// Strategy Types
// ============================================================================

export type StrategyParamType = 'number' | 'string' | 'boolean' | 'select';

export interface StrategyParam {
  name: string;
  label: string;
  type: StrategyParamType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[] | Array<{ value: string | number; label: string }>;
  description?: string;
}

export interface StrategyInfo {
  name: string;
  description: string;
  version: string;
  isPairs?: boolean;
}

export interface StrategyDetails extends StrategyInfo {
  params: StrategyParam[];
  sourceFile: string;
  isPairs?: boolean;
}

// ============================================================================
// Backtest Configuration & Results
// ============================================================================

export interface BacktestConfig {
  strategyName: string;
  params: Record<string, unknown>;
  symbol: string;
  timeframe: Timeframe;
  startDate: string | number; // ISO date string or timestamp
  endDate: string | number;   // ISO date string or timestamp
  initialCapital: number;
  exchange: string;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  avgWinPercent: number;
  avgLossPercent: number;
  expectancy: number;
  expectancyPercent: number;
  largestWin: number;
  largestLoss: number;
  avgTradeDuration: number;
  exposureTime: number;
  totalFees: number;
  totalSlippage?: number;

  // Futures mode: breakdown of returns by source
  totalFundingIncome?: number;
  tradingPnl?: number;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  trades: Trade[];
  metrics: PerformanceMetrics;
  equity: EquityPoint[];
  rollingMetrics?: RollingMetrics;
  candles: Candle[];
  createdAt: number; // timestamp
  duration: number; // backtest execution time in ms
}

export interface BacktestSummary {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  totalReturnPercent: number;
  sharpeRatio: number;
  runAt: string;
  // Extended fields (optional for backward compatibility with old runs)
  exchange?: string;
  startDate?: number;
  endDate?: number;
  params?: Record<string, unknown>;
  maxDrawdownPercent?: number;
  winRate?: number;
  profitFactor?: number;
  totalTrades?: number;
  totalFees?: number;
  mode?: 'spot' | 'futures';
  aggregationId?: string;
  aggregationName?: string;
}

export interface PaginatedHistory {
  results: BacktestSummary[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CandleRequest {
  exchange: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
}

export interface RunBacktestRequest {
  strategyName: string;
  params: Record<string, unknown>;
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange?: string;
  mode?: 'spot' | 'futures';
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ============================================================================
// Optimization Types
// ============================================================================

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export interface OptimizationRequest {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: string | number;
  endDate: string | number;
  initialCapital?: number;
  exchange?: string;
  paramRanges?: Record<string, ParamRange>;
  optimizeFor?: 'sharpeRatio' | 'totalReturnPercent' | 'profitFactor' | 'winRate' | 'sortinoRatio' | 'maxDrawdownPercent' | 'composite';
  minTrades?: number;
  maxCombinations?: number;
  batchSize?: number;
  saveAllRuns?: boolean;
  mode?: 'spot' | 'futures';
  symbols?: string[];
  timeframes?: string[];
}

export interface OptimizationResult {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  bestParams: Record<string, unknown>;
  bestMetrics: PerformanceMetrics;
  totalCombinations: number;
  testedCombinations: number;
  optimizedAt: number;
  startDate?: number;
  endDate?: number;
  allResults?: Array<{
    params: Record<string, unknown>;
    metrics: PerformanceMetrics;
  }>;
}

// ============================================================================
// Pairs Trading Types
// ============================================================================

export interface SpreadDataPoint {
  timestamp: number;
  spread: number;
  zScore: number;
}

export interface PairsBacktestConfig {
  strategyName: string;
  params: Record<string, unknown>;
  symbolA: string;
  symbolB: string;
  timeframe: Timeframe;
  startDate: string | number;
  endDate: string | number;
  initialCapital: number;
  exchange: string;
  leverage: number;
}

export interface PairsBacktestResult {
  id: string;
  config: PairsBacktestConfig;
  trades: Trade[];
  metrics: PerformanceMetrics;
  equity: EquityPoint[];
  rollingMetrics?: RollingMetrics;
  candlesA: Candle[];
  candlesB: Candle[];
  spreadData: SpreadDataPoint[];
  createdAt: number;
  duration: number;
}

export interface RunPairsBacktestRequest {
  strategyName: string;
  params: Record<string, unknown>;
  symbolA: string;
  symbolB: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange?: string;
  leverage?: number;
}

export interface SubStrategyConfig {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  params?: Record<string, unknown>;
  exchange?: string;
}

export type AllocationMode = 'single_strongest' | 'weighted_multi' | 'top_n';

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

export interface AggregateBacktestResult extends BacktestResult {
  perAssetResults?: Record<string, PerAssetResult>;
  signalHistory?: Array<{
    symbol: string;
    direction: 'long' | 'short' | 'flat';
    weight: number;
    strategyName: string;
    timestamp: number;
  }>;
}

// ============================================================================
// Aggregation Types (First-Class Entity)
// ============================================================================

export interface AggregationConfig {
  id: string;
  name: string;
  allocationMode: AllocationMode;
  maxPositions: number;
  subStrategies: SubStrategyConfig[];
  initialCapital: number;
  exchange: string;
  mode: 'spot' | 'futures';
  createdAt: number;
  updatedAt: number;
}

export interface CreateAggregationRequest {
  name: string;
  allocationMode?: AllocationMode;
  maxPositions?: number;
  subStrategies: SubStrategyConfig[];
  initialCapital?: number;
  exchange?: string;
  mode?: 'spot' | 'futures';
}

export interface UpdateAggregationRequest {
  name?: string;
  allocationMode?: AllocationMode;
  maxPositions?: number;
  subStrategies?: SubStrategyConfig[];
  initialCapital?: number;
  exchange?: string;
  mode?: 'spot' | 'futures';
}

export interface RunAggregationRequest {
  startDate: string | number;
  endDate: string | number;
  initialCapital?: number;  // Override saved default
}

// ============================================================================
// UI State Types
// ============================================================================

export interface ChartMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text?: string;
}

// ============================================================================
// Scanner Types
// ============================================================================

export interface ScanRequest {
  strategy: string;
  symbols: string[];
  timeframe: string;
  from: string;
  to: string;
  slippage?: number;
  initialCapital?: number;
  params?: Record<string, unknown>;
}

export interface ScanResultMetrics {
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
}

export interface ScanResultRow {
  symbol: string;
  metrics: ScanResultMetrics;
  tradesCount: number;
  status: 'complete' | 'error';
  error?: string;
}

export interface ScanSummary {
  total: number;
  profitable: number;
  avgSharpe: number;
  avgReturn: number;
}

export interface ActivePolymarketMarket {
  slug: string;
  question: string;
  volume: number;
  category: string;
}

// ============================================================================
// Trade Display Helpers
// ============================================================================

/**
 * Check if a trade is an open action
 */
export function isOpenTrade(trade: Trade): boolean {
  return trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT';
}

/**
 * Check if a trade is a close action
 */
export function isCloseTrade(trade: Trade): boolean {
  return trade.action === 'CLOSE_LONG' || trade.action === 'CLOSE_SHORT';
}

/**
 * Get display label for trade action with arrow indicator
 * LONG = arrow up, SHORT = arrow down
 */
export function getTradeActionLabel(action: TradeAction): string {
  const labels: Record<TradeAction, string> = {
    'OPEN_LONG': 'Open Long ↑',
    'CLOSE_LONG': 'Close Long ↑',
    'OPEN_SHORT': 'Open Short ↓',
    'CLOSE_SHORT': 'Close Short ↓',
  };
  return labels[action];
}

/**
 * Get badge color class for trade action
 * OPEN = Green (entering a position)
 * CLOSE = Red (exiting a position)
 */
export function getTradeActionColor(action: TradeAction): string {
  switch (action) {
    case 'OPEN_LONG':
    case 'OPEN_SHORT':
      return 'bg-green-900/50 text-green-400';
    case 'CLOSE_LONG':
    case 'CLOSE_SHORT':
      return 'bg-red-900/50 text-red-400';
  }
}

// ============================================================================
// Paper Trading Types
// ============================================================================

export interface PaperSession {
  id: string;
  name: string;
  aggregationConfig: AggregationConfig;
  aggregationConfigId: string | null;
  status: 'running' | 'paused' | 'stopped' | 'error';
  initialCapital: number;
  currentEquity: number;
  currentCash: number;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  userId?: string;
}

export interface PaperPosition {
  id: number;
  sessionId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  amount: number;
  entryTime: number;
  unrealizedPnl: number;
  fundingAccumulated: number;
}

export interface PaperTrade {
  id: number;
  sessionId: string;
  symbol: string;
  action: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  price: number;
  amount: number;
  timestamp: number;
  pnl: number | null;
  pnlPercent: number | null;
  fee: number;
  fundingIncome: number;
  balanceAfter: number;
}

export interface PaperEquitySnapshot {
  id: number;
  sessionId: string;
  timestamp: number;
  equity: number;
  cash: number;
  positionsValue: number;
}

export interface PaperSessionDetail extends PaperSession {
  positions: PaperPosition[];
}

export interface PaperTradesResponse {
  trades: PaperTrade[];
  total: number;
}

export type PaperTradingEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'trade_opened'; sessionId: string; trade: PaperTrade }
  | { type: 'trade_closed'; sessionId: string; trade: PaperTrade }
  | { type: 'funding_payment'; sessionId: string; symbol: string; amount: number; equity: number }
  | { type: 'equity_update'; sessionId: string; equity: number; cash: number; positionsValue: number; timestamp: number }
  | { type: 'tick_complete'; sessionId: string; tickNumber: number; timestamp: number; nextTickAt: number | null }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'status_change'; sessionId: string; oldStatus: string; newStatus: string };

export interface SimpleStrategyConfig {
  strategyName: string;
  symbol: string;
  timeframe: string;
  exchange: string;
  params: Record<string, unknown>;
  mode?: 'spot' | 'futures';
}

export interface CreatePaperSessionRequest {
  name: string;
  aggregationConfigId?: string;
  strategyConfig?: SimpleStrategyConfig;
  backtestRunId?: string;
  initialCapital?: number;
}

export interface PaperSessionEvent {
  id: number;
  sessionId: string;
  type: string;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: number;
}

export interface PaperSessionEventsResponse {
  events: PaperSessionEvent[];
  total: number;
  limit: number;
  offset: number;
}
