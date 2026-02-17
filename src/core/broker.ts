/**
 * Broker module for simulating order execution
 * Handles order filling and execution logic in backtesting
 */

import { v4 as uuidv4 } from 'uuid';
import type { Order, Candle, OrderType, Trade, TradeAction } from './types.js';
import { Portfolio } from './portfolio.js';

/**
 * Order request with explicit trade action
 */
export interface OrderRequest {
  symbol: string;
  action: TradeAction;
  type: OrderType;
  amount: number;
  price?: number; // For limit orders
}

/**
 * Internal order representation
 */
interface InternalOrder extends Order {
  action: TradeAction;
}

/**
 * Broker configuration
 */
export interface BrokerConfig {
  /**
   * Slippage as a percentage (e.g., 0.1 for 0.1%)
   * Applied to market orders
   */
  slippagePercent?: number;

  /**
   * Commission per trade as a percentage (e.g., 0.1 for 0.1%)
   * Applied to both entry and exit
   * @deprecated Use feeRate instead for more accurate exchange fee modeling
   */
  commissionPercent?: number;

  /**
   * Trading fee rate as a decimal (e.g., 0.001 for 0.1%)
   * This is the actual exchange fee rate (taker fee for market orders)
   * Applied to trade value and deducted from cash
   */
  feeRate?: number;

  /**
   * Whether this is a prediction market (prices must stay between 0 and 1)
   */
  isPredictionMarket?: boolean;
}

/**
 * Default broker configuration
 */
const DEFAULT_CONFIG: BrokerConfig = {
  slippagePercent: 0,
  commissionPercent: 0,
  feeRate: 0,
};

/**
 * Broker class for simulating order execution
 */
export class Broker {
  private readonly portfolio: Portfolio;
  private readonly config: BrokerConfig;
  private pendingOrders: InternalOrder[] = [];

  constructor(portfolio: Portfolio, config: BrokerConfig = {}) {
    this.portfolio = portfolio;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create and queue a new order
   * @param request - Order request details
   * @param timestamp - Order creation timestamp
   * @returns The created order
   */
  createOrder(request: OrderRequest, timestamp: number): Order {
    // Derive side from action for order tracking
    const side = request.action === 'OPEN_LONG' || request.action === 'CLOSE_SHORT'
      ? 'buy'
      : 'sell';

    const order: InternalOrder = {
      id: uuidv4(),
      symbol: request.symbol,
      side,
      action: request.action,
      type: request.type,
      amount: request.amount,
      price: request.price,
      status: 'pending',
      createdAt: timestamp,
    };

    this.pendingOrders.push(order);
    return order;
  }

  /**
   * Process pending orders against the current candle
   * Called at the end of each bar
   * @param candle - Current candle data
   * @returns Array of filled orders and resulting trades
   */
  processPendingOrders(candle: Candle): { orders: Order[]; trades: Trade[] } {
    const filledOrders: Order[] = [];
    const trades: Trade[] = [];
    const remainingOrders: InternalOrder[] = [];

    for (const order of this.pendingOrders) {
      const result = this.tryFillOrder(order, candle);

      if (result.filled) {
        filledOrders.push(result.order);
        if (result.trade) {
          trades.push(result.trade);
        }
      } else {
        // Keep unfilled orders (e.g., limit orders that haven't triggered)
        remainingOrders.push(order);
      }
    }

    this.pendingOrders = remainingOrders;
    return { orders: filledOrders, trades };
  }

  /**
   * Try to fill a single order
   */
  private tryFillOrder(
    order: InternalOrder,
    candle: Candle
  ): { filled: boolean; order: Order; trade: Trade | null } {
    let fillPrice: number;

    if (order.type === 'market') {
      // Market orders fill at the close price with slippage
      fillPrice = this.applySlippage(candle.close, order.side);
    } else if (order.type === 'limit' && order.price !== undefined) {
      // Limit orders fill if price is reached
      if (order.side === 'buy' && candle.low <= order.price) {
        fillPrice = Math.min(order.price, candle.high);
      } else if (order.side === 'sell' && candle.high >= order.price) {
        fillPrice = Math.max(order.price, candle.low);
      } else {
        return { filled: false, order, trade: null };
      }
    } else {
      return { filled: false, order, trade: null };
    }

    // Apply commission to fill price (legacy behavior)
    fillPrice = this.applyCommission(fillPrice, order.side);

    // Get the fee rate for portfolio operations
    const feeRate = this.config.feeRate ?? 0;

    // Execute the order based on action
    let trade: Trade | null = null;

    try {
      switch (order.action) {
        case 'OPEN_LONG':
          trade = this.portfolio.openLong(order.amount, fillPrice, candle.timestamp, feeRate);
          break;

        case 'CLOSE_LONG':
          trade = this.portfolio.closeLong(order.amount, fillPrice, candle.timestamp, feeRate);
          break;

        case 'OPEN_SHORT':
          trade = this.portfolio.openShort(order.amount, fillPrice, candle.timestamp, feeRate);
          break;

        case 'CLOSE_SHORT':
          trade = this.portfolio.closeShort(order.amount, fillPrice, candle.timestamp, feeRate);
          break;
      }

      // Record slippage cost on the trade
      if (trade && fillPrice !== candle.close) {
        trade.slippage = Math.abs(fillPrice - candle.close) * (trade.amount || order.amount);
      }

      // Update order status
      const filledOrder: Order = {
        ...order,
        status: 'filled',
        filledAt: candle.timestamp,
        filledPrice: fillPrice,
      };

      return { filled: true, order: filledOrder, trade };
    } catch {
      // Order failed (e.g., insufficient funds, no position to close)
      const cancelledOrder: Order = {
        ...order,
        status: 'cancelled',
      };
      return { filled: true, order: cancelledOrder, trade: null };
    }
  }

  /**
   * Apply slippage to a fill price
   */
  private applySlippage(price: number, side: 'buy' | 'sell'): number {
    const slippage = this.config.slippagePercent ?? 0;
    if (slippage === 0) return price;

    // Slippage works against the trader
    let slippedPrice: number;
    if (side === 'buy') {
      slippedPrice = price * (1 + slippage / 100);
    } else {
      slippedPrice = price * (1 - slippage / 100);
    }

    // Clamp for prediction markets
    if (this.config.isPredictionMarket) {
      slippedPrice = Math.max(0.001, Math.min(0.999, slippedPrice));
    }

    return slippedPrice;
  }

  /**
   * Apply commission to a fill price
   */
  private applyCommission(price: number, side: 'buy' | 'sell'): number {
    const commission = this.config.commissionPercent ?? 0;
    if (commission === 0) return price;

    // Commission works against the trader
    if (side === 'buy') {
      return price * (1 + commission / 100);
    } else {
      return price * (1 - commission / 100);
    }
  }

  /**
   * Cancel all pending orders
   */
  cancelAllOrders(): Order[] {
    const cancelled = this.pendingOrders.map((order) => ({
      ...order,
      status: 'cancelled' as const,
    }));
    this.pendingOrders = [];
    return cancelled;
  }

  /**
   * Cancel a specific order
   */
  cancelOrder(orderId: string): Order | null {
    const index = this.pendingOrders.findIndex((o) => o.id === orderId);
    if (index === -1) return null;

    const [order] = this.pendingOrders.splice(index, 1);
    return { ...order, status: 'cancelled' };
  }

  /**
   * Get all pending orders
   */
  getPendingOrders(): Order[] {
    return [...this.pendingOrders];
  }

  /**
   * Check if there are any pending orders
   */
  hasPendingOrders(): boolean {
    return this.pendingOrders.length > 0;
  }
}
