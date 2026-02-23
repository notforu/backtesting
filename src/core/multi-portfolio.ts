/**
 * Multi-symbol shared-capital portfolio for backtesting
 * Maintains per-symbol position tracking with a single shared cash pool.
 * Reuses the PnL/fee math patterns from the Portfolio class.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Position, Trade } from './types.js';

/**
 * Per-symbol state tracked inside the portfolio
 */
interface SymbolState {
  longPosition: Position | null;
  shortPosition: Position | null;
  currentPrice: number;
}

/**
 * MultiSymbolPortfolio manages positions across multiple symbols
 * using a single shared cash pool.
 *
 * Short position accounting:
 *   - Opening a short locks the full notional collateral (amount * price) + fee from cash
 *   - Closing a short returns the collateral plus/minus gross PnL, minus exit fee
 *   - Short equity value = cash + (entryPrice - currentPrice) * amount (unrealized PnL component)
 */
export class MultiSymbolPortfolio {
  /**
   * Shared cash balance across all symbols
   */
  protected _cash: number;

  /**
   * Initial capital (for reference)
   */
  public readonly initialCapital: number;

  /**
   * Per-symbol state: positions and last known price
   */
  private _symbols: Map<string, SymbolState> = new Map();

  /**
   * All trades executed across all symbols, in chronological order
   */
  protected _trades: Trade[] = [];

