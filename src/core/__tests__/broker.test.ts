/**
 * Unit tests for the Broker class
 * Covers: market orders, limit orders, slippage, commission, feeRate,
 *         order lifecycle, cancellation, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Broker } from '../broker.js';
import { Portfolio } from '../portfolio.js';
import type { Candle } from '../types.js';

const SYMBOL = 'BTC/USDT';
const NOW = 1_700_000_000_000;
const INITIAL = 10_000;

/**
 * Helper to build a minimal candle
 */
function makeCandle(
  close: number,
  opts: { open?: number; high?: number; low?: number; volume?: number; timestamp?: number } = {}
): Candle {
  const { open = close, high = close, low = close, volume = 1000, timestamp = NOW } = opts;
  return { timestamp, open, high, low, close, volume };
}

describe('Broker', () => {
  let portfolio: Portfolio;
  let broker: Broker;

  beforeEach(() => {
    portfolio = new Portfolio(INITIAL, SYMBOL);
    broker = new Broker(portfolio);
  });

  // ---------------------------------------------------------------------------
  // createOrder
  // ---------------------------------------------------------------------------

  describe('createOrder', () => {
    it('creates a market order with status "pending"', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      expect(order.status).toBe('pending');
      expect(order.type).toBe('market');
      expect(order.amount).toBe(0.5);
      expect(order.symbol).toBe(SYMBOL);
    });

    it('assigns side "buy" for OPEN_LONG action', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      expect(order.side).toBe('buy');
    });

    it('assigns side "buy" for CLOSE_SHORT action', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'CLOSE_SHORT', type: 'market', amount: 0.5 },
        NOW
      );
      expect(order.side).toBe('buy');
    });

    it('assigns side "sell" for CLOSE_LONG action', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      expect(order.side).toBe('sell');
    });

    it('assigns side "sell" for OPEN_SHORT action', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_SHORT', type: 'market', amount: 0.5 },
        NOW
      );
      expect(order.side).toBe('sell');
    });

    it('creates a limit order with the given price', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'limit', amount: 0.5, price: 9_500 },
        NOW
      );
      expect(order.type).toBe('limit');
      expect(order.price).toBe(9_500);
    });

    it('generates a unique id for each order', () => {
      const o1 = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      const o2 = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      expect(o1.id).not.toBe(o2.id);
    });

    it('increases pending order count', () => {
      expect(broker.hasPendingOrders()).toBe(false);
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      expect(broker.hasPendingOrders()).toBe(true);
      expect(broker.getPendingOrders()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // processPendingOrders — market orders
  // ---------------------------------------------------------------------------

  describe('processPendingOrders — market orders', () => {
    it('fills a market OPEN_LONG at candle close price (no slippage)', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const candle = makeCandle(10_000);
      const { orders, trades } = broker.processPendingOrders(candle);

      expect(orders).toHaveLength(1);
      expect(orders[0].status).toBe('filled');
      expect(orders[0].filledPrice).toBe(10_000);
      expect(trades).toHaveLength(1);
      expect(trades[0].action).toBe('OPEN_LONG');
      expect(trades[0].price).toBe(10_000);
    });

    it('fills a market CLOSE_LONG at candle close', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.5 }, NOW + 1);
      const candle = makeCandle(11_000, { timestamp: NOW + 1 });
      const { orders, trades } = broker.processPendingOrders(candle);

      expect(orders[0].status).toBe('filled');
      expect(trades[0].action).toBe('CLOSE_LONG');
      expect(trades[0].pnl).toBeCloseTo(500, 8);
    });

    it('fills a market OPEN_SHORT at candle close', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_SHORT', type: 'market', amount: 0.5 }, NOW);
      const candle = makeCandle(10_000);
      const { orders, trades } = broker.processPendingOrders(candle);

      expect(orders[0].status).toBe('filled');
      expect(trades[0].action).toBe('OPEN_SHORT');
    });

    it('fills a market CLOSE_SHORT at candle close', () => {
      portfolio.openShort(0.5, 10_000, NOW, 0);
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_SHORT', type: 'market', amount: 0.5 }, NOW + 1);
      const candle = makeCandle(9_000, { timestamp: NOW + 1 });
      const { orders, trades } = broker.processPendingOrders(candle);

      expect(orders[0].status).toBe('filled');
      expect(trades[0].action).toBe('CLOSE_SHORT');
      expect(trades[0].pnl).toBeCloseTo(500, 8);
    });

    it('removes the order from pending after fill', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      broker.processPendingOrders(makeCandle(10_000));
      expect(broker.hasPendingOrders()).toBe(false);
    });

    it('cancels the order (marks cancelled) when execution fails (insufficient funds)', () => {
      // Try to buy 2 BTC at $10,000 → costs $20,000 > $10,000 capital
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 2 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));

      expect(orders[0].status).toBe('cancelled');
    });

    it('fills multiple market orders in sequence', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.3 }, NOW);
      const candle = makeCandle(5_000);
      // Open at 5000, cost = 1500
      broker.processPendingOrders(candle);
      // Close that position
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.3 }, NOW + 1);
      const { orders } = broker.processPendingOrders(makeCandle(6_000, { timestamp: NOW + 1 }));
      expect(orders[0].status).toBe('filled');
    });

    it('records filledAt timestamp from the candle', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const candle = makeCandle(10_000, { timestamp: NOW + 5000 });
      const { orders } = broker.processPendingOrders(candle);
      expect(orders[0].filledAt).toBe(NOW + 5000);
    });
  });

  // ---------------------------------------------------------------------------
  // Slippage
  // ---------------------------------------------------------------------------

  describe('slippage', () => {
    it('buy market order fills above close price with positive slippage', () => {
      broker = new Broker(portfolio, { slippagePercent: 0.1 }); // 0.1%
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));
      // fillPrice = 10000 * (1 + 0.1/100) = 10010
      expect(orders[0].filledPrice).toBeCloseTo(10_010, 6);
    });

    it('sell market order fills below close price with positive slippage', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker = new Broker(portfolio, { slippagePercent: 0.1 });
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.5 }, NOW + 1);
      const { orders } = broker.processPendingOrders(makeCandle(10_000, { timestamp: NOW + 1 }));
      // fillPrice = 10000 * (1 - 0.1/100) = 9990
      expect(orders[0].filledPrice).toBeCloseTo(9_990, 6);
    });

    it('zero slippage uses exact close price', () => {
      broker = new Broker(portfolio, { slippagePercent: 0 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));
      expect(orders[0].filledPrice).toBe(10_000);
    });

    it('records slippage cost on the trade when slippage is non-zero', () => {
      broker = new Broker(portfolio, { slippagePercent: 0.1 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { trades } = broker.processPendingOrders(makeCandle(10_000));
      // slippage = |10010 - 10000| * 0.5 = 5
      expect(trades[0].slippage).toBeCloseTo(5, 6);
    });

    it('does not set slippage on trade when slippage is zero', () => {
      broker = new Broker(portfolio, { slippagePercent: 0 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { trades } = broker.processPendingOrders(makeCandle(10_000));
      // fillPrice == close → slippage field not set
      expect(trades[0].slippage).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Commission (legacy price adjustment)
  // ---------------------------------------------------------------------------

  describe('commission (commissionPercent)', () => {
    it('buy commission increases fill price', () => {
      broker = new Broker(portfolio, { commissionPercent: 1 }); // 1%
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));
      // fillPrice = 10000 * (1 + 1/100) = 10100
      expect(orders[0].filledPrice).toBeCloseTo(10_100, 6);
    });

    it('sell commission decreases fill price', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker = new Broker(portfolio, { commissionPercent: 1 });
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.5 }, NOW + 1);
      const { orders } = broker.processPendingOrders(makeCandle(10_000, { timestamp: NOW + 1 }));
      // fillPrice = 10000 * (1 - 1/100) = 9900
      expect(orders[0].filledPrice).toBeCloseTo(9_900, 6);
    });

    it('zero commission leaves fill price unchanged', () => {
      broker = new Broker(portfolio, { commissionPercent: 0 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));
      expect(orders[0].filledPrice).toBe(10_000);
    });
  });

  // ---------------------------------------------------------------------------
  // feeRate (portfolio-level fee)
  // ---------------------------------------------------------------------------

  describe('feeRate', () => {
    it('charges fee on open long at the given feeRate', () => {
      broker = new Broker(portfolio, { feeRate: 0.001 }); // 0.1%
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { trades } = broker.processPendingOrders(makeCandle(10_000));
      // fee = 0.5 * 10000 * 0.001 = 5
      expect(trades[0].fee).toBeCloseTo(5, 6);
    });

    it('charges fee on close long and deducts from trade PnL', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker = new Broker(portfolio, { feeRate: 0.001 });
      broker.createOrder({ symbol: SYMBOL, action: 'CLOSE_LONG', type: 'market', amount: 0.5 }, NOW + 1);
      const { trades } = broker.processPendingOrders(makeCandle(11_000, { timestamp: NOW + 1 }));
      // grossPnl = (11000-10000)*0.5 = 500, fee = 0.5*11000*0.001 = 5.5, pnl = 494.5
      expect(trades[0].pnl).toBeCloseTo(500 - 5.5, 6);
    });

    it('zero feeRate means no fee on trades', () => {
      broker = new Broker(portfolio, { feeRate: 0 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { trades } = broker.processPendingOrders(makeCandle(10_000));
      expect(trades[0].fee).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Limit orders
  // ---------------------------------------------------------------------------

  describe('limit orders', () => {
    it('fills a buy limit order when candle low <= limit price', () => {
      // Buy limit at $9,500; candle low = $9,400 → should fill
      broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'limit', amount: 0.5, price: 9_500 },
        NOW
      );
      const candle = makeCandle(10_000, { high: 10_000, low: 9_400 });
      const { orders } = broker.processPendingOrders(candle);
      expect(orders[0].status).toBe('filled');
      // fillPrice = min(limitPrice, candle.high) = min(9500, 10000) = 9500
      expect(orders[0].filledPrice).toBe(9_500);
    });

    it('does NOT fill a buy limit order when candle low > limit price', () => {
      broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'limit', amount: 0.5, price: 9_000 },
        NOW
      );
      // Candle never dips to 9000
      const candle = makeCandle(10_000, { high: 10_500, low: 9_500 });
      const { orders, trades } = broker.processPendingOrders(candle);
      expect(orders).toHaveLength(0); // no filled orders
      expect(trades).toHaveLength(0);
      expect(broker.hasPendingOrders()).toBe(true);
    });

    it('fills a sell limit order when candle high >= limit price', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker.createOrder(
        { symbol: SYMBOL, action: 'CLOSE_LONG', type: 'limit', amount: 0.5, price: 11_000 },
        NOW + 1
      );
      const candle = makeCandle(10_500, { high: 11_200, low: 10_000, timestamp: NOW + 1 });
      const { orders } = broker.processPendingOrders(candle);
      expect(orders[0].status).toBe('filled');
      // fillPrice = max(limitPrice, candle.low) = max(11000, 10000) = 11000
      expect(orders[0].filledPrice).toBe(11_000);
    });

    it('does NOT fill a sell limit order when candle high < limit price', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker.createOrder(
        { symbol: SYMBOL, action: 'CLOSE_LONG', type: 'limit', amount: 0.5, price: 12_000 },
        NOW + 1
      );
      const candle = makeCandle(11_000, { high: 11_500, low: 10_500, timestamp: NOW + 1 });
      const { orders, trades } = broker.processPendingOrders(candle);
      expect(orders).toHaveLength(0);
      expect(trades).toHaveLength(0);
      expect(broker.hasPendingOrders()).toBe(true);
    });

    it('keeps a limit order pending across multiple bars until triggered', () => {
      broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'limit', amount: 0.5, price: 9_000 },
        NOW
      );
      // Bar 1: price stays high — order not triggered
      broker.processPendingOrders(makeCandle(10_000, { high: 10_500, low: 9_500 }));
      expect(broker.hasPendingOrders()).toBe(true);
      // Bar 2: price dips — order triggered
      broker.processPendingOrders(makeCandle(9_800, { high: 10_000, low: 8_900 }));
      expect(broker.hasPendingOrders()).toBe(false);
    });

    it('a buy limit order exact match (low == limit price) fills', () => {
      broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'limit', amount: 0.5, price: 9_500 },
        NOW
      );
      const candle = makeCandle(10_000, { high: 10_000, low: 9_500 });
      const { orders } = broker.processPendingOrders(candle);
      expect(orders[0].status).toBe('filled');
    });

    it('a sell limit order exact match (high == limit price) fills', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      broker.createOrder(
        { symbol: SYMBOL, action: 'CLOSE_LONG', type: 'limit', amount: 0.5, price: 11_000 },
        NOW + 1
      );
      const candle = makeCandle(10_500, { high: 11_000, low: 10_000, timestamp: NOW + 1 });
      const { orders } = broker.processPendingOrders(candle);
      expect(orders[0].status).toBe('filled');
    });
  });

  // ---------------------------------------------------------------------------
  // cancelAllOrders / cancelOrder
  // ---------------------------------------------------------------------------

  describe('cancelAllOrders', () => {
    it('cancels all pending orders and clears the list', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_SHORT', type: 'market', amount: 0.2 }, NOW);
      const cancelled = broker.cancelAllOrders();
      expect(cancelled).toHaveLength(2);
      cancelled.forEach(o => expect(o.status).toBe('cancelled'));
      expect(broker.hasPendingOrders()).toBe(false);
    });

    it('returns empty array when no orders are pending', () => {
      const cancelled = broker.cancelAllOrders();
      expect(cancelled).toHaveLength(0);
    });
  });

  describe('cancelOrder', () => {
    it('cancels a specific order by id', () => {
      const order = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      const cancelled = broker.cancelOrder(order.id);
      expect(cancelled).not.toBeNull();
      expect(cancelled?.status).toBe('cancelled');
      expect(broker.hasPendingOrders()).toBe(false);
    });

    it('returns null when order id is not found', () => {
      const result = broker.cancelOrder('nonexistent-id');
      expect(result).toBeNull();
    });

    it('cancels only the matching order, leaving others pending', () => {
      const o1 = broker.createOrder(
        { symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 },
        NOW
      );
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_SHORT', type: 'market', amount: 0.2 }, NOW);
      broker.cancelOrder(o1.id);
      expect(broker.getPendingOrders()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getPendingOrders / hasPendingOrders
  // ---------------------------------------------------------------------------

  describe('getPendingOrders', () => {
    it('returns a copy — modifying result does not affect internal list', () => {
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const pending = broker.getPendingOrders();
      pending.pop();
      expect(broker.getPendingOrders()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined slippage + commission
  // ---------------------------------------------------------------------------

  describe('combined slippage and commission', () => {
    it('applies slippage first then commission on buy order', () => {
      broker = new Broker(portfolio, { slippagePercent: 0.1, commissionPercent: 0.5 });
      broker.createOrder({ symbol: SYMBOL, action: 'OPEN_LONG', type: 'market', amount: 0.5 }, NOW);
      const { orders } = broker.processPendingOrders(makeCandle(10_000));
      // Step 1: slippage → 10000 * (1+0.1/100) = 10010
      // Step 2: commission → 10010 * (1+0.5/100) = 10010 * 1.005 = 10060.05
      expect(orders[0].filledPrice).toBeCloseTo(10_060.05, 3);
    });
  });

  // ---------------------------------------------------------------------------
  // No-op when no pending orders
  // ---------------------------------------------------------------------------

  describe('processPendingOrders with no orders', () => {
    it('returns empty arrays when no orders are pending', () => {
      const { orders, trades } = broker.processPendingOrders(makeCandle(10_000));
      expect(orders).toHaveLength(0);
      expect(trades).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Prediction market slippage clamping
  // ---------------------------------------------------------------------------

  // prediction market slippage clamping tests removed — Polymarket support was removed
});
