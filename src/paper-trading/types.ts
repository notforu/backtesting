/**
 * Paper Trading - Type Definitions
 *
 * Types for the paper trading system that runs aggregation configs
 * in real-time, simulating live execution without real capital.
 */

import type { AggregateBacktestConfig } from '../core/signal-types.js';

export interface PaperSession {
  id: string;
  name: string;
  aggregationConfig: AggregateBacktestConfig;  // frozen JSONB snapshot at creation time
  aggregationConfigId: string | null;
  strategyConfigId: string | null;  // FK to strategy_configs (single-asset sessions)
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
  userId?: string;  // owner of the session (optional for backward compat)
}

export interface PaperPosition {
  id: number;
  sessionId: string;
  symbol: string;
  direction: 'long' | 'short';
  /** Unique key for the sub-strategy that opened this position, e.g. "funding-rate-spike:BTC/USDT:4h" */
  subStrategyKey: string;
  entryPrice: number;
  amount: number;
  entryTime: number;
  unrealizedPnl: number;
  fundingAccumulated: number;
  /** Stop-loss price level, or null if not set */
  stopLoss: number | null;
  /** Take-profit price level, or null if not set */
  takeProfit: number | null;
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

// Event types emitted by the paper trading engine
export type PaperTradingEvent =
  | { type: 'trade_opened'; sessionId: string; trade: PaperTrade }
  | { type: 'trade_closed'; sessionId: string; trade: PaperTrade }
  | { type: 'funding_payment'; sessionId: string; symbol: string; amount: number; equity: number }
  | { type: 'equity_update'; sessionId: string; equity: number; cash: number; positionsValue: number; timestamp: number }
  | { type: 'tick_complete'; sessionId: string; tickNumber: number; timestamp: number; nextTickAt: number | null }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'status_change'; sessionId: string; oldStatus: string; newStatus: string }
  | { type: 'retry'; sessionId: string; retryCount: number; nextRetryAt: number; error: string }
  | { type: 'realtime_equity_update'; sessionId: string; equity: number; cash: number; positionsValue: number; markPrices: Record<string, number>; timestamp: number }
  | { type: 'trade_rejected'; sessionId: string; symbol: string; reason: string }
  | { type: 'kill_switch_triggered'; sessionId: string; reason: string; equity: number };

export interface TickResult {
  tickNumber: number;
  timestamp: number;
  tradesOpened: PaperTrade[];
  tradesClosed: PaperTrade[];
  fundingPayments: Array<{ symbol: string; amount: number }>;
  equity: number;
  cash: number;
  positionsValue: number;
  openPositions: PaperPosition[];
}