  constructor(initialCapital: number) {
    if (initialCapital <= 0) {
      throw new Error('Initial capital must be positive');
    }
    this._cash = initialCapital;
    this.initialCapital = initialCapital;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns (and lazily creates) the state record for a given symbol.
   */
  private _getOrCreateSymbolState(symbol: string): SymbolState {
    let state = this._symbols.get(symbol);
    if (!state) {
      state = { longPosition: null, shortPosition: null, currentPrice: 0 };
      this._symbols.set(symbol, state);
    }
    return state;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Available cash balance shared across all symbols
   */
  get cash(): number {
    return this._cash;
  }

  /**
   * Alias for cash (backwards compatibility with Portfolio interface)
   */
  get balance(): number {
    return this._cash;
  }

  /**
   * Total equity: cash + sum of all position values across all symbols.
   *
   * Long position value  = amount * currentPrice
   * Short position value = entryPrice * amount + unrealizedPnL
   *                      = entryPrice * amount + (entryPrice - currentPrice) * amount
   *                      = (2 * entryPrice - currentPrice) * amount
   *
   * Since openShort now locks the full notional (entryPrice * amount) from cash,
   * we must add it back here as the locked collateral component plus unrealized PnL.
   */
  get equity(): number {
    let total = this._cash;

    for (const state of this._symbols.values()) {
      if (state.longPosition) {
        total += state.longPosition.amount * state.currentPrice;
      }
      if (state.shortPosition) {
        // Return locked collateral (entryPrice * amount) + unrealized PnL (entryPrice - currentPrice) * amount
        const collateral = state.shortPosition.entryPrice * state.shortPosition.amount;
        const unrealizedPnl = (state.shortPosition.entryPrice - state.currentPrice) * state.shortPosition.amount;
        total += collateral + unrealizedPnl;
      }
    }

    return total;
  }

  /**
   * All trades executed across all symbols (returns a copy)
   */
  get trades(): Trade[] {
    return [...this._trades];
  }

  // ---------------------------------------------------------------------------
  // Position queries
  // ---------------------------------------------------------------------------

  /**
   * Returns {longPosition, shortPosition} for the given symbol.
   * Both will be null if no position is open for that symbol.
   */
  getPositionForSymbol(symbol: string): { longPosition: Position | null; shortPosition: Position | null } {
    const state = this._symbols.get(symbol);
    if (!state) {
      return { longPosition: null, shortPosition: null };
    }
    return {
      longPosition: state.longPosition ? { ...state.longPosition } : null,
      shortPosition: state.shortPosition ? { ...state.shortPosition } : null,
    };
  }

  /**
   * Number of open positions (each long or short counts as one)
   */
  getPositionCount(): number {
    let count = 0;
    for (const state of this._symbols.values()) {
      if (state.longPosition) count++;
      if (state.shortPosition) count++;
    }
    return count;
  }

  /**
   * True if at least one position (long or short) is open in any symbol
   */
  hasAnyPosition(): boolean {
    for (const state of this._symbols.values()) {
      if (state.longPosition || state.shortPosition) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Price updates
  // ---------------------------------------------------------------------------

  /**
   * Update the current price for a specific symbol.
   * Also refreshes unrealized PnL on any open positions for that symbol.
   *
   * @param symbol - The trading pair (e.g. "BTC/USDT")
   * @param price  - Current market price (must be positive)
   */
  updatePrice(symbol: string, price: number): void {
    if (price <= 0) {
      throw new Error(`Price must be positive (got ${price} for ${symbol})`);
    }

    const state = this._getOrCreateSymbolState(symbol);
    state.currentPrice = price;

    if (state.longPosition) {
      state.longPosition.unrealizedPnl =
        (price - state.longPosition.entryPrice) * state.longPosition.amount;
    }

    if (state.shortPosition) {
      state.shortPosition.unrealizedPnl =
        (state.shortPosition.entryPrice - price) * state.shortPosition.amount;
    }
  }

  // ---------------------------------------------------------------------------
  // Long positions
  // ---------------------------------------------------------------------------

  /**
   * Open a long position for a symbol (buy to open).
   * Deducts (amount * price + fee) from the shared cash pool.
   *
   * @param symbol    - Trading pair
   * @param amount    - Base currency amount
   * @param price     - Entry price
   * @param timestamp - Entry timestamp (Unix ms)
   * @param feeRate   - Fee rate as decimal (0.001 = 0.1%); defaults to 0
   * @returns The trade record
   */
  openLong(
    symbol: string,
    amount: number,
    price: number,
    timestamp: number,
    feeRate: number = 0,
  ): Trade {
    const state = this._getOrCreateSymbolState(symbol);

    if (state.longPosition) {
      throw new Error(`Cannot open long for ${symbol}: a long position is already open`);
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
        `Insufficient funds to open long ${symbol}: need ${totalCost.toFixed(2)} ` +
        `(including ${fee.toFixed(2)} fee), have ${this._cash.toFixed(2)}`,
      );
    }

    this._cash -= totalCost;

    const positionId = uuidv4();

    state.longPosition = {
      id: positionId,
      symbol,
      side: 'long',
      amount,
      entryPrice: price,
      entryTime: timestamp,
      unrealizedPnl: 0,
    };

    state.currentPrice = price;

    const trade: Trade = {
      id: positionId,
      symbol,
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
   * Close a long position for a symbol (sell to close).
   * Adds (amount * price - fee) to the shared cash pool.
   *
   * @param symbol    - Trading pair
   * @param amount    - Amount to close, or 'all' to close entire position
   * @param price     - Exit price
   * @param timestamp - Exit timestamp (Unix ms)
   * @param feeRate   - Fee rate as decimal; defaults to 0
   * @returns The trade record
   */
  closeLong(
    symbol: string,
    amount: number | 'all',
    price: number,
    timestamp: number,
    feeRate: number = 0,
  ): Trade {
    const state = this._getOrCreateSymbolState(symbol);

    if (!state.longPosition) {
      throw new Error(`Cannot close long for ${symbol}: no long position is open`);
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const closeAmount = amount === 'all' ? state.longPosition.amount : amount;

    if (closeAmount <= 0) {
      throw new Error('Close amount must be positive');
    }

    if (closeAmount > state.longPosition.amount) {
      throw new Error(
        `Cannot close ${closeAmount} of ${symbol}, only ${state.longPosition.amount} available`,
      );
    }

    const { entryPrice, id: positionId } = state.longPosition;

    const tradeValue = closeAmount * price;
    const fee = tradeValue * feeRate;

    // PnL: profit from price change, net of exit fee
    const grossPnl = (price - entryPrice) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((price - entryPrice) / entryPrice) * 100;

    // Add sale proceeds minus fee to cash
    this._cash += tradeValue - fee;
    state.currentPrice = price;

    if (closeAmount >= state.longPosition.amount) {
      state.longPosition = null;
    } else {
      state.longPosition.amount -= closeAmount;
    }

    const trade: Trade = {
      id: uuidv4(),
      symbol,
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

  // ---------------------------------------------------------------------------
  // Short positions
  // ---------------------------------------------------------------------------

  /**
   * Open a short position for a symbol (sell to open).
   * Locks the full notional collateral (amount * price) plus fee from the shared cash pool.
   *
   * @param symbol    - Trading pair
   * @param amount    - Base currency amount
   * @param price     - Entry price
   * @param timestamp - Entry timestamp (Unix ms)
   * @param feeRate   - Fee rate as decimal; defaults to 0
   * @returns The trade record
   */
  openShort(
    symbol: string,
    amount: number,
    price: number,
    timestamp: number,
    feeRate: number = 0,
  ): Trade {
    const state = this._getOrCreateSymbolState(symbol);

    if (state.shortPosition) {
      throw new Error(`Cannot open short for ${symbol}: a short position is already open`);
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
        `Insufficient funds for short on ${symbol}: need ${totalCost.toFixed(2)}, have ${this._cash.toFixed(2)}`,
      );
    }

    this._cash -= totalCost;

    const positionId = uuidv4();

    state.shortPosition = {
      id: positionId,
      symbol,
      side: 'short',
      amount,
      entryPrice: price,
      entryTime: timestamp,
      unrealizedPnl: 0,
    };

    state.currentPrice = price;

    const trade: Trade = {
      id: positionId,
      symbol,
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
   * Close a short position for a symbol (buy to close).
   * Settles gross PnL minus exit fee into the shared cash pool.
   *
   * @param symbol    - Trading pair
   * @param amount    - Amount to close, or 'all' to close entire position
   * @param price     - Exit price
   * @param timestamp - Exit timestamp (Unix ms)
   * @param feeRate   - Fee rate as decimal; defaults to 0
   * @returns The trade record
   */
  closeShort(
    symbol: string,
    amount: number | 'all',
    price: number,
    timestamp: number,
    feeRate: number = 0,
  ): Trade {
    const state = this._getOrCreateSymbolState(symbol);

    if (!state.shortPosition) {
      throw new Error(`Cannot close short for ${symbol}: no short position is open`);
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const closeAmount = amount === 'all' ? state.shortPosition.amount : amount;

    if (closeAmount <= 0) {
      throw new Error('Close amount must be positive');
    }

    if (closeAmount > state.shortPosition.amount) {
      throw new Error(
        `Cannot close ${closeAmount} of ${symbol}, only ${state.shortPosition.amount} available`,
      );
    }

    const { entryPrice, id: positionId } = state.shortPosition;

    const tradeValue = closeAmount * price;
    const fee = tradeValue * feeRate;

    // PnL: profit when price goes down (entry - exit), net of exit fee
    const grossPnl = (entryPrice - price) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((entryPrice - price) / entryPrice) * 100;

    // Return the locked collateral (entryPrice * closeAmount) plus gross PnL, minus exit fee.
    // collateral + grossPnl = entryPrice*amount + (entryPrice - price)*amount = 2*entryPrice*amount - price*amount
    // Simplifies to: entryPrice * closeAmount + grossPnl - fee
    const collateral = entryPrice * closeAmount;
    this._cash += collateral + grossPnl - fee;
    state.currentPrice = price;

    if (closeAmount >= state.shortPosition.amount) {
      state.shortPosition = null;
    } else {
      state.shortPosition.amount -= closeAmount;
    }

    const trade: Trade = {
      id: uuidv4(),
      symbol,
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

  // ---------------------------------------------------------------------------
  // Funding
  // ---------------------------------------------------------------------------

  /**
   * Apply a funding payment to the shared cash balance.
   * Positive payment = receive funds; negative payment = pay funds.
   * Used in futures mode where funding is paid/received every 8 hours.
   *
   * @param amount - Payment amount in quote currency (can be negative)
   */
  applyFundingPayment(amount: number): void {
    this._cash += amount;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Check if we have enough cash for a trade
   */
  canAfford(amount: number, price: number): boolean {
    return this._cash >= amount * price;
  }

  /**
   * Get total return percentage relative to initial capital
   */
  getTotalReturnPercent(): number {
    return ((this.equity - this.initialCapital) / this.initialCapital) * 100;
  }

  /**
   * Reset the portfolio to its initial state
   */
  reset(): void {
    this._cash = this.initialCapital;
    this._symbols.clear();
    this._trades = [];
  }
}
