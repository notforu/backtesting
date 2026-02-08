/**
 * Tests for LeveragedPortfolio class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LeveragedPortfolio } from '../leveraged-portfolio.js';

describe('LeveragedPortfolio', () => {
  let portfolio: LeveragedPortfolio;
  const initialCapital = 10000;
  const symbol = 'BTC/USDT';

  describe('Leverage = 1 (should match base Portfolio)', () => {
    beforeEach(() => {
      portfolio = new LeveragedPortfolio(initialCapital, symbol, 1);
    });

    it('should behave identically to base Portfolio for leverage=1', () => {
      // Open long with $10k capital, 1x leverage
      const openTrade = portfolio.openLong(0.5, 10000, Date.now(), 0.001);

      expect(openTrade.amount).toBe(0.5);
      expect(openTrade.price).toBe(10000);

      // Should deduct full notional (0.5 * 10000 = 5000) + fee (5000 * 0.001 = 5)
      expect(portfolio.balance).toBe(10000 - 5000 - 5);
      expect(portfolio.equity).toBe(10000 - 5); // Cash + position value

      // Close long
      portfolio.updatePrice(11000);
      const closeTrade = portfolio.closeLong('all', 11000, Date.now(), 0.001);

      expect(closeTrade.pnl).toBeCloseTo(500 - 11000 * 0.5 * 0.001, 2); // Profit - exit fee
    });

    it('should open and close short position', () => {
      const openTrade = portfolio.openShort(0.5, 10000, Date.now(), 0.001);

      expect(openTrade.amount).toBe(0.5);
      expect(portfolio.balance).toBe(10000 - 5); // Fee only for shorts

      portfolio.updatePrice(9000);
      const closeTrade = portfolio.closeShort('all', 9000, Date.now(), 0.001);

      // Short profit: (10000 - 9000) * 0.5 = 500, minus exit fee
      expect(closeTrade.pnl).toBeCloseTo(500 - 9000 * 0.5 * 0.001, 2);
    });
  });

  describe('Leverage = 10x', () => {
    beforeEach(() => {
      portfolio = new LeveragedPortfolio(initialCapital, symbol, 10);
    });

    it('should only require margin = notional / leverage for opening', () => {
      // Open 1 BTC at $10,000 with 10x leverage
      // Notional: 1 * 10000 = $10,000
      // Margin: 10000 / 10 = $1,000
      // Fee: 10000 * 0.001 = $10
      const openTrade = portfolio.openLong(1, 10000, Date.now(), 0.001);

      expect(openTrade.amount).toBe(1);
      expect(portfolio.balance).toBeCloseTo(10000 - 1000 - 10, 2); // Cash after margin + fee
      expect(portfolio.equity).toBeCloseTo(10000 - 10, 2); // Initial - fee
    });

    it('should calculate leveraged PnL correctly', () => {
      // Open 1 BTC at $10,000 with 10x leverage
      portfolio.openLong(1, 10000, Date.now(), 0.001);

      // Price increases 10% to $11,000
      portfolio.updatePrice(11000);

      // Unrealized PnL: (11000 - 10000) * 1 = $1,000 (100% return on $1,000 margin)
      const longPos = portfolio.longPosition;
      expect(longPos?.unrealizedPnl).toBe(1000);

      // Equity: cash (9000 - 10) + margin (1000) + unrealized PnL (1000) = 10990
      expect(portfolio.equity).toBeCloseTo(10990, 2);
    });

    it('should close position and return margin + PnL', () => {
      portfolio.openLong(1, 10000, Date.now(), 0.001);
      portfolio.updatePrice(11000);

      const closeTrade = portfolio.closeLong('all', 11000, Date.now(), 0.001);

      // PnL: (11000 - 10000) * 1 - exit fee (11000 * 0.001) = 1000 - 11 = 989
      expect(closeTrade.pnl).toBeCloseTo(989, 2);

      // Cash: original (9000 - 10) + margin returned (1000) + PnL (989) = 10979
      expect(portfolio.balance).toBeCloseTo(10979, 2);
      expect(portfolio.longPosition).toBeNull();
    });

    it('should liquidate position when losses exceed threshold', () => {
      // Open with 10x leverage, maintenance margin = 50%
      portfolio.openLong(1, 10000, Date.now(), 0.001);

      // Initial margin: $1,000
      // Maintenance margin: $1,000 * 0.5 = $500
      // Liquidation when: margin + unrealizedPnL < $500
      // i.e., unrealizedPnL < -$500

      // Price drops from $10,000 to $9,400 (6% drop)
      // Unrealized loss: (9400 - 10000) * 1 = -$600
      portfolio.updatePrice(9400);

      // Should be liquidated
      expect(portfolio.wasLiquidated).toBe(true);
      expect(portfolio.longPosition).toBeNull();

      const liqTrade = portfolio.getLiquidationTrade();
      expect(liqTrade).not.toBeNull();
      expect(liqTrade?.action).toBe('CLOSE_LONG');
      expect(liqTrade?.pnl).toBeCloseTo(-600, 2);
    });

    it('should handle short position liquidation', () => {
      portfolio.openShort(1, 10000, Date.now(), 0.001);

      // Price increases from $10,000 to $10,600 (6% increase)
      // Unrealized loss: (10000 - 10600) * 1 = -$600
      portfolio.updatePrice(10600);

      // Should be liquidated
      expect(portfolio.wasLiquidated).toBe(true);
      expect(portfolio.shortPosition).toBeNull();

      const liqTrade = portfolio.getLiquidationTrade();
      expect(liqTrade).not.toBeNull();
      expect(liqTrade?.action).toBe('CLOSE_SHORT');
      expect(liqTrade?.pnl).toBeCloseTo(-600, 2);
    });

    it('should not liquidate when losses are within threshold', () => {
      portfolio.openLong(1, 10000, Date.now(), 0.001);

      // Price drops 4% to $9,600
      // Unrealized loss: -$400
      // Current margin: $1,000 - $400 = $600 > maintenance ($500)
      portfolio.updatePrice(9600);

      expect(portfolio.wasLiquidated).toBe(false);
      expect(portfolio.longPosition).not.toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should reject invalid leverage values', () => {
      expect(() => new LeveragedPortfolio(10000, symbol, 0)).toThrow();
      expect(() => new LeveragedPortfolio(10000, symbol, 126)).toThrow();
      expect(() => new LeveragedPortfolio(10000, symbol, -1)).toThrow();
    });

    it('should reject invalid maintenance margin rate', () => {
      expect(() => new LeveragedPortfolio(10000, symbol, 10, -0.1)).toThrow();
      expect(() => new LeveragedPortfolio(10000, symbol, 10, 1.1)).toThrow();
    });

    it('should handle insufficient funds for leveraged position', () => {
      portfolio = new LeveragedPortfolio(1000, symbol, 10);

      // Try to open 1 BTC position (margin = 1000, fee = 10)
      // Need $1,010, but only have $1,000
      expect(() => {
        portfolio.openLong(1, 10000, Date.now(), 0.001);
      }).toThrow('Insufficient funds');
    });

    it('should reset correctly', () => {
      portfolio = new LeveragedPortfolio(10000, symbol, 10);
      portfolio.openLong(1, 10000, Date.now(), 0.001);
      portfolio.updatePrice(9000);

      portfolio.reset();

      expect(portfolio.balance).toBe(10000);
      expect(portfolio.equity).toBe(10000);
      expect(portfolio.longPosition).toBeNull();
      expect(portfolio.shortPosition).toBeNull();
      expect(portfolio.trades).toHaveLength(0);
    });
  });
});
