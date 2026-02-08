/**
 * Pairs Portfolio - manages shared cash pool with positions in two symbols
 */
import { v4 as uuidv4 } from 'uuid';
import type { Trade, Position } from './types.js';

export class PairsPortfolio {
  private _cash: number;
  public readonly initialCapital: number;
  private readonly symbolA: string;
  private readonly symbolB: string;
  private readonly _leverage: number;

  private _longPositionA: Position | null = null;
  private _shortPositionA: Position | null = null;
  private _longPositionB: Position | null = null;
  private _shortPositionB: Position | null = null;

  private _longMarginA = 0;
  private _shortMarginA = 0;
  private _longMarginB = 0;
  private _shortMarginB = 0;

  private _priceA = 0;
  private _priceB = 0;
  private _trades: Trade[] = [];

  constructor(initialCapital: number, symbolA: string, symbolB: string, leverage: number = 1) {
    if (initialCapital <= 0) throw new Error('Initial capital must be positive');
    this._cash = initialCapital;
    this.initialCapital = initialCapital;
    this.symbolA = symbolA;
    this.symbolB = symbolB;
    this._leverage = Math.max(1, leverage);
  }

  get cash(): number { return this._cash; }
  get balance(): number { return this._cash; }
  get leverage(): number { return this._leverage; }
  get trades(): Trade[] { return [...this._trades]; }

  get longPositionA(): Position | null { return this._longPositionA ? { ...this._longPositionA } : null; }
  get shortPositionA(): Position | null { return this._shortPositionA ? { ...this._shortPositionA } : null; }
  get longPositionB(): Position | null { return this._longPositionB ? { ...this._longPositionB } : null; }
  get shortPositionB(): Position | null { return this._shortPositionB ? { ...this._shortPositionB } : null; }

  get equity(): number {
    let total = this._cash;
    if (this._leverage > 1) {
      if (this._longPositionA) {
        const pnl = (this._priceA - this._longPositionA.entryPrice) * this._longPositionA.amount * this._leverage;
        total += this._longMarginA + pnl;
      }
      if (this._shortPositionA) {
        const pnl = (this._shortPositionA.entryPrice - this._priceA) * this._shortPositionA.amount * this._leverage;
        total += this._shortMarginA + pnl;
      }
      if (this._longPositionB) {
        const pnl = (this._priceB - this._longPositionB.entryPrice) * this._longPositionB.amount * this._leverage;
        total += this._longMarginB + pnl;
      }
      if (this._shortPositionB) {
        const pnl = (this._shortPositionB.entryPrice - this._priceB) * this._shortPositionB.amount * this._leverage;
        total += this._shortMarginB + pnl;
      }
    } else {
      if (this._longPositionA) total += this._longPositionA.amount * this._priceA;
      if (this._shortPositionA) total += (this._shortPositionA.entryPrice - this._priceA) * this._shortPositionA.amount;
      if (this._longPositionB) total += this._longPositionB.amount * this._priceB;
      if (this._shortPositionB) total += (this._shortPositionB.entryPrice - this._priceB) * this._shortPositionB.amount;
    }
    return total;
  }

  updatePrices(priceA: number, priceB: number): void {
    this._priceA = priceA;
    this._priceB = priceB;
    if (this._longPositionA) this._longPositionA.unrealizedPnl = (priceA - this._longPositionA.entryPrice) * this._longPositionA.amount * this._leverage;
    if (this._shortPositionA) this._shortPositionA.unrealizedPnl = (this._shortPositionA.entryPrice - priceA) * this._shortPositionA.amount * this._leverage;
    if (this._longPositionB) this._longPositionB.unrealizedPnl = (priceB - this._longPositionB.entryPrice) * this._longPositionB.amount * this._leverage;
    if (this._shortPositionB) this._shortPositionB.unrealizedPnl = (this._shortPositionB.entryPrice - priceB) * this._shortPositionB.amount * this._leverage;
  }

