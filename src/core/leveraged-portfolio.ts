/**
 * Leveraged Portfolio for margin trading with liquidation support
 * Extends Portfolio to support leverage trading (perpetual futures style)
 */

import { v4 as uuidv4 } from 'uuid';
import { Portfolio } from './portfolio.js';
import type { Trade } from './types.js';

/**
 * LeveragedPortfolio class for managing leveraged positions
 *
 * Key differences from base Portfolio:
 * - Margin-based position sizing (only post margin = notional / leverage)
 * - PnL amplification (profit/loss on full notional, not just margin)
 * - Liquidation risk (forced close if losses exceed threshold)
 * - Maintenance margin requirement (position closed if margin falls below threshold)
 *
 * When leverage=1, behavior is identical to base Portfolio class.
 */
export class LeveragedPortfolio extends Portfolio {
  private readonly _leverage: number;
  private readonly _maintenanceMarginRate: number;
  private _liquidationTrade: Trade | null = null;

  // Track margin posted for each position
  private _longMargin: number = 0;
  private _shortMargin: number = 0;

  /**
   * Create a leveraged portfolio
   * @param initialCapital - Starting capital
   * @param symbol - Trading symbol
   * @param leverage - Leverage multiplier (1-125, default 1)
   * @param maintenanceMarginRate - Maintenance margin as fraction of initial margin (default 0.5 = 50%)
   */
  constructor(
    initialCapital: number,
    symbol: string,
    leverage: number = 1,
    maintenanceMarginRate: number = 0.5
  ) {
    super(initialCapital, symbol);

    if (leverage < 1 || leverage > 125) {
      throw new Error('Leverage must be between 1 and 125');
    }

    if (maintenanceMarginRate < 0 || maintenanceMarginRate > 1) {
      throw new Error('Maintenance margin rate must be between 0 and 1');
    }

    this._leverage = leverage;
    this._maintenanceMarginRate = maintenanceMarginRate;
  }

  /**
   * Get the leverage multiplier
   */
  get leverage(): number {
    return this._leverage;
  }

  /**
   * Get the maintenance margin rate
   */
  get maintenanceMarginRate(): number {
    return this._maintenanceMarginRate;
  }

  /**
   * Check if portfolio was liquidated
   */
  get wasLiquidated(): boolean {
    return this._liquidationTrade !== null;
  }

  /**
   * Get and clear the liquidation trade
   */
  getLiquidationTrade(): Trade | null {
    const trade = this._liquidationTrade;
    this._liquidationTrade = null;
    return trade;
  }

