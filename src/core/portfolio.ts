/**
 * Portfolio management for backtesting
 * Tracks positions, cash, and equity over time
 * Supports both long and short positions with open/close semantics
 */

import { v4 as uuidv4 } from 'uuid';
import type { Position, Trade } from './types.js';

/**
 * Portfolio class for managing positions and tracking equity
 */
export class Portfolio {
  /**
   * Available cash balance
   */
  protected _cash: number;

  /**
   * Current long position, or null if none
   */
  protected _longPosition: Position | null = null;

  /**
   * Current short position, or null if none
   */
  protected _shortPosition: Position | null = null;

  /**
   * Initial capital (for reference)
   */
  public readonly initialCapital: number;

  /**
   * Current price (for calculating unrealized PnL)
   */
  protected currentPrice: number = 0;

  /**
   * Symbol being traded
   */
  protected readonly symbol: string;

  /**
   * Whether this is a prediction market (affects short position cash flow)
   */
  protected readonly isPredictionMarket: boolean;

  /**
   * All trades executed in this portfolio
   */
  protected _trades: Trade[] = [];

  constructor(initialCapital: number, symbol: string, isPredictionMarket: boolean = false) {
    if (initialCapital <= 0) {
      throw new Error('Initial capital must be positive');
    }
    this._cash = initialCapital;
    this.initialCapital = initialCapital;
    this.symbol = symbol;
    this.isPredictionMarket = isPredictionMarket;
  }

  /**
   * Get current cash balance
   */
  get balance(): number {
    return this._cash;
  }

  /**
   * Alias for balance (backwards compatibility)
   */
  get cash(): number {
    return this._cash;
  }

  /**
   * Get current long position
   */
  get longPosition(): Position | null {
    return this._longPosition ? { ...this._longPosition } : null;
  }

  /**
   * Get current short position
   */
  get shortPosition(): Position | null {
    return this._shortPosition ? { ...this._shortPosition } : null;
  }

  /**
   * Check if there's an open long position
   */
  get hasLongPosition(): boolean {
    return this._longPosition !== null;
  }

  /**
   * Check if there's an open short position
   */
  get hasShortPosition(): boolean {
    return this._shortPosition !== null;
  }

  /**
   * Get all trades
   */
  get trades(): Trade[] {
    return [...this._trades];
  }

  /**
   * Get current equity (cash + unrealized PnL from positions)
   */
  get equity(): number {
    let total = this._cash;

    if (this._longPosition) {
      // Long position value: amount * currentPrice
      total += this._longPosition.amount * this.currentPrice;
    }

    if (this._shortPosition) {
      if (this.isPredictionMarket) {
        // PM short = NO shares, value = (1 - currentPrice) * amount
        total += (1 - this.currentPrice) * this._shortPosition.amount;
      } else {
        // Short position: add unrealized PnL (profit when price goes down)
        const shortPnl = (this._shortPosition.entryPrice - this.currentPrice) * this._shortPosition.amount;
        total += shortPnl;
      }
    }

    return total;
  }