  openLongA(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade { return this._openPosition('A', 'long', amount, price, timestamp, feeRate); }
  openLongB(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade { return this._openPosition('B', 'long', amount, price, timestamp, feeRate); }
  openShortA(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade { return this._openPosition('A', 'short', amount, price, timestamp, feeRate); }
  openShortB(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade { return this._openPosition('B', 'short', amount, price, timestamp, feeRate); }
  closeLongA(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade { return this._closePosition('A', 'long', amount, price, timestamp, feeRate); }
  closeLongB(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade { return this._closePosition('B', 'long', amount, price, timestamp, feeRate); }
  closeShortA(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade { return this._closePosition('A', 'short', amount, price, timestamp, feeRate); }
  closeShortB(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade { return this._closePosition('B', 'short', amount, price, timestamp, feeRate); }

  private _getPosition(side: 'A' | 'B', type: 'long' | 'short'): Position | null {
    if (side === 'A') return type === 'long' ? this._longPositionA : this._shortPositionA;
    return type === 'long' ? this._longPositionB : this._shortPositionB;
  }

  private _setPosition(side: 'A' | 'B', type: 'long' | 'short', pos: Position | null): void {
    if (side === 'A') {
      if (type === 'long') this._longPositionA = pos;
      else this._shortPositionA = pos;
    } else {
      if (type === 'long') this._longPositionB = pos;
      else this._shortPositionB = pos;
    }
  }

  private _getMargin(side: 'A' | 'B', type: 'long' | 'short'): number {
    if (side === 'A') return type === 'long' ? this._longMarginA : this._shortMarginA;
    return type === 'long' ? this._longMarginB : this._shortMarginB;
  }

  private _setMargin(side: 'A' | 'B', type: 'long' | 'short', margin: number): void {
    if (side === 'A') {
      if (type === 'long') this._longMarginA = margin;
      else this._shortMarginA = margin;
    } else {
      if (type === 'long') this._longMarginB = margin;
      else this._shortMarginB = margin;
    }
  }

  private _openPosition(side: 'A' | 'B', type: 'long' | 'short', amount: number, price: number, timestamp: number, feeRate: number): Trade {
    const symbol = side === 'A' ? this.symbolA : this.symbolB;
    const existing = this._getPosition(side, type);
    if (existing) throw new Error(`Cannot open ${type} ${side}: already open`);
    if (amount <= 0) throw new Error('Amount must be positive');
    if (price <= 0) throw new Error('Price must be positive');

    const notional = amount * price;
    const fee = notional * feeRate;
    let costFromCash: number;

    if (this._leverage > 1) {
      const margin = notional / this._leverage;
      costFromCash = margin + fee;
      if (costFromCash > this._cash) throw new Error(`Insufficient funds: need ${costFromCash.toFixed(2)}, have ${this._cash.toFixed(2)}`);
      this._cash -= costFromCash;
      this._setMargin(side, type, margin);
    } else {
      if (type === 'long') {
        costFromCash = notional + fee;
        if (costFromCash > this._cash) throw new Error(`Insufficient funds: need ${costFromCash.toFixed(2)}, have ${this._cash.toFixed(2)}`);
        this._cash -= costFromCash;
      } else {
        // Short in spot mode: only deduct fee
        if (fee > this._cash) throw new Error(`Insufficient funds for fee: need ${fee.toFixed(2)}, have ${this._cash.toFixed(2)}`);
        this._cash -= fee;
      }
      this._setMargin(side, type, 0);
    }

    const positionId = uuidv4();
    this._setPosition(side, type, {
      id: positionId,
      symbol,
      side: type,
      amount,
      entryPrice: price,
      entryTime: timestamp,
      unrealizedPnl: 0,
    });

    const action = type === 'long' ? 'OPEN_LONG' as const : 'OPEN_SHORT' as const;
    const trade: Trade = {
      id: uuidv4(),
      symbol,
      action,
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

  private _closePosition(side: 'A' | 'B', type: 'long' | 'short', amount: number | 'all', price: number, timestamp: number, feeRate: number): Trade {
    const symbol = side === 'A' ? this.symbolA : this.symbolB;
    const position = this._getPosition(side, type);
    const margin = this._getMargin(side, type);

    if (!position) throw new Error(`Cannot close ${type} ${side}: no position`);
    if (price <= 0) throw new Error('Price must be positive');

    const closeAmount = amount === 'all' ? position.amount : amount;
    if (closeAmount <= 0) throw new Error('Close amount must be positive');
    if (closeAmount > position.amount) throw new Error(`Cannot close ${closeAmount}, only ${position.amount} available`);

    const notional = closeAmount * price;
    const fee = notional * feeRate;

    let grossPnl: number;
    let pnlPercent: number;

    if (type === 'long') {
      grossPnl = (price - position.entryPrice) * closeAmount * this._leverage;
      pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
    } else {
      grossPnl = (position.entryPrice - price) * closeAmount * this._leverage;
      pnlPercent = ((position.entryPrice - price) / position.entryPrice) * 100;
    }

    const pnl = grossPnl - fee;

    if (this._leverage > 1) {
      this._cash += margin + grossPnl - fee;
    } else {
      if (type === 'long') {
        this._cash += notional - fee;
      } else {
        this._cash += grossPnl - fee;
      }
    }

    const isFullClose = closeAmount >= position.amount;
    if (isFullClose) {
      this._setPosition(side, type, null);
      this._setMargin(side, type, 0);
    } else {
      position.amount -= closeAmount;
      // Proportionally reduce margin
      if (this._leverage > 1) {
        const ratio = closeAmount / (closeAmount + position.amount);
        this._setMargin(side, type, margin * (1 - ratio));
      }
    }

    const action = type === 'long' ? 'CLOSE_LONG' as const : 'CLOSE_SHORT' as const;
    const trade: Trade = {
      id: uuidv4(),
      symbol,
      action,
      price,
      amount: closeAmount,
      timestamp,
      pnl,
      pnlPercent,
      closedPositionId: position.id,
      balanceAfter: this._cash,
      fee: fee > 0 ? fee : undefined,
      feeRate: feeRate > 0 ? feeRate : undefined,
    };
    this._trades.push(trade);
    return trade;
  }

  getState() {
    return {
      cash: this._cash,
      balance: this._cash,
      equity: this.equity,
      longPositionA: this.longPositionA,
      shortPositionA: this.shortPositionA,
      longPositionB: this.longPositionB,
      shortPositionB: this.shortPositionB,
    };
  }
}
