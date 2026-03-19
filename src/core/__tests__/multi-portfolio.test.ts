/**
 * Tests for MultiSymbolPortfolio class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MultiSymbolPortfolio } from '../multi-portfolio.js';

const BTC = 'BTC/USDT';
const ETH = 'ETH/USDT';
const SOL = 'SOL/USDT';

const NOW = 1_700_000_000_000; // arbitrary fixed timestamp

describe('MultiSymbolPortfolio', () => {
  let portfolio: MultiSymbolPortfolio;
  const initialCapital = 10_000;

  beforeEach(() => {
    portfolio = new MultiSymbolPortfolio(initialCapital);
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should initialise with correct cash and equity', () => {
      expect(portfolio.cash).toBe(initialCapital);
      expect(portfolio.balance).toBe(initialCapital);
      expect(portfolio.equity).toBe(initialCapital);
      expect(portfolio.initialCapital).toBe(initialCapital);
    });

    it('should start with no positions', () => {
      expect(portfolio.hasAnyPosition()).toBe(false);
      expect(portfolio.getPositionCount()).toBe(0);
      expect(portfolio.trades).toHaveLength(0);
    });

    it('should throw when initial capital is not positive', () => {
      expect(() => new MultiSymbolPortfolio(0)).toThrow('Initial capital must be positive');
      expect(() => new MultiSymbolPortfolio(-100)).toThrow('Initial capital must be positive');
    });
  });

  // -------------------------------------------------------------------------
  // Long positions
  // -------------------------------------------------------------------------

  describe('openLong', () => {
    it('should open a long position and deduct cost + fee from cash', () => {
      // Buy 0.5 BTC at $10,000 with 0.1% fee
      // Cost: 0.5 * 10000 = 5000, fee: 5000 * 0.001 = 5, total = 5005
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0.001);

      expect(portfolio.cash).toBeCloseTo(initialCapital - 5_005, 6);
    });

    it('should record an OPEN_LONG trade', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0.001);

      const trades = portfolio.trades;
      expect(trades).toHaveLength(1);
      expect(trades[0].action).toBe('OPEN_LONG');
      expect(trades[0].symbol).toBe(BTC);
      expect(trades[0].amount).toBe(0.5);
      expect(trades[0].price).toBe(10_000);
      expect(trades[0].fee).toBeCloseTo(5, 6);
      expect(trades[0].feeRate).toBe(0.001);
    });

    it('should track position via getPositionForSymbol', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);

      const { longPosition, shortPosition } = portfolio.getPositionForSymbol(BTC);
      expect(longPosition).not.toBeNull();
      expect(longPosition?.side).toBe('long');
      expect(longPosition?.amount).toBe(0.5);
      expect(longPosition?.entryPrice).toBe(10_000);
      expect(shortPosition).toBeNull();
    });

    it('should throw when a long is already open for that symbol', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      expect(() => portfolio.openLong(BTC, 0.1, 10_000, NOW)).toThrow(
        /Cannot open long for BTC\/USDT/,
      );
    });

    it('should throw on insufficient funds', () => {
      // Try to buy 1 BTC at $10,000 = $10,000 cost (no cash left for fee)
      expect(() => portfolio.openLong(BTC, 1, 10_000, NOW, 0.001)).toThrow(
        /Insufficient funds/,
      );
    });

    it('should allow independent long positions in different symbols', () => {
      // $3000 for BTC, $2000 for ETH → $5000 total, within $10k budget
      portfolio.openLong(BTC, 0.3, 10_000, NOW); // costs 3000
      portfolio.openLong(ETH, 1, 2_000, NOW);    // costs 2000

      expect(portfolio.getPositionCount()).toBe(2);
      expect(portfolio.hasAnyPosition()).toBe(true);
      expect(portfolio.cash).toBeCloseTo(5_000, 6);
    });
  });

  describe('closeLong', () => {
    it('should close a long position and add proceeds minus fee to cash', () => {
      // Open: 0.5 BTC at $10,000 → cash = 10000 - 5000 = 5000
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      const cashAfterOpen = portfolio.cash;

      // Close: 0.5 BTC at $11,000 with 0.1% fee
      // Proceeds: 0.5 * 11000 = 5500, fee: 5500 * 0.001 = 5.5
      // Net proceeds: 5494.5
      const trade = portfolio.closeLong(BTC, 'all', 11_000, NOW + 1, 0.001);

      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 5_500 - 5.5, 6);
      expect(trade.action).toBe('CLOSE_LONG');
      expect(trade.pnl).toBeCloseTo((11_000 - 10_000) * 0.5 - 5.5, 6); // gross PnL - exit fee
      expect(trade.pnlPercent).toBeCloseTo(10, 6); // 10% price increase
    });

    it('should clear the position after full close', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      portfolio.closeLong(BTC, 'all', 11_000, NOW + 1);

      expect(portfolio.getPositionForSymbol(BTC).longPosition).toBeNull();
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should support partial close', () => {
      portfolio.openLong(BTC, 1, 5_000, NOW); // costs 5000

      portfolio.closeLong(BTC, 0.5, 5_000, NOW + 1);

      const { longPosition } = portfolio.getPositionForSymbol(BTC);
      expect(longPosition).not.toBeNull();
      expect(longPosition?.amount).toBe(0.5);
    });

    it('should throw when closing a symbol with no long position', () => {
      expect(() => portfolio.closeLong(BTC, 'all', 10_000, NOW)).toThrow(
        /Cannot close long for BTC\/USDT/,
      );
    });

    it('should record a CLOSE_LONG trade with closedPositionId', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      const openTrade = portfolio.trades[0];

      portfolio.closeLong(BTC, 'all', 11_000, NOW + 1);
      const closeTrade = portfolio.trades[1];

      expect(closeTrade.action).toBe('CLOSE_LONG');
      expect(closeTrade.closedPositionId).toBe(openTrade.id);
    });
  });

  // -------------------------------------------------------------------------
  // Short positions
  // -------------------------------------------------------------------------

  describe('openShort', () => {
    it('should open a short position deducting the full notional collateral + fee from cash', () => {
      // Short 1 ETH at $2,000, fee rate 0.1% → collateral = 2000, fee = 2, total = 2002
      portfolio.openShort(ETH, 1, 2_000, NOW, 0.001);

      expect(portfolio.cash).toBeCloseTo(initialCapital - 2_002, 6);
    });

    it('should record an OPEN_SHORT trade', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW, 0.001);

      const trades = portfolio.trades;
      expect(trades).toHaveLength(1);
      expect(trades[0].action).toBe('OPEN_SHORT');
      expect(trades[0].symbol).toBe(ETH);
      expect(trades[0].fee).toBeCloseTo(2, 6);
    });

    it('should throw when a short is already open for that symbol', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);
      expect(() => portfolio.openShort(ETH, 1, 2_000, NOW)).toThrow(
        /Cannot open short for ETH\/USDT/,
      );
    });

    it('should throw when total cost (collateral + fee) exceeds available cash', () => {
      const tiny = new MultiSymbolPortfolio(1); // only $1
      // Collateral + fee on $2000 notional at 0.1% = $2002 > $1 cash
      expect(() => tiny.openShort(ETH, 1, 2_000, NOW, 0.001)).toThrow(
        /Insufficient funds for short/,
      );
    });
  });

  describe('closeShort', () => {
    it('should close a short at a profit when price drops', () => {
      // Short 1 ETH at $2,000, fee=0 → collateral locked = 2000, cash = 10000 - 2000 = 8000
      portfolio.openShort(ETH, 1, 2_000, NOW);
      const cashAfterOpen = portfolio.cash; // 8000

      // Close at $1,800 → gross PnL = (2000 - 1800) * 1 = 200
      // Fee on exit: 1800 * 1 * 0.001 = 1.8 → net PnL = 198.2
      // Cash returned: collateral(2000) + grossPnL(200) - exitFee(1.8) = 2198.2
      const trade = portfolio.closeShort(ETH, 'all', 1_800, NOW + 1, 0.001);

      expect(trade.action).toBe('CLOSE_SHORT');
      expect(trade.pnl).toBeCloseTo(200 - 1.8, 6);
      expect(trade.pnlPercent).toBeCloseTo(10, 6); // (2000-1800)/2000 * 100
      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 2_000 + 200 - 1.8, 6);
    });

    it('should close a short at a loss when price rises', () => {
      // Short 1 ETH at $2,000, fee=0 → collateral locked = 2000, cash = 10000 - 2000 = 8000
      portfolio.openShort(ETH, 1, 2_000, NOW);
      const cashAfterOpen = portfolio.cash; // 8000

      // Close at $2,200 → gross PnL = (2000 - 2200) * 1 = -200
      // Fee: 2200 * 0.001 = 2.2 → net PnL = -202.2
      // Cash returned: collateral(2000) + grossPnL(-200) - exitFee(2.2) = 1797.8
      const trade = portfolio.closeShort(ETH, 'all', 2_200, NOW + 1, 0.001);

      expect(trade.pnl).toBeCloseTo(-202.2, 6);
      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 2_000 - 200 - 2.2, 6);
    });

    it('should clear the short position after full close', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);
      portfolio.closeShort(ETH, 'all', 1_800, NOW + 1);

      expect(portfolio.getPositionForSymbol(ETH).shortPosition).toBeNull();
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should throw when closing a symbol with no short position', () => {
      expect(() => portfolio.closeShort(ETH, 'all', 2_000, NOW)).toThrow(
        /Cannot close short for ETH\/USDT/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Equity calculation
  // -------------------------------------------------------------------------

  describe('equity', () => {
    it('should include long position value at current price', () => {
      // Buy 0.5 BTC at $10,000 → cash = 5000
      portfolio.openLong(BTC, 0.5, 10_000, NOW);

      // Price moves to $12,000 → long value = 0.5 * 12000 = 6000
      portfolio.updatePrice(BTC, 12_000);

      expect(portfolio.equity).toBeCloseTo(5_000 + 6_000, 6); // cash + long value
    });

    it('should include short unrealized PnL at current price', () => {
      // Short 1 ETH at $2,000, fee=0 → collateral locked = 2000, cash = 10000 - 2000 = 8000
      portfolio.openShort(ETH, 1, 2_000, NOW); // fee = 0
      expect(portfolio.cash).toBe(initialCapital - 2_000);

      // Price drops to $1,500 → unrealized PnL = (2000-1500)*1 = 500
      portfolio.updatePrice(ETH, 1_500);

      // equity = cash(8000) + collateral(2000) + unrealizedPnL(500) = 10500
      expect(portfolio.equity).toBeCloseTo(initialCapital + 500, 6);
    });

    it('should sum equity across multiple symbols correctly', () => {
      // Open positions in BTC and ETH
      // BTC long: 0.1 BTC at $10,000 → cost 1000, no fee, cash = 9000
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      // ETH short: 1 ETH at $2,000, fee=0 → collateral locked = 2000, cash = 9000 - 2000 = 7000
      portfolio.openShort(ETH, 1, 2_000, NOW);

      const cashAfterBothOpen = portfolio.cash; // 10000 - 1000 - 2000 = 7000

      // BTC moves to $11,000 → long value = 0.1 * 11000 = 1100
      portfolio.updatePrice(BTC, 11_000);
      // ETH moves to $1,800 → short collateral(2000) + unrealizedPnL(200) = 2200
      portfolio.updatePrice(ETH, 1_800);

      // equity = cash(7000) + long_value(1100) + short_equity(collateral 2000 + unrealizedPnl 200) = 10300
      const expectedEquity = cashAfterBothOpen + 1_100 + 2_200;
      expect(portfolio.equity).toBeCloseTo(expectedEquity, 6);
    });

    it('should not change equity when updatePrice is called on an unused symbol', () => {
      const equityBefore = portfolio.equity;
      portfolio.updatePrice(SOL, 100);
      expect(portfolio.equity).toBeCloseTo(equityBefore, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Position count / hasAnyPosition
  // -------------------------------------------------------------------------

  describe('getPositionCount / hasAnyPosition', () => {
    it('should count each open long and short separately', () => {
      expect(portfolio.getPositionCount()).toBe(0);

      portfolio.openLong(BTC, 0.1, 10_000, NOW);   // +1
      expect(portfolio.getPositionCount()).toBe(1);

      portfolio.openShort(ETH, 1, 2_000, NOW);      // +1
      expect(portfolio.getPositionCount()).toBe(2);

      portfolio.openLong(SOL, 10, 100, NOW);         // +1 (costs 1000)
      expect(portfolio.getPositionCount()).toBe(3);
    });

    it('should decrement after closing a position', () => {
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      portfolio.openShort(ETH, 1, 2_000, NOW);

      portfolio.closeLong(BTC, 'all', 10_000, NOW + 1);
      expect(portfolio.getPositionCount()).toBe(1);

      portfolio.closeShort(ETH, 'all', 2_000, NOW + 1);
      expect(portfolio.getPositionCount()).toBe(0);
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should return true for hasAnyPosition when at least one position is open', () => {
      expect(portfolio.hasAnyPosition()).toBe(false);

      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      expect(portfolio.hasAnyPosition()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Funding payments
  // -------------------------------------------------------------------------

  describe('applyFundingPayment', () => {
    it('should add positive payment to cash', () => {
      portfolio.applyFundingPayment(50);
      expect(portfolio.cash).toBe(initialCapital + 50);
    });

    it('should deduct negative payment from cash', () => {
      portfolio.applyFundingPayment(-30);
      expect(portfolio.cash).toBe(initialCapital - 30);
    });

    it('should affect equity via the shared cash pool', () => {
      portfolio.applyFundingPayment(100);
      expect(portfolio.equity).toBe(initialCapital + 100);
    });

    it('should be independent of any open positions', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW); // cash = 5000
      const cashAfterOpen = portfolio.cash;

      portfolio.applyFundingPayment(75);
      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 75, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Trade accumulation
  // -------------------------------------------------------------------------

  describe('trades', () => {
    it('should collect all trades across all symbols in insertion order', () => {
      portfolio.openLong(BTC, 0.1, 10_000, NOW);       // trade 0
      portfolio.openShort(ETH, 1, 2_000, NOW + 1);      // trade 1
      portfolio.closeLong(BTC, 'all', 11_000, NOW + 2); // trade 2
      portfolio.closeShort(ETH, 'all', 1_800, NOW + 3); // trade 3

      const trades = portfolio.trades;
      expect(trades).toHaveLength(4);
      expect(trades[0].action).toBe('OPEN_LONG');
      expect(trades[1].action).toBe('OPEN_SHORT');
      expect(trades[2].action).toBe('CLOSE_LONG');
      expect(trades[3].action).toBe('CLOSE_SHORT');
    });

    it('should return a copy of the trades array (not a reference)', () => {
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      const copy = portfolio.trades;
      copy.push({ ...copy[0], id: 'fake' });
      // Internal array should not be mutated
      expect(portfolio.trades).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('should restore initial state', () => {
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      portfolio.openShort(ETH, 1, 2_000, NOW);
      portfolio.applyFundingPayment(200);

      portfolio.reset();

      expect(portfolio.cash).toBe(initialCapital);
      expect(portfolio.equity).toBe(initialCapital);
      expect(portfolio.hasAnyPosition()).toBe(false);
      expect(portfolio.getPositionCount()).toBe(0);
      expect(portfolio.trades).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Simultaneous long and short on different symbols
  // -------------------------------------------------------------------------

  describe('simultaneous long and short across different symbols', () => {
    it('should manage both correctly and maintain accurate equity', () => {
      // Long BTC: 0.1 at $10,000 → cost $1,000, cash = $9,000
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      // Short ETH: 2 at $2,000, fee=0 → collateral = $4,000 locked, cash = $9,000 - $4,000 = $5,000
      portfolio.openShort(ETH, 2, 2_000, NOW);

      // BTC drops to $9,000 → long value = 0.1 * 9000 = 900 (loss of 100)
      portfolio.updatePrice(BTC, 9_000);
      // ETH drops to $1,700 → short collateral(4000) + unrealizedPnL(600) = 4600
      portfolio.updatePrice(ETH, 1_700);

      // equity = cash(5000) + long_value(900) + short_equity(4600) = 10500
      expect(portfolio.equity).toBeCloseTo(5_000 + 900 + 4_600, 6);

      // Close BTC long at $9,000 → proceeds = 0.1*9000 = 900, cash = 5000 + 900 = 5900
      portfolio.closeLong(BTC, 'all', 9_000, NOW + 1);
      // Close ETH short at $1,700, fee=0:
      //   collateral(4000) + grossPnL(600) - exitFee(0) = 4600
      //   cash = 5900 + 4600 = 10500
      portfolio.closeShort(ETH, 'all', 1_700, NOW + 2);

      expect(portfolio.cash).toBeCloseTo(10_500, 6);
      expect(portfolio.hasAnyPosition()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should open long and short on the same symbol simultaneously', () => {
      // Open both sides for BTC (hedged position)
      portfolio.openLong(BTC, 0.2, 5_000, NOW);   // cost 1000
      portfolio.openShort(BTC, 0.2, 5_000, NOW);  // fee = 0

      expect(portfolio.getPositionCount()).toBe(2);
      const { longPosition, shortPosition } = portfolio.getPositionForSymbol(BTC);
      expect(longPosition).not.toBeNull();
      expect(shortPosition).not.toBeNull();
    });

    it('should get empty position for an unknown symbol', () => {
      const { longPosition, shortPosition } = portfolio.getPositionForSymbol('UNKNOWN/USDT');
      expect(longPosition).toBeNull();
      expect(shortPosition).toBeNull();
    });

    it('should throw when closing more than position amount', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      expect(() => portfolio.closeLong(BTC, 1, 10_000, NOW + 1)).toThrow(
        /Cannot close 1/,
      );
    });

    it('should work with zero fee rate (no fee field in trade)', () => {
      const trade = portfolio.openLong(BTC, 0.1, 10_000, NOW, 0);
      expect(trade.fee).toBeUndefined();
      expect(trade.feeRate).toBeUndefined();
    });

    it('should throw when price is not positive', () => {
      expect(() => portfolio.openLong(BTC, 0.1, 0, NOW)).toThrow('Price must be positive');
      expect(() => portfolio.openShort(ETH, 1, -100, NOW)).toThrow('Price must be positive');
      expect(() => portfolio.updatePrice(BTC, 0)).toThrow('Price must be positive');
    });

    it('should throw when amount is not positive', () => {
      expect(() => portfolio.openLong(BTC, 0, 10_000, NOW)).toThrow('Amount must be positive');
      expect(() => portfolio.openShort(ETH, -1, 2_000, NOW)).toThrow('Amount must be positive');
    });
  });

  // -------------------------------------------------------------------------
  // Short position partial close
  // -------------------------------------------------------------------------

  describe('closeShort - partial close', () => {
    it('should reduce remaining short position amount after partial close', () => {
      // Short 2 ETH at $2,000 → full position amount = 2
      portfolio.openShort(ETH, 2, 2_000, NOW);

      // Close half (1 ETH)
      portfolio.closeShort(ETH, 1, 2_000, NOW + 1);

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition).not.toBeNull();
      expect(shortPosition?.amount).toBeCloseTo(1, 10);
    });

    it('should calculate PnL only on the partial amount closed', () => {
      // Short 2 ETH at $2,000 each
      // Close 1 ETH at $1,800 → grossPnl = (2000-1800)*1 = 200, fee = 1800*1*0.001 = 1.8
      // Expected net pnl = 200 - 1.8 = 198.2
      portfolio.openShort(ETH, 2, 2_000, NOW);

      const trade = portfolio.closeShort(ETH, 1, 1_800, NOW + 1, 0.001);

      expect(trade.pnl).toBeCloseTo(198.2, 6);
      expect(trade.amount).toBe(1);
    });

    it('should return only proportional cash for partial short close', () => {
      // Short 2 ETH at $2,000, fee=0 → cash locked = 4000, cash = 10000-4000 = 6000
      portfolio.openShort(ETH, 2, 2_000, NOW);
      const cashAfterOpen = portfolio.cash; // 6000

      // Close 1 ETH at $1,800 → collateral returned = 2000*1 = 2000
      //   grossPnl = (2000-1800)*1 = 200, fee = 0
      //   cash += 2000 + 200 = 2200
      portfolio.closeShort(ETH, 1, 1_800, NOW + 1, 0);

      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 2_200, 6);
    });

    it('should throw when closing a short with amount exceeding position', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);
      expect(() => portfolio.closeShort(ETH, 2, 2_000, NOW + 1)).toThrow(/Cannot close 2/);
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip PnL accuracy (critical for production)
  // -------------------------------------------------------------------------

  describe('round-trip PnL accuracy', () => {
    it('long round-trip profit: open $100, close $120, 0.1% fee, exact PnL', () => {
      // Buy 10 units at $100 → cost = 1000, fee = 1000*0.001 = 1, total = 1001
      portfolio.openLong(BTC, 10, 100, NOW, 0.001);
      const cashAfterOpen = portfolio.cash; // 10000 - 1001 = 8999

      // Sell 10 units at $120 → proceeds = 1200, exitFee = 1200*0.001 = 1.2
      // grossPnl = (120-100)*10 = 200, pnl = 200 - 1.2 = 198.8
      const trade = portfolio.closeLong(BTC, 'all', 120, NOW + 1, 0.001);

      const exitFee = 10 * 120 * 0.001; // 1.2
      const expectedPnl = (120 - 100) * 10 - exitFee; // 200 - 1.2 = 198.8
      expect(trade.pnl).toBeCloseTo(expectedPnl, 6);

      // Cash: cashAfterOpen + proceeds - exitFee
      const expectedCash = cashAfterOpen + 10 * 120 - exitFee;
      expect(portfolio.cash).toBeCloseTo(expectedCash, 6);
    });

    it('short round-trip profit: open $200, close $180, 0.1% fee, exact PnL', () => {
      // Short 5 units at $200 → collateral = 1000, fee = 1000*0.001 = 1, total = 1001
      portfolio.openShort(ETH, 5, 200, NOW, 0.001);
      const cashAfterOpen = portfolio.cash; // 10000 - 1001 = 8999

      // Close at $180 → exitFee = 5*180*0.001 = 0.9
      // grossPnl = (200-180)*5 = 100, pnl = 100 - 0.9 = 99.1
      const trade = portfolio.closeShort(ETH, 'all', 180, NOW + 1, 0.001);

      const exitFee = 5 * 180 * 0.001; // 0.9
      const expectedPnl = (200 - 180) * 5 - exitFee; // 100 - 0.9 = 99.1
      expect(trade.pnl).toBeCloseTo(expectedPnl, 6);

      // Cash: cashAfterOpen + collateral + grossPnl - exitFee
      const collateral = 5 * 200;
      const grossPnl = (200 - 180) * 5;
      const expectedCash = cashAfterOpen + collateral + grossPnl - exitFee;
      expect(portfolio.cash).toBeCloseTo(expectedCash, 6);
    });

    it('long round-trip at loss: open $100, close $80, exact negative PnL', () => {
      // Buy 10 units at $100 → cost = 1000, fee = 0
      portfolio.openLong(BTC, 10, 100, NOW, 0);
      const cashAfterOpen = portfolio.cash; // 9000

      // Sell at $80 → grossPnl = (80-100)*10 = -200, fee = 0
      const trade = portfolio.closeLong(BTC, 'all', 80, NOW + 1, 0);

      expect(trade.pnl).toBeCloseTo(-200, 6);
      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 10 * 80, 6); // 9000 + 800 = 9800
    });

    it('short round-trip at loss: open $200, close $220, exact negative PnL', () => {
      // Short 5 units at $200 → collateral = 1000, fee = 0
      portfolio.openShort(ETH, 5, 200, NOW, 0);
      const cashAfterOpen = portfolio.cash; // 9000

      // Close at $220 → grossPnl = (200-220)*5 = -100, fee = 0
      const trade = portfolio.closeShort(ETH, 'all', 220, NOW + 1, 0);

      expect(trade.pnl).toBeCloseTo(-100, 6);
      // cash = cashAfterOpen + collateral(1000) + grossPnl(-100) - exitFee(0)
      expect(portfolio.cash).toBeCloseTo(cashAfterOpen + 1_000 - 100, 6); // 9900
    });

    it('long round-trip: cash after full cycle equals initialCapital - entryFee - exitFee + grossPnl', () => {
      const amount = 2;
      const entryPrice = 500;
      const exitPrice = 600;
      const feeRate = 0.001;

      const entryFee = amount * entryPrice * feeRate; // 1.0
      const exitFee = amount * exitPrice * feeRate;   // 1.2
      const grossPnl = (exitPrice - entryPrice) * amount; // 200

      portfolio.openLong(BTC, amount, entryPrice, NOW, feeRate);
      portfolio.closeLong(BTC, 'all', exitPrice, NOW + 1, feeRate);

      const expectedCash = initialCapital - entryFee - exitFee + grossPnl;
      expect(portfolio.cash).toBeCloseTo(expectedCash, 6);
    });

    it('short round-trip: cash after full cycle equals initialCapital - entryFee - exitFee + grossPnl', () => {
      const amount = 3;
      const entryPrice = 300;
      const exitPrice = 270; // price dropped → profit
      const feeRate = 0.001;

      const entryFee = amount * entryPrice * feeRate; // 0.9
      const exitFee = amount * exitPrice * feeRate;   // 0.81
      const grossPnl = (entryPrice - exitPrice) * amount; // 90

      portfolio.openShort(ETH, amount, entryPrice, NOW, feeRate);
      portfolio.closeShort(ETH, 'all', exitPrice, NOW + 1, feeRate);

      const expectedCash = initialCapital - entryFee - exitFee + grossPnl;
      expect(portfolio.cash).toBeCloseTo(expectedCash, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Equity calculation edge cases
  // -------------------------------------------------------------------------

  describe('equity edge cases', () => {
    it('should compute equity correctly with only short positions and price movement', () => {
      // Short 1 ETH at $2,000, fee=0 → collateral = 2000, cash = 8000
      portfolio.openShort(ETH, 1, 2_000, NOW);

      // Price rises to $2,500 → unrealizedPnl = (2000-2500)*1 = -500
      // equity = cash(8000) + collateral(2000) + unrealizedPnl(-500) = 9500
      portfolio.updatePrice(ETH, 2_500);

      expect(portfolio.equity).toBeCloseTo(initialCapital - 500, 6); // 9500
    });

    it('should compute equity correctly with both long and short on SAME symbol (hedged)', () => {
      // Long 0.5 BTC at $10,000 → cost = 5000, cash = 5000
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      // Short 0.5 BTC at $10,000, fee=0 → collateral = 5000, cash = 0
      portfolio.openShort(BTC, 0.5, 10_000, NOW);

      expect(portfolio.cash).toBeCloseTo(0, 6);

      // Price moves to $12,000
      // Long value = 0.5 * 12000 = 6000
      // Short: collateral(5000) + unrealizedPnl((10000-12000)*0.5) = 5000 - 1000 = 4000
      // equity = cash(0) + long(6000) + short_equity(4000) = 10000
      portfolio.updatePrice(BTC, 12_000);

      expect(portfolio.equity).toBeCloseTo(initialCapital, 6); // hedged → equity unchanged
    });

    it('should compute equity correctly with 3 symbols open simultaneously', () => {
      // BTC long: 0.1 at $10,000 → cost 1000, cash = 9000
      portfolio.openLong(BTC, 0.1, 10_000, NOW);
      // ETH long: 1 at $2,000 → cost 2000, cash = 7000
      portfolio.openLong(ETH, 1, 2_000, NOW);
      // SOL short: 10 at $100, fee=0 → collateral = 1000, cash = 6000
      portfolio.openShort(SOL, 10, 100, NOW);

      const cashAfterAll = portfolio.cash; // 6000

      // Prices move: BTC→$11,000, ETH→$2,200, SOL→$90
      portfolio.updatePrice(BTC, 11_000);
      portfolio.updatePrice(ETH, 2_200);
      portfolio.updatePrice(SOL, 90);

      const longBtcValue = 0.1 * 11_000; // 1100
      const longEthValue = 1 * 2_200;    // 2200
      // SOL short: collateral(1000) + unrealizedPnl((100-90)*10) = 1000 + 100 = 1100
      const shortSolEquity = 1_000 + (100 - 90) * 10; // 1100

      const expectedEquity = cashAfterAll + longBtcValue + longEthValue + shortSolEquity;
      expect(portfolio.equity).toBeCloseTo(expectedEquity, 6); // 6000+1100+2200+1100 = 10400
    });

    it('should equal cash after full close (zero open positions)', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      portfolio.updatePrice(BTC, 12_000);
      portfolio.closeLong(BTC, 'all', 12_000, NOW + 1);

      // No positions open → equity must equal cash exactly
      expect(portfolio.equity).toBeCloseTo(portfolio.cash, 10);
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should reflect price update in equity then match cash after close', () => {
      // Open long: 1 unit at $100
      portfolio.openLong(BTC, 1, 100, NOW, 0);
      const cashAfterOpen = portfolio.cash; // 9900

      // Price rises to $150 → equity = 9900 + 1*150 = 10050
      portfolio.updatePrice(BTC, 150);
      expect(portfolio.equity).toBeCloseTo(cashAfterOpen + 150, 6);

      // Close at $150, fee=0 → cash = 9900 + 150 = 10050
      portfolio.closeLong(BTC, 'all', 150, NOW + 1, 0);

      expect(portfolio.equity).toBeCloseTo(portfolio.cash, 10);
      expect(portfolio.cash).toBeCloseTo(10_050, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Fee edge cases
  // -------------------------------------------------------------------------

  describe('fee edge cases', () => {
    it('should correctly deduct high fee rate (5%) on long open', () => {
      // Buy 1 unit at $100, 5% fee → cost = 100, fee = 5, total = 105
      portfolio.openLong(BTC, 1, 100, NOW, 0.05);
      expect(portfolio.cash).toBeCloseTo(initialCapital - 105, 6);
    });

    it('should correctly deduct high fee rate (5%) on short open', () => {
      // Short 1 unit at $100, 5% fee → collateral = 100, fee = 5, total = 105
      portfolio.openShort(ETH, 1, 100, NOW, 0.05);
      expect(portfolio.cash).toBeCloseTo(initialCapital - 105, 6);
    });

    it('should record correct fee on very small position', () => {
      // Buy 0.001 units at $100, 0.1% fee → cost = 0.1, fee = 0.0001, total = 0.1001
      const trade = portfolio.openLong(BTC, 0.001, 100, NOW, 0.001);
      expect(trade.fee).toBeCloseTo(0.0001, 10);
      expect(portfolio.cash).toBeCloseTo(initialCapital - 0.1001, 10);
    });

    it('should account for both entry and exit fees in total cost across round-trip', () => {
      const amount = 1;
      const price = 1_000;
      const feeRate = 0.001;
      const entryFee = amount * price * feeRate; // 1.0
      const exitFee = amount * price * feeRate;  // 1.0 (same price)

      portfolio.openLong(BTC, amount, price, NOW, feeRate);
      const openTrade = portfolio.trades[0];

      portfolio.closeLong(BTC, 'all', price, NOW + 1, feeRate);
      const closeTrade = portfolio.trades[1];

      // At break-even price, total fees are deducted as loss
      expect(openTrade.fee).toBeCloseTo(entryFee, 6);
      expect(closeTrade.fee).toBeCloseTo(exitFee, 6);

      // Net PnL = 0 gross - exitFee → negative (fees eaten profit)
      expect(closeTrade.pnl).toBeCloseTo(-exitFee, 6);

      // Final cash = initialCapital - entryFee - exitFee (break-even price → no gross PnL)
      expect(portfolio.cash).toBeCloseTo(initialCapital - entryFee - exitFee, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Funding payment interactions
  // -------------------------------------------------------------------------

  describe('funding payment interactions with positions', () => {
    it('should not change position amount or unrealizedPnl when funding payment applied', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);
      portfolio.updatePrice(BTC, 11_000);

      const { longPosition: before } = portfolio.getPositionForSymbol(BTC);
      const unrealizedBefore = before?.unrealizedPnl;

      portfolio.applyFundingPayment(200);

      const { longPosition: after } = portfolio.getPositionForSymbol(BTC);
      expect(after?.amount).toBeCloseTo(before?.amount ?? 0, 10);
      expect(after?.unrealizedPnl).toBeCloseTo(unrealizedBefore ?? 0, 10);
    });

    it('updatePrice sets correct unrealizedPnl on shortPosition (positive when price drops)', () => {
      // Short 1 ETH at $2,000
      portfolio.openShort(ETH, 1, 2_000, NOW);

      // Price drops to $1,500 → unrealized profit = (2000 - 1500) * 1 = +500
      portfolio.updatePrice(ETH, 1_500);

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition).not.toBeNull();
      // Short gains when price drops: unrealizedPnl = (entryPrice - currentPrice) * amount = +500
      expect(shortPosition!.unrealizedPnl).toBeCloseTo(500, 6);
    });

    it('updatePrice sets correct unrealizedPnl on shortPosition (negative when price rises)', () => {
      // Short 2 ETH at $2,000
      portfolio.openShort(ETH, 2, 2_000, NOW);

      // Price rises to $2,500 → unrealized loss = (2000 - 2500) * 2 = -1000
      portfolio.updatePrice(ETH, 2_500);

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition!.unrealizedPnl).toBeCloseTo(-1_000, 6);
    });

    it('updatePrice sets unrealizedPnl = 0 for short when price equals entryPrice', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);
      portfolio.updatePrice(ETH, 2_000); // same price

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition!.unrealizedPnl).toBeCloseTo(0, 10);
    });

    it('should allow negative funding payment that pushes cash below zero', () => {
      // Start with $10,000 cash, drain with large negative payment
      portfolio.applyFundingPayment(-15_000);
      // The implementation does not guard against negative cash
      expect(portfolio.cash).toBeCloseTo(initialCapital - 15_000, 6); // -5000
    });

    it('should accumulate multiple funding payments correctly', () => {
      portfolio.applyFundingPayment(100);
      portfolio.applyFundingPayment(-40);
      portfolio.applyFundingPayment(25);

      // Net = 100 - 40 + 25 = 85
      expect(portfolio.cash).toBeCloseTo(initialCapital + 85, 6);
    });

    it('should affect equity through the cash pool when positions are open', () => {
      // Open long: 0.5 BTC at $10,000, fee=0 → cash = 5000
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0);
      portfolio.updatePrice(BTC, 10_000); // no price change

      const equityBefore = portfolio.equity; // 5000 + 0.5*10000 = 10000

      portfolio.applyFundingPayment(300);

      // equity should now be 10000 + 300 = 10300
      expect(portfolio.equity).toBeCloseTo(equityBefore + 300, 6);
    });
  });

  // -------------------------------------------------------------------------
  // canAfford() testing
  // -------------------------------------------------------------------------

  describe('canAfford', () => {
    it('should return true when cash exactly covers the cost', () => {
      // initialCapital = 10000, check 10000 / 1 unit at $10000
      expect(portfolio.canAfford(1, 10_000)).toBe(true);
    });

    it('should return true when cash more than covers the cost', () => {
      expect(portfolio.canAfford(0.5, 10_000)).toBe(true); // costs 5000 < 10000
    });

    it('should return false when cost exceeds available cash', () => {
      expect(portfolio.canAfford(2, 10_000)).toBe(false); // costs 20000 > 10000
    });

    it('should return false after opening a position that reduces cash', () => {
      // Open long: 0.9 BTC at $10,000, fee=0 → cash = 1000
      portfolio.openLong(BTC, 0.9, 10_000, NOW, 0);
      // Now cash = 1000; can we afford 0.2 BTC at $10,000? costs 2000 > 1000
      expect(portfolio.canAfford(0.2, 10_000)).toBe(false);
    });

    it('should return true for zero amount regardless of price', () => {
      // 0 * any price = 0 ≤ cash → canAfford is true
      expect(portfolio.canAfford(0, 10_000)).toBe(true);
    });

    it('should return true for zero price regardless of amount', () => {
      // amount * 0 = 0 ≤ cash → canAfford is true
      expect(portfolio.canAfford(100, 0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getTotalReturnPercent() testing
  // -------------------------------------------------------------------------

  describe('getTotalReturnPercent', () => {
    it('should return 0 when no trades have been made', () => {
      // equity == initialCapital → return = 0%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(0, 6);
    });

    it('should return correct positive percentage after a profitable long trade', () => {
      // Buy 1 unit at $1,000, fee=0 → cash = 9000, equity = 10000
      portfolio.openLong(BTC, 1, 1_000, NOW, 0);
      // Price rises 20% to $1,200
      portfolio.updatePrice(BTC, 1_200);
      // equity = 9000 + 1*1200 = 10200 → return = (10200-10000)/10000 * 100 = 2%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(2, 6);
    });

    it('should return correct negative percentage after a losing long trade', () => {
      // Buy 1 unit at $1,000, fee=0 → cash = 9000
      portfolio.openLong(BTC, 1, 1_000, NOW, 0);
      // Price drops 10% to $900
      portfolio.updatePrice(BTC, 900);
      // equity = 9000 + 900 = 9900 → return = (9900-10000)/10000 * 100 = -1%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(-1, 6);
    });

    it('should return correct return after closing all positions', () => {
      // Buy 1 unit at $1,000, fee=0
      portfolio.openLong(BTC, 1, 1_000, NOW, 0);
      // Close at $1,500 → proceeds = 1500, cash = 9000+1500 = 10500
      portfolio.closeLong(BTC, 'all', 1_500, NOW + 1, 0);

      // equity == cash == 10500 → return = (10500-10000)/10000 * 100 = 5%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(5, 6);
    });

    it('should aggregate return across multiple symbols', () => {
      // Long BTC: 0.1 at $10,000, fee=0 → cost 1000, cash = 9000
      portfolio.openLong(BTC, 0.1, 10_000, NOW, 0);
      // Short ETH: 1 at $2,000, fee=0 → collateral 2000, cash = 7000
      portfolio.openShort(ETH, 1, 2_000, NOW, 0);

      // BTC up to $11,000 → long unrealized = +100
      portfolio.updatePrice(BTC, 11_000);
      // ETH up to $2,200 → short unrealized = -200
      portfolio.updatePrice(ETH, 2_200);

      // equity = cash(7000) + btcLong(0.1*11000=1100) + ethShort(collateral 2000 + unrealizedPnl -200 = 1800)
      // = 7000 + 1100 + 1800 = 9900
      // return = (9900-10000)/10000 * 100 = -1%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(-1, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases for position operations
  // -------------------------------------------------------------------------

  describe('position operation edge cases', () => {
    it('should clear long position when close amount exactly equals position amount', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW);

      // Explicitly pass exact amount (not 'all')
      portfolio.closeLong(BTC, 0.5, 10_000, NOW + 1);

      const { longPosition } = portfolio.getPositionForSymbol(BTC);
      expect(longPosition).toBeNull();
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should clear short position when close amount exactly equals position amount', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);

      // Explicitly pass exact amount (not 'all')
      portfolio.closeShort(ETH, 1, 2_000, NOW + 1);

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition).toBeNull();
      expect(portfolio.hasAnyPosition()).toBe(false);
    });

    it('should set closedPositionId on CLOSE_SHORT to match original OPEN_SHORT id', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW);
      const openTrade = portfolio.trades[0];

      portfolio.closeShort(ETH, 'all', 2_000, NOW + 1);
      const closeTrade = portfolio.trades[1];

      expect(closeTrade.action).toBe('CLOSE_SHORT');
      expect(closeTrade.closedPositionId).toBe(openTrade.id);
    });

    it('should set balanceAfter in OPEN_LONG trade to the correct cash after open', () => {
      // Buy 0.5 BTC at $10,000, fee=0 → cash = 5000
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0);
      const trade = portfolio.trades[0];

      expect(trade.balanceAfter).toBeCloseTo(portfolio.cash, 6);
      expect(trade.balanceAfter).toBeCloseTo(initialCapital - 5_000, 6);
    });

    it('should set balanceAfter in CLOSE_LONG trade to the correct cash after close', () => {
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0);
      portfolio.closeLong(BTC, 'all', 10_000, NOW + 1, 0);

      const closeTrade = portfolio.trades[1];
      // Back to initial capital since no price change and no fees
      expect(closeTrade.balanceAfter).toBeCloseTo(portfolio.cash, 6);
      expect(closeTrade.balanceAfter).toBeCloseTo(initialCapital, 6);
    });

    it('should set balanceAfter in OPEN_SHORT trade to the correct cash after open', () => {
      // Short 1 ETH at $2,000, fee=0 → cash = 8000
      portfolio.openShort(ETH, 1, 2_000, NOW, 0);
      const trade = portfolio.trades[0];

      expect(trade.balanceAfter).toBeCloseTo(portfolio.cash, 6);
      expect(trade.balanceAfter).toBeCloseTo(initialCapital - 2_000, 6);
    });

    it('should set balanceAfter in CLOSE_SHORT trade to the correct cash after close', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW, 0);
      portfolio.closeShort(ETH, 'all', 2_000, NOW + 1, 0);

      const closeTrade = portfolio.trades[1];
      expect(closeTrade.balanceAfter).toBeCloseTo(portfolio.cash, 6);
      expect(closeTrade.balanceAfter).toBeCloseTo(initialCapital, 6);
    });

    it('should allow re-opening a long after full close (position recycling)', () => {
      // Open → close → re-open same symbol
      portfolio.openLong(BTC, 0.5, 10_000, NOW, 0);
      portfolio.closeLong(BTC, 'all', 10_000, NOW + 1, 0);

      // Should not throw on re-open
      expect(() => portfolio.openLong(BTC, 0.2, 9_000, NOW + 2, 0)).not.toThrow();

      const { longPosition } = portfolio.getPositionForSymbol(BTC);
      expect(longPosition).not.toBeNull();
      expect(longPosition?.amount).toBeCloseTo(0.2, 10);
      expect(longPosition?.entryPrice).toBe(9_000);
    });

    it('should allow re-opening a short after full close (position recycling)', () => {
      portfolio.openShort(ETH, 1, 2_000, NOW, 0);
      portfolio.closeShort(ETH, 'all', 2_000, NOW + 1, 0);

      expect(() => portfolio.openShort(ETH, 0.5, 1_800, NOW + 2, 0)).not.toThrow();

      const { shortPosition } = portfolio.getPositionForSymbol(ETH);
      expect(shortPosition).not.toBeNull();
      expect(shortPosition?.amount).toBeCloseTo(0.5, 10);
      expect(shortPosition?.entryPrice).toBe(1_800);
    });
  });
});
