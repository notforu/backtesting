/**
 * PaperConnector
 *
 * Implements IConnector as a standalone simulated exchange.
 * Maintains its own cash balance and positions in-memory.
 * Designed for use by a trading loop that generates signals
 * and delegates execution to whichever connector is configured.
 *
 * Usage:
 *   const connector = new PaperConnector({ type: 'paper', initialCapital: 10_000, feePct: 0.1 });
 *   await connector.connect();
 *   connector.setPrice('BTC/USDT', 50_000);  // Called by the trading loop each tick
 *   const result = await connector.openLong('BTC/USDT', 0.1);
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IConnector,
  ConnectorType,
  ConnectorConfig,
  OrderResult,
  ConnectorPosition,
  ConnectorBalance,
} from './types.js';

// Internal position record (richer than ConnectorPosition)
interface InternalPosition {
  symbol: string;
  direction: 'long' | 'short';
  amount: number;
  entryPrice: number;
  openedAt: number;
}

// ============================================================================
// PaperConnector
// ============================================================================

export class PaperConnector implements IConnector {
  readonly type: ConnectorType = 'paper';

  private _connected: boolean = false;
  private _cash: number;
  private readonly _slippagePct: number;  // e.g. 0.1 = 0.1%
  private readonly _feePct: number;       // e.g. 0.1 = 0.1%

  /** Last known market price per symbol */
  private readonly _prices: Map<string, number> = new Map();

  /**
   * Open positions keyed by symbol.
   * A symbol may hold one long AND one short position simultaneously,
   * so we keep them in separate maps.
   */
  private readonly _longPositions: Map<string, InternalPosition> = new Map();
  private readonly _shortPositions: Map<string, InternalPosition> = new Map();

  /** Event handlers — keyed by event name */
  private readonly _handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  constructor(config: ConnectorConfig) {
    const initial = config.initialCapital ?? 0;
    if (initial <= 0) {
      throw new Error('PaperConnector: initialCapital must be a positive number');
    }
    this._cash = initial;
    this._slippagePct = config.slippagePct ?? 0;
    this._feePct = config.feePct ?? 0;
  }

  // --------------------------------------------------------------------------
  // Price feed (called by the trading loop each tick)
  // --------------------------------------------------------------------------

  /**
   * Set the current market price for a symbol.
   * Must be called before executing any trade on that symbol.
   */
  setPrice(symbol: string, price: number): void {
    if (price <= 0) {
      throw new Error(`PaperConnector.setPrice: price must be positive, got ${price}`);
    }
    this._prices.set(symbol, price);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._emit('disconnect');
  }

  isConnected(): boolean {
    return this._connected;
  }

  // --------------------------------------------------------------------------
  // Trading
  // --------------------------------------------------------------------------

  async openLong(symbol: string, amount: number): Promise<OrderResult> {
    if (!this._connected) {
      throw new Error('PaperConnector: not connected — call connect() first');
    }

    const price = this._prices.get(symbol);
    if (price === undefined) {
      return this._rejected(symbol, 'long', amount, `No price set for symbol "${symbol}"`);
    }

    // Apply slippage: buying pushes price up
    const fillPrice = price * (1 + this._slippagePct / 100);
    const notional = amount * fillPrice;
    const fee = notional * (this._feePct / 100);
    const totalCost = notional + fee;

    if (totalCost > this._cash) {
      return this._rejected(
        symbol,
        'long',
        amount,
        `Insufficient cash: need ${totalCost.toFixed(2)}, have ${this._cash.toFixed(2)}`,
      );
    }

    this._cash -= totalCost;

    const position: InternalPosition = {
      symbol,
      direction: 'long',
      amount,
      entryPrice: fillPrice,
      openedAt: Date.now(),
    };
    this._longPositions.set(symbol, position);

    const result = this._filled(symbol, 'long', 'buy', fillPrice, amount, fee);
    this._emit('trade', result);
    return result;
  }

  async openShort(symbol: string, amount: number): Promise<OrderResult> {
    if (!this._connected) {
      throw new Error('PaperConnector: not connected — call connect() first');
    }

    const price = this._prices.get(symbol);
    if (price === undefined) {
      return this._rejected(symbol, 'short', amount, `No price set for symbol "${symbol}"`);
    }

    // Apply slippage: selling pushes price down (worse fill for short open)
    const fillPrice = price * (1 - this._slippagePct / 100);
    const notional = amount * fillPrice;
    const fee = notional * (this._feePct / 100);

    // Margin model: only fee is deducted on open (the PnL settlement covers the rest)
    if (fee > this._cash) {
      return this._rejected(
        symbol,
        'short',
        amount,
        `Insufficient cash for fee: need ${fee.toFixed(2)}, have ${this._cash.toFixed(2)}`,
      );
    }

    this._cash -= fee;

    const position: InternalPosition = {
      symbol,
      direction: 'short',
      amount,
      entryPrice: fillPrice,
      openedAt: Date.now(),
    };
    this._shortPositions.set(symbol, position);

    const result = this._filled(symbol, 'short', 'sell', fillPrice, amount, fee);
    this._emit('trade', result);
    return result;
  }

  async closeLong(symbol: string, amount: number): Promise<OrderResult> {
    if (!this._connected) {
      throw new Error('PaperConnector: not connected — call connect() first');
    }

    const position = this._longPositions.get(symbol);
    if (!position) {
      return this._rejected(symbol, 'long', amount, `No long position open for "${symbol}"`);
    }

    const price = this._prices.get(symbol);
    if (price === undefined) {
      return this._rejected(symbol, 'long', amount, `No price set for symbol "${symbol}"`);
    }

    // Apply slippage: selling pushes price down (worse fill for close-long)
    const fillPrice = price * (1 - this._slippagePct / 100);
    const closeAmount = Math.min(amount, position.amount);
    const notional = closeAmount * fillPrice;
    const fee = notional * (this._feePct / 100);

    // Cash receives the sale proceeds minus fee
    this._cash += notional - fee;

    if (closeAmount >= position.amount) {
      this._longPositions.delete(symbol);
    } else {
      position.amount -= closeAmount;
    }

    const result = this._filled(symbol, 'long', 'sell', fillPrice, closeAmount, fee);
    this._emit('trade', result);
    return result;
  }

  async closeShort(symbol: string, amount: number): Promise<OrderResult> {
    if (!this._connected) {
      throw new Error('PaperConnector: not connected — call connect() first');
    }

    const position = this._shortPositions.get(symbol);
    if (!position) {
      return this._rejected(symbol, 'short', amount, `No short position open for "${symbol}"`);
    }

    const price = this._prices.get(symbol);
    if (price === undefined) {
      return this._rejected(symbol, 'short', amount, `No price set for symbol "${symbol}"`);
    }

    // Apply slippage: buying pushes price up (worse fill for close-short)
    const fillPrice = price * (1 + this._slippagePct / 100);
    const closeAmount = Math.min(amount, position.amount);
    const notional = closeAmount * fillPrice;
    const fee = notional * (this._feePct / 100);

    // Settle PnL: (entryPrice - fillPrice) * amount − fee
    const grossPnl = (position.entryPrice - fillPrice) * closeAmount;
    this._cash += grossPnl - fee;

    if (closeAmount >= position.amount) {
      this._shortPositions.delete(symbol);
    } else {
      position.amount -= closeAmount;
    }

    const result = this._filled(symbol, 'short', 'buy', fillPrice, closeAmount, fee);
    this._emit('trade', result);
    return result;
  }

  async closeAllPositions(): Promise<OrderResult[]> {
    const results: OrderResult[] = [];

    for (const [symbol, position] of this._longPositions.entries()) {
      const result = await this.closeLong(symbol, position.amount);
      results.push(result);
    }

    for (const [symbol, position] of this._shortPositions.entries()) {
      const result = await this.closeShort(symbol, position.amount);
      results.push(result);
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  async getPositions(): Promise<ConnectorPosition[]> {
    const positions: ConnectorPosition[] = [];

    for (const [symbol, pos] of this._longPositions.entries()) {
      positions.push(this._toConnectorPosition(symbol, pos));
    }

    for (const [symbol, pos] of this._shortPositions.entries()) {
      positions.push(this._toConnectorPosition(symbol, pos));
    }

    return positions;
  }

  async getPosition(symbol: string): Promise<ConnectorPosition | null> {
    const long = this._longPositions.get(symbol);
    if (long) return this._toConnectorPosition(symbol, long);

    const short = this._shortPositions.get(symbol);
    if (short) return this._toConnectorPosition(symbol, short);

    return null;
  }

  async getBalance(): Promise<ConnectorBalance> {
    let unrealizedPnl = 0;

    // Long positions: cash was spent to open them. Their mark-to-market value
    // (amount * currentPrice) must be added back to get total equity.
    let longMarkValue = 0;

    for (const [symbol, pos] of this._longPositions.entries()) {
      const price = this._prices.get(symbol) ?? pos.entryPrice;
      const pnl = (price - pos.entryPrice) * pos.amount;
      unrealizedPnl += pnl;
      // Mark value = what we could sell the position for right now
      longMarkValue += pos.amount * price;
    }

    // Short positions: only fee was deducted from cash on open; PnL is the
    // net gain/loss relative to entry. Add unrealized PnL to total.
    let shortUnrealizedPnl = 0;

    for (const [symbol, pos] of this._shortPositions.entries()) {
      const price = this._prices.get(symbol) ?? pos.entryPrice;
      const pnl = (pos.entryPrice - price) * pos.amount;
      unrealizedPnl += pnl;
      shortUnrealizedPnl += pnl;
    }

    return {
      available: this._cash,
      unrealizedPnl,
      total: this._cash + longMarkValue + shortUnrealizedPnl,
    };
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  on(event: 'trade', handler: (result: OrderResult) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'disconnect', handler: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    const existing = this._handlers.get(event) ?? [];
    existing.push(handler);
    this._handlers.set(event, existing);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _filled(
    symbol: string,
    direction: 'long' | 'short',
    side: 'buy' | 'sell',
    price: number,
    amount: number,
    fee: number,
  ): OrderResult {
    return {
      id: uuidv4(),
      symbol,
      direction,
      side,
      price,
      amount,
      fee,
      timestamp: Date.now(),
      status: 'filled',
    };
  }

  private _rejected(
    symbol: string,
    direction: 'long' | 'short',
    amount: number,
    error: string,
  ): OrderResult {
    return {
      id: uuidv4(),
      symbol,
      direction,
      side: direction === 'long' ? 'buy' : 'sell',
      price: 0,
      amount,
      fee: 0,
      timestamp: Date.now(),
      status: 'rejected',
      error,
    };
  }

  private _toConnectorPosition(symbol: string, pos: InternalPosition): ConnectorPosition {
    const price = this._prices.get(symbol) ?? pos.entryPrice;
    const unrealizedPnl =
      pos.direction === 'long'
        ? (price - pos.entryPrice) * pos.amount
        : (pos.entryPrice - price) * pos.amount;

    return {
      symbol,
      direction: pos.direction,
      amount: pos.amount,
      entryPrice: pos.entryPrice,
      unrealizedPnl,
      openedAt: pos.openedAt,
    };
  }

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(event);
    if (!handlers) return;
    for (const h of handlers) {
      h(...args);
    }
  }
}