  /**
   * Open a long position (buy to open)
   * @param amount - Amount in base currency
   * @param price - Entry price
   * @param timestamp - Entry timestamp
   * @param feeRate - Fee rate as decimal (0.001 = 0.1%), defaults to 0
   * @returns The trade record
   */
  openLong(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade {
    if (this._longPosition) {
      throw new Error('Cannot open long: a long position is already open');
    }

    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const tradeValue = amount * price;
    const fee = tradeValue * feeRate;
    const totalCost = tradeValue + fee;

    if (totalCost > this._cash) {
      throw new Error(
        `Insufficient funds: need ${totalCost.toFixed(2)} (including ${fee.toFixed(2)} fee), have ${this._cash.toFixed(2)}`
      );
    }

    // Deduct cash for buying plus fee
    this._cash -= totalCost;

    const positionId = uuidv4();

    this._longPosition = {
      id: positionId,
      symbol: this.symbol,
      side: 'long',
      amount,
      entryPrice: price,
      entryTime: timestamp,
      unrealizedPnl: 0,
    };

    this.currentPrice = price;

    const trade: Trade = {
      id: positionId, // Reuse position ID so close trades can reference it
      symbol: this.symbol,
      action: 'OPEN_LONG',
      price,
      amount,
      timestamp,
      balanceAfter: this._cash,
      fee: fee > 0 ? fee : undefined,
      feeRate: feeRate > 0 ? feeRate : undefined,
    };

    this._trades.push(trade);
    return trade;
  }

  /**
   * Close long position (sell to close)
   * @param amount - Amount to close, or 'all' to close entire position
   * @param price - Exit price
   * @param timestamp - Exit timestamp
   * @param feeRate - Fee rate as decimal (0.001 = 0.1%), defaults to 0
   * @returns The trade record
   */
  closeLong(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade {
    if (!this._longPosition) {
      throw new Error('Cannot close long: no long position is open');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const closeAmount = amount === 'all' ? this._longPosition.amount : amount;

    if (closeAmount <= 0) {
      throw new Error('Close amount must be positive');
    }

    if (closeAmount > this._longPosition.amount) {
      throw new Error(
        `Cannot close ${closeAmount}, only ${this._longPosition.amount} available`
      );
    }

    const { entryPrice, id: positionId } = this._longPosition;

    // Calculate trade value and fee
    const tradeValue = closeAmount * price;
    const fee = tradeValue * feeRate;

    // Calculate PnL for closed portion (after fee)
    const grossPnl = (price - entryPrice) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((price - entryPrice) / entryPrice) * 100;

    // Add proceeds from sale minus fee to cash
    this._cash += tradeValue - fee;

    // Update or clear position
    if (closeAmount >= this._longPosition.amount) {
      // Full close
      this._longPosition = null;
    } else {
      // Partial close
      this._longPosition.amount -= closeAmount;
    }

    const trade: Trade = {
      id: uuidv4(),
      symbol: this.symbol,
      action: 'CLOSE_LONG',
      price,
      amount: closeAmount,
      timestamp,
      pnl,
      pnlPercent,
      closedPositionId: positionId,
      balanceAfter: this._cash,
      fee: fee > 0 ? fee : undefined,
      feeRate: feeRate > 0 ? feeRate : undefined,
    };

    this._trades.push(trade);
    return trade;
  }

  /**
   * Open a short position (sell to open)
   * @param amount - Amount in base currency
   * @param price - Entry price
   * @param timestamp - Entry timestamp
   * @param feeRate - Fee rate as decimal (0.001 = 0.1%), defaults to 0
   * @returns The trade record
   */
  openShort(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade {
    if (this._shortPosition) {
      throw new Error('Cannot open short: a short position is already open');
    }

    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    // For shorts, we charge fee on the notional value
    const tradeValue = amount * price;
    const fee = tradeValue * feeRate;

    let totalCost: number;
    if (this.isPredictionMarket) {
      // In prediction markets, short = buy NO at (1-price)
      const noCost = amount * (1 - price);
      totalCost = noCost + fee;
      if (totalCost > this._cash) {
        throw new Error(
          `Insufficient funds: need ${totalCost.toFixed(2)} (including ${fee.toFixed(2)} fee), have ${this._cash.toFixed(2)}`
        );
      }
      this._cash -= totalCost;
    } else {
      // Traditional short: only deduct fee
      if (fee > this._cash) {
        throw new Error(
          `Insufficient funds for fee: need ${fee.toFixed(2)}, have ${this._cash.toFixed(2)}`
        );
      }
      this._cash -= fee;
    }

    const positionId = uuidv4();

    this._shortPosition = {
      id: positionId,
      symbol: this.symbol,
      side: 'short',
      amount,
      entryPrice: price,
      entryTime: timestamp,
      unrealizedPnl: 0,
    };

    this.currentPrice = price;

    const trade: Trade = {
      id: positionId, // Reuse position ID so close trades can reference it
      symbol: this.symbol,
      action: 'OPEN_SHORT',
      price,
      amount,
      timestamp,
      balanceAfter: this._cash,
      fee: fee > 0 ? fee : undefined,
      feeRate: feeRate > 0 ? feeRate : undefined,
    };

    this._trades.push(trade);
    return trade;
  }

  /**
   * Close short position (buy to close)
   * @param amount - Amount to close, or 'all' to close entire position
   * @param price - Exit price
   * @param timestamp - Exit timestamp
   * @param feeRate - Fee rate as decimal (0.001 = 0.1%), defaults to 0
   * @returns The trade record
   */
  closeShort(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade {
    if (!this._shortPosition) {
      throw new Error('Cannot close short: no short position is open');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const closeAmount = amount === 'all' ? this._shortPosition.amount : amount;

    if (closeAmount <= 0) {
      throw new Error('Close amount must be positive');
    }

    if (closeAmount > this._shortPosition.amount) {
      throw new Error(
        `Cannot close ${closeAmount}, only ${this._shortPosition.amount} available`
      );
    }

    const { entryPrice, id: positionId } = this._shortPosition;

    // Calculate trade value and fee
    const tradeValue = closeAmount * price;
    const fee = tradeValue * feeRate;

    // Calculate PnL for closed portion (profit when price goes down, minus fee)
    const grossPnl = (entryPrice - price) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((entryPrice - price) / entryPrice) * 100;

    // Add cash back based on market type
    if (this.isPredictionMarket) {
      // Return NO share value at exit
      const noValue = closeAmount * (1 - price);
      this._cash += noValue - fee;
    } else {
      // Traditional short: settle the PnL difference
      this._cash += grossPnl - fee;
    }

    // Update or clear position
    if (closeAmount >= this._shortPosition.amount) {
      // Full close
      this._shortPosition = null;
    } else {
      // Partial close
      this._shortPosition.amount -= closeAmount;
    }

    const trade: Trade = {
      id: uuidv4(),
      symbol: this.symbol,
      action: 'CLOSE_SHORT',
      price,
      amount: closeAmount,
      timestamp,
      pnl,
      pnlPercent,
      closedPositionId: positionId,
      balanceAfter: this._cash,
      fee: fee > 0 ? fee : undefined,
      feeRate: feeRate > 0 ? feeRate : undefined,
    };

    this._trades.push(trade);
    return trade;
  }

  /**
   * Update the current price (for unrealized PnL calculation)
   * @param price - Current market price
   */
  updatePrice(price: number): void {
    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    this.currentPrice = price;

    // Update unrealized PnL for long position
    if (this._longPosition) {
      this._longPosition.unrealizedPnl =
        (price - this._longPosition.entryPrice) * this._longPosition.amount;
    }

    // Update unrealized PnL for short position
    if (this._shortPosition) {
      this._shortPosition.unrealizedPnl =
        (this._shortPosition.entryPrice - price) * this._shortPosition.amount;
    }
  }

  /**
   * Get read-only portfolio state (for strategy context)
   */
  getState(): {
    cash: number;
    balance: number;
    equity: number;
    longPosition: Position | null;
    shortPosition: Position | null;
  } {
    return {
      cash: this._cash,
      balance: this._cash,
      equity: this.equity,
      longPosition: this.longPosition,
      shortPosition: this.shortPosition,
    };
  }

  /**
   * Check if we have enough cash for a trade
   */
  canAfford(amount: number, price: number): boolean {
    return this._cash >= amount * price;
  }

  /**
   * Get total return percentage
   */
  getTotalReturnPercent(): number {
    return ((this.equity - this.initialCapital) / this.initialCapital) * 100;
  }

  /**
   * Reset portfolio to initial state
   */
  reset(): void {
    this._cash = this.initialCapital;
    this._longPosition = null;
    this._shortPosition = null;
    this._trades = [];
    this.currentPrice = 0;
  }
}
