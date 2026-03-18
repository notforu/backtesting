/**
 * Trading Connector Interface
 *
 * Unified interface for executing trades across different backends:
 * - PaperConnector: simulated trading (existing paper trading logic)
 * - BybitConnector: real trading via Bybit API (future)
 *
 * The strategy/engine doesn't know which connector it's using.
 */

// ============================================================================
// Connector configuration
// ============================================================================

export type ConnectorType = 'paper' | 'bybit' | 'bybit-testnet';

export interface ConnectorConfig {
  type: ConnectorType;
  // Paper-specific
  initialCapital?: number;
  slippagePct?: number;
  feePct?: number;
  // Bybit-specific
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
}

// ============================================================================
// Order types
// ============================================================================

export interface OrderRequest {
  symbol: string;
  direction: 'long' | 'short';
  size: number;          // In base currency units
  type: 'market';        // Start with market orders only
  reduceOnly?: boolean;  // For closing positions
}

export interface OrderResult {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  side: 'buy' | 'sell';
  price: number;         // Actual fill price
  amount: number;        // Actual fill amount
  fee: number;           // Fee paid
  timestamp: number;
  status: 'filled' | 'rejected' | 'error';
  error?: string;
}

// ============================================================================
// Position and balance
// ============================================================================

export interface ConnectorPosition {
  symbol: string;
  direction: 'long' | 'short';
  amount: number;
  entryPrice: number;
  unrealizedPnl: number;
  openedAt: number;
}

export interface ConnectorBalance {
  total: number;         // Total equity
  available: number;     // Available for new trades
  unrealizedPnl: number;
}

// ============================================================================
// Connector event map
// ============================================================================

export interface ConnectorEventMap {
  trade: (result: OrderResult) => void;
  error: (error: Error) => void;
  disconnect: () => void;
}

// ============================================================================
// IConnector — the unified interface
// ============================================================================

export interface IConnector {
  readonly type: ConnectorType;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Trading
  openLong(symbol: string, amount: number): Promise<OrderResult>;
  openShort(symbol: string, amount: number): Promise<OrderResult>;
  closeLong(symbol: string, amount: number): Promise<OrderResult>;
  closeShort(symbol: string, amount: number): Promise<OrderResult>;
  /** Close all open positions — used by the kill switch. */
  closeAllPositions(): Promise<OrderResult[]>;

  // State
  getPositions(): Promise<ConnectorPosition[]>;
  getPosition(symbol: string): Promise<ConnectorPosition | null>;
  getBalance(): Promise<ConnectorBalance>;

  // Events
  on(event: 'trade', handler: (result: OrderResult) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'disconnect', handler: () => void): void;
}
