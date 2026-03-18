/**
 * BybitConnector
 *
 * IConnector implementation that executes real trades on Bybit via CCXT.
 * Supports both live trading (type: 'bybit') and testnet (type: 'bybit-testnet').
 *
 * Usage:
 *   const connector = new BybitConnector({
 *     type: 'bybit',
 *     apiKey: 'YOUR_KEY',
 *     apiSecret: 'YOUR_SECRET',
 *   });
 *   await connector.connect();
 *   const result = await connector.openLong('BTC/USDT', 0.01);
 */

import ccxt, { type Exchange, type Position } from 'ccxt';
import { v4 as uuidv4 } from 'uuid';
import type {
  IConnector,
  ConnectorType,
  ConnectorConfig,
  OrderResult,
  ConnectorPosition,
  ConnectorBalance,
} from './types.js';

// ============================================================================
// BybitConnector
// ============================================================================

export class BybitConnector implements IConnector {
  readonly type: ConnectorType;

  private readonly exchange: Exchange;
  private connected = false;
  private readonly handlers: Map<string, Array<(...args: unknown[]) => void>> =
    new Map();

  constructor(config: ConnectorConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Bybit API key and secret are required');
    }

    this.type = config.type;

    const sandbox =
      config.type === 'bybit-testnet' || config.testnet === true;

    this.exchange = new ccxt.bybit({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      sandbox,
      options: { defaultType: 'swap' }, // perpetual futures
    });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.exchange.loadMarkets();
    // Verify credentials — will throw if API key/secret are invalid
    await this.exchange.fetchBalance({ type: 'swap' });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this._emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // --------------------------------------------------------------------------
  // Trading
  // --------------------------------------------------------------------------

  async openLong(symbol: string, amount: number): Promise<OrderResult> {
    this._assertConnected();
    try {
      const order = await this.exchange.createMarketBuyOrder(symbol, amount);
      const result = this._mapOrder(order, symbol, 'long', 'buy');
      this._emit('trade', result);
      return result;
    } catch (e) {
      return this._errorResult(symbol, 'long', 'buy', e);
    }
  }

  async openShort(symbol: string, amount: number): Promise<OrderResult> {
    this._assertConnected();
    try {
      const order = await this.exchange.createMarketSellOrder(symbol, amount);
      const result = this._mapOrder(order, symbol, 'short', 'sell');
      this._emit('trade', result);
      return result;
    } catch (e) {
      return this._errorResult(symbol, 'short', 'sell', e);
    }
  }

  async closeLong(symbol: string, amount: number): Promise<OrderResult> {
    // Close long = sell with reduceOnly
    this._assertConnected();
    try {
      const order = await this.exchange.createMarketSellOrder(
        symbol,
        amount,
        { reduceOnly: true },
      );
      const result = this._mapOrder(order, symbol, 'long', 'sell');
      this._emit('trade', result);
      return result;
    } catch (e) {
      return this._errorResult(symbol, 'long', 'sell', e);
    }
  }

  async closeShort(symbol: string, amount: number): Promise<OrderResult> {
    // Close short = buy with reduceOnly
    this._assertConnected();
    try {
      const order = await this.exchange.createMarketBuyOrder(
        symbol,
        amount,
        { reduceOnly: true },
      );
      const result = this._mapOrder(order, symbol, 'short', 'buy');
      this._emit('trade', result);
      return result;
    } catch (e) {
      return this._errorResult(symbol, 'short', 'buy', e);
    }
  }

  async closeAllPositions(): Promise<OrderResult[]> {
    const positions = await this.getPositions();
    const results: OrderResult[] = [];

    for (const pos of positions) {
      if (pos.direction === 'long') {
        results.push(await this.closeLong(pos.symbol, pos.amount));
      } else {
        results.push(await this.closeShort(pos.symbol, pos.amount));
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  async getPositions(): Promise<ConnectorPosition[]> {
    this._assertConnected();
    const raw: Position[] = await this.exchange.fetchPositions();
    return raw
      .filter((p: Position) => Math.abs(p.contracts ?? 0) > 0)
      .map(
        (p: Position): ConnectorPosition => ({
          symbol: p.symbol,
          direction: p.side === 'long' ? 'long' : 'short',
          amount: Math.abs(p.contracts ?? 0),
          entryPrice: p.entryPrice ?? 0,
          unrealizedPnl: p.unrealizedPnl ?? 0,
          openedAt: p.timestamp ?? Date.now(),
        }),
      );
  }

  async getPosition(symbol: string): Promise<ConnectorPosition | null> {
    const positions = await this.getPositions();
    return positions.find((p) => p.symbol === symbol) ?? null;
  }

  async getBalance(): Promise<ConnectorBalance> {
    this._assertConnected();
    // CCXT's fetchBalance() returns a rich object at runtime with per-currency
    // keys, but the static type is minimal. We cast to access USDT totals.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const balance = (await this.exchange.fetchBalance({ type: 'swap' })) as any;
    const total = Number(balance.total?.['USDT'] ?? 0);
    const available = Number(balance.free?.['USDT'] ?? 0);
    // unrealizedPnl is implied: positions that are open hold the difference
    const unrealizedPnl = total - available;

    return { total, available, unrealizedPnl };
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  on(event: 'trade', handler: (result: OrderResult) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'disconnect', handler: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _assertConnected(): void {
    if (!this.connected) {
      throw new Error(
        'BybitConnector: not connected — call connect() first',
      );
    }
  }

  /**
   * Map a CCXT order object to an OrderResult.
   * `direction` and `side` are passed explicitly because they are not always
   * reliably present on the CCXT order (e.g. reduceOnly close orders).
   */
  private _mapOrder(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    order: any,
    symbol: string,
    direction: 'long' | 'short',
    side: 'buy' | 'sell',
  ): OrderResult {
    const price = Number(order.average ?? order.price ?? 0);
    const amount = Number(order.filled ?? order.amount ?? 0);
    const fee = Number(order.fee?.cost ?? 0);
    const id: string =
      typeof order.id === 'string' ? order.id : String(order.id ?? uuidv4());
    const timestamp: number =
      typeof order.timestamp === 'number' ? order.timestamp : Date.now();

    return {
      id,
      symbol,
      direction,
      side,
      price,
      amount,
      fee,
      timestamp,
      status: 'filled',
    };
  }

  private _errorResult(
    symbol: string,
    direction: 'long' | 'short',
    side: 'buy' | 'sell',
    err: unknown,
  ): OrderResult {
    const message =
      err instanceof Error ? err.message : String(err);

    return {
      id: uuidv4(),
      symbol,
      direction,
      side,
      price: 0,
      amount: 0,
      fee: 0,
      timestamp: Date.now(),
      status: 'error',
      error: message,
    };
  }

  private _emit(event: string, ...args: unknown[]): void {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      handler(...args);
    }
  }
}