  /**
   * Open a long position with leverage
   * For leverage=1: identical to base Portfolio
   * For leverage>1: only deduct margin = (amount * price) / leverage
   */
  openLong(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade {
    // For leverage=1, delegate to parent (identical behavior)
    if (this._leverage === 1) {
      return super.openLong(amount, price, timestamp, feeRate);
    }

    // Leverage > 1: margin-based opening
    if (this._longPosition) {
      throw new Error('Cannot open long: a long position is already open');
    }

    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const notional = amount * price;
    const margin = notional / this._leverage;
    const fee = notional * feeRate;
    const totalCost = margin + fee;

    if (totalCost > this._cash) {
      throw new Error(
        `Insufficient funds: need ${totalCost.toFixed(2)} (margin ${margin.toFixed(2)} + fee ${fee.toFixed(2)}), have ${this._cash.toFixed(2)}`
      );
    }

    // Deduct margin and fee from cash
    this._cash -= totalCost;
    this._longMargin = margin;

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
      id: uuidv4(),
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
   * Close long position with leverage
   * For leverage=1: identical to base Portfolio
   * For leverage>1: return margin + leveraged PnL
   */
  closeLong(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade {
    // For leverage=1, delegate to parent (identical behavior)
    if (this._leverage === 1) {
      return super.closeLong(amount, price, timestamp, feeRate);
    }

    // Leverage > 1: margin-based closing
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
    const isFullClose = closeAmount >= this._longPosition.amount;

    // Calculate leveraged PnL (on full notional)
    const notional = closeAmount * price;
    const fee = notional * feeRate;
    const grossPnl = (price - entryPrice) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((price - entryPrice) / entryPrice) * 100;

    // Calculate margin to return
    const marginToReturn = isFullClose
      ? this._longMargin
      : this._longMargin * (closeAmount / this._longPosition.amount);

    // Return margin + PnL to cash
    this._cash += marginToReturn + grossPnl - fee;

    // Update position
    if (isFullClose) {
      this._longPosition = null;
      this._longMargin = 0;
    } else {
      this._longPosition.amount -= closeAmount;
      this._longMargin -= marginToReturn;
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
   * Open a short position with leverage
   * For leverage=1: identical to base Portfolio
   * For leverage>1: only deduct margin = (amount * price) / leverage
   */
  openShort(amount: number, price: number, timestamp: number, feeRate: number = 0): Trade {
    // For leverage=1, delegate to parent (identical behavior)
    if (this._leverage === 1) {
      return super.openShort(amount, price, timestamp, feeRate);
    }

    // Leverage > 1: margin-based opening
    if (this._shortPosition) {
      throw new Error('Cannot open short: a short position is already open');
    }

    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (price <= 0) {
      throw new Error('Price must be positive');
    }

    const notional = amount * price;
    const margin = notional / this._leverage;
    const fee = notional * feeRate;
    const totalCost = margin + fee;

    if (totalCost > this._cash) {
      throw new Error(
        `Insufficient funds: need ${totalCost.toFixed(2)} (margin ${margin.toFixed(2)} + fee ${fee.toFixed(2)}), have ${this._cash.toFixed(2)}`
      );
    }

    // Deduct margin and fee from cash
    this._cash -= totalCost;
    this._shortMargin = margin;

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
      id: uuidv4(),
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
   * Close short position with leverage
   * For leverage=1: identical to base Portfolio
   * For leverage>1: return margin + leveraged PnL
   */
  closeShort(amount: number | 'all', price: number, timestamp: number, feeRate: number = 0): Trade {
    // For leverage=1, delegate to parent (identical behavior)
    if (this._leverage === 1) {
      return super.closeShort(amount, price, timestamp, feeRate);
    }

    // Leverage > 1: margin-based closing
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
    const isFullClose = closeAmount >= this._shortPosition.amount;

    // Calculate leveraged PnL (profit when price goes down)
    const notional = closeAmount * price;
    const fee = notional * feeRate;
    const grossPnl = (entryPrice - price) * closeAmount;
    const pnl = grossPnl - fee;
    const pnlPercent = ((entryPrice - price) / entryPrice) * 100;

    // Calculate margin to return
    const marginToReturn = isFullClose
      ? this._shortMargin
      : this._shortMargin * (closeAmount / this._shortPosition.amount);

    // Return margin + PnL to cash
    this._cash += marginToReturn + grossPnl - fee;

    // Update position
    if (isFullClose) {
      this._shortPosition = null;
      this._shortMargin = 0;
    } else {
      this._shortPosition.amount -= closeAmount;
      this._shortMargin -= marginToReturn;
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
   * Get current equity (cash + margin + unrealized PnL)
   * For leverage=1: identical to base Portfolio
   * For leverage>1: cash + (margin + unrealizedPnL) for each position
   */
  get equity(): number {
    // For leverage=1, use parent calculation (identical behavior)
    if (this._leverage === 1) {
      return super.equity;
    }

    // Leverage > 1: include margin and unrealized PnL
    let total = this._cash;

    if (this._longPosition) {
      // Long equity: margin + unrealized PnL
      total += this._longMargin + this._longPosition.unrealizedPnl;
    }

    if (this._shortPosition) {
      // Short equity: margin + unrealized PnL
      total += this._shortMargin + this._shortPosition.unrealizedPnl;
    }

    return total;
  }

  /**
   * Update price and check for liquidation
   * For leverage=1: identical to base Portfolio
   * For leverage>1: also checks liquidation condition
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

    // Check for liquidation (only for leverage > 1)
    if (this._leverage > 1) {
      this.checkLiquidation(price);
    }
  }

  /**
   * Check if position should be liquidated
   * Liquidation occurs when: margin + unrealizedPnL < margin * maintenanceMarginRate
   * i.e., losses exceed (1 - maintenanceMarginRate) of initial margin
   */
  private checkLiquidation(price: number): void {
    const timestamp = Date.now(); // Use current time for liquidation

    // Check long position liquidation
    if (this._longPosition) {
      const unrealizedPnl = this._longPosition.unrealizedPnl;
      const maintenanceMargin = this._longMargin * this._maintenanceMarginRate;
      const currentMargin = this._longMargin + unrealizedPnl;

      if (currentMargin < maintenanceMargin) {
        // Liquidate long position
        const { amount, id: positionId, entryPrice } = this._longPosition;

        // Calculate final PnL (no fee on liquidation as it's forced)
        const grossPnl = (price - entryPrice) * amount;
        const pnl = grossPnl; // No fee on liquidation
        const pnlPercent = ((price - entryPrice) / entryPrice) * 100;

        // Liquidation gives back only the remaining margin value
        this._cash += Math.max(0, currentMargin);

        // Clear position
        this._longPosition = null;
        this._longMargin = 0;

        // Create liquidation trade
        this._liquidationTrade = {
          id: uuidv4(),
          symbol: this.symbol,
          action: 'CLOSE_LONG',
          price,
          amount,
          timestamp,
          pnl,
          pnlPercent,
          closedPositionId: positionId,
          balanceAfter: this._cash,
        };

        this._trades.push(this._liquidationTrade);
      }
    }

    // Check short position liquidation
    if (this._shortPosition) {
      const unrealizedPnl = this._shortPosition.unrealizedPnl;
      const maintenanceMargin = this._shortMargin * this._maintenanceMarginRate;
      const currentMargin = this._shortMargin + unrealizedPnl;

      if (currentMargin < maintenanceMargin) {
        // Liquidate short position
        const { amount, id: positionId, entryPrice } = this._shortPosition;

        // Calculate final PnL (no fee on liquidation)
        const grossPnl = (entryPrice - price) * amount;
        const pnl = grossPnl;
        const pnlPercent = ((entryPrice - price) / entryPrice) * 100;

        // Liquidation gives back only the remaining margin value
        this._cash += Math.max(0, currentMargin);

        // Clear position
        this._shortPosition = null;
        this._shortMargin = 0;

        // Create liquidation trade
        this._liquidationTrade = {
          id: uuidv4(),
          symbol: this.symbol,
          action: 'CLOSE_SHORT',
          price,
          amount,
          timestamp,
          pnl,
          pnlPercent,
          closedPositionId: positionId,
          balanceAfter: this._cash,
        };

        this._trades.push(this._liquidationTrade);
      }
    }
  }

  /**
   * Reset portfolio to initial state
   */
  override reset(): void {
    super.reset();
    this._longMargin = 0;
    this._shortMargin = 0;
    this._liquidationTrade = null;
  }
}
