/**
 * Unit tests for the Portfolio class
 * Covers: constructor, openLong, closeLong, openShort, closeShort,
 *         getEquity, updatePrice, applyFundingPayment, reset, canAfford,
 *         getTotalReturnPercent, getState — including all edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Portfolio } from '../portfolio.js';

const SYMBOL = 'BTC/USDT';
const NOW = 1_700_000_000_000;

describe('Portfolio', () => {
  let portfolio: Portfolio;
  const INITIAL = 10_000;

  beforeEach(() => {
    portfolio = new Portfolio(INITIAL, SYMBOL);
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initialises cash to the given initial capital', () => {
      expect(portfolio.cash).toBe(INITIAL);
      expect(portfolio.balance).toBe(INITIAL);
    });

    it('initialises equity equal to initial capital with no positions', () => {
      expect(portfolio.equity).toBe(INITIAL);
    });

    it('stores initialCapital as a public readonly value', () => {
      expect(portfolio.initialCapital).toBe(INITIAL);
    });

    it('starts with no long position', () => {
      expect(portfolio.hasLongPosition).toBe(false);
      expect(portfolio.longPosition).toBeNull();
    });

    it('starts with no short position', () => {
      expect(portfolio.hasShortPosition).toBe(false);
      expect(portfolio.shortPosition).toBeNull();
    });

    it('starts with empty trades array', () => {
      expect(portfolio.trades).toHaveLength(0);
    });

    it('throws when initial capital is zero', () => {
      expect(() => new Portfolio(0, SYMBOL)).toThrow('Initial capital must be positive');
    });

    it('throws when initial capital is negative', () => {
      expect(() => new Portfolio(-500, SYMBOL)).toThrow('Initial capital must be positive');
    });
  });

  // ---------------------------------------------------------------------------
  // openLong
  // ---------------------------------------------------------------------------

  describe('openLong', () => {
    it('deducts trade value from cash (no fee)', () => {
      // 0.5 BTC at $10,000 → cost = $5,000
      portfolio.openLong(0.5, 10_000, NOW);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 5_000, 8);
    });

    it('deducts trade value + fee from cash', () => {
      // 0.5 BTC at $10,000, fee 0.1% → cost = 5000 + 5 = 5005
      portfolio.openLong(0.5, 10_000, NOW, 0.001);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 5_005, 8);
    });

    it('creates a long position with correct fields', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      const pos = portfolio.longPosition;
      expect(pos).not.toBeNull();
      expect(pos?.side).toBe('long');
      expect(pos?.amount).toBe(0.5);
      expect(pos?.entryPrice).toBe(10_000);
      expect(pos?.entryTime).toBe(NOW);
      expect(pos?.symbol).toBe(SYMBOL);
      expect(pos?.unrealizedPnl).toBe(0);
    });

    it('sets hasLongPosition to true after open', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      expect(portfolio.hasLongPosition).toBe(true);
    });

    it('records an OPEN_LONG trade with correct fields', () => {
      portfolio.openLong(0.5, 10_000, NOW, 0.001);
      const trades = portfolio.trades;
      expect(trades).toHaveLength(1);
      const t = trades[0];
      expect(t.action).toBe('OPEN_LONG');
      expect(t.price).toBe(10_000);
      expect(t.amount).toBe(0.5);
      expect(t.symbol).toBe(SYMBOL);
      expect(t.timestamp).toBe(NOW);
      expect(t.fee).toBeCloseTo(5, 8);
      expect(t.feeRate).toBe(0.001);
      expect(t.balanceAfter).toBeCloseTo(portfolio.cash, 8);
    });

    it('does not include fee/feeRate fields when fee is zero', () => {
      const trade = portfolio.openLong(0.5, 10_000, NOW, 0);
      expect(trade.fee).toBeUndefined();
      expect(trade.feeRate).toBeUndefined();
    });

    it('throws when a long position is already open', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      expect(() => portfolio.openLong(0.1, 10_000, NOW)).toThrow(
        'Cannot open long: a long position is already open'
      );
    });

    it('throws on insufficient funds', () => {
      // 1 BTC at $10,000 with 0.1% fee → costs $10,010 > $10,000
      expect(() => portfolio.openLong(1, 10_000, NOW, 0.001)).toThrow('Insufficient funds');
    });

    it('throws on insufficient funds when exactly covering cost fails at fee', () => {
      // 1 BTC at $10,000 with 0% fee → costs exactly $10,000 (should succeed)
      expect(() => portfolio.openLong(1, 10_000, NOW, 0)).not.toThrow();
    });

    it('throws when amount is zero', () => {
      expect(() => portfolio.openLong(0, 10_000, NOW)).toThrow('Amount must be positive');
    });

    it('throws when amount is negative', () => {
      expect(() => portfolio.openLong(-1, 10_000, NOW)).toThrow('Amount must be positive');
    });

    it('throws when price is zero', () => {
      expect(() => portfolio.openLong(0.1, 0, NOW)).toThrow('Price must be positive');
    });

    it('throws when price is negative', () => {
      expect(() => portfolio.openLong(0.1, -100, NOW)).toThrow('Price must be positive');
    });

    it('updates currentPrice used for equity calculations', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      // equity = cash + long_value = 5000 + 0.5*10000 = 10000
      expect(portfolio.equity).toBeCloseTo(INITIAL, 8);
    });

    it('returns the trade record', () => {
      const trade = portfolio.openLong(0.5, 10_000, NOW);
      expect(trade.action).toBe('OPEN_LONG');
      expect(trade.id).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // closeLong
  // ---------------------------------------------------------------------------

  describe('closeLong', () => {
    beforeEach(() => {
      portfolio.openLong(0.5, 10_000, NOW); // cash = 5000, position = 0.5 BTC @ 10000
    });

    it('adds proceeds to cash on full close (profit scenario)', () => {
      // Close 0.5 BTC at $12,000, no fee → proceeds = 6000
      portfolio.closeLong('all', 12_000, NOW + 1);
      expect(portfolio.cash).toBeCloseTo(5_000 + 6_000, 8);
    });

    it('adds proceeds minus fee to cash on full close with fee', () => {
      // Close 0.5 BTC at $12,000, 0.1% fee → proceeds = 6000, fee = 6, net = 5994
      portfolio.closeLong('all', 12_000, NOW + 1, 0.001);
      expect(portfolio.cash).toBeCloseTo(5_000 + 6_000 - 6, 8);
    });

    it('calculates gross PnL minus exit fee for profit trade', () => {
      // grossPnl = (12000-10000)*0.5 = 1000, fee = 6000*0.001 = 6, pnl = 994
      const trade = portfolio.closeLong('all', 12_000, NOW + 1, 0.001);
      expect(trade.pnl).toBeCloseTo(1_000 - 6, 8);
    });

    it('calculates pnlPercent correctly for profit trade', () => {
      // pnlPercent = (12000-10000)/10000 * 100 = 20%
      const trade = portfolio.closeLong('all', 12_000, NOW + 1);
      expect(trade.pnlPercent).toBeCloseTo(20, 8);
    });

    it('calculates negative PnL for a losing trade', () => {
      // Close at $8,000 → grossPnl = (8000-10000)*0.5 = -1000, fee = 0, pnl = -1000
      const trade = portfolio.closeLong('all', 8_000, NOW + 1);
      expect(trade.pnl).toBeCloseTo(-1_000, 8);
    });

    it('calculates negative pnlPercent for a losing trade', () => {
      // (8000-10000)/10000 * 100 = -20%
      const trade = portfolio.closeLong('all', 8_000, NOW + 1);
      expect(trade.pnlPercent).toBeCloseTo(-20, 8);
    });

    it('clears long position after full close with "all"', () => {
      portfolio.closeLong('all', 12_000, NOW + 1);
      expect(portfolio.hasLongPosition).toBe(false);
      expect(portfolio.longPosition).toBeNull();
    });

    it('clears long position when exact amount passed', () => {
      portfolio.closeLong(0.5, 12_000, NOW + 1);
      expect(portfolio.hasLongPosition).toBe(false);
    });

    it('supports partial close — reduces position amount', () => {
      portfolio.closeLong(0.2, 11_000, NOW + 1);
      const pos = portfolio.longPosition;
      expect(pos).not.toBeNull();
      expect(pos?.amount).toBeCloseTo(0.3, 8);
    });

    it('records a CLOSE_LONG trade with closedPositionId', () => {
      const openTrade = portfolio.trades[0];
      portfolio.closeLong('all', 12_000, NOW + 1);
      const closeTrade = portfolio.trades[1];
      expect(closeTrade.action).toBe('CLOSE_LONG');
      expect(closeTrade.closedPositionId).toBe(openTrade.id);
    });

    it('does not include fee/feeRate when zero', () => {
      const trade = portfolio.closeLong('all', 12_000, NOW + 1, 0);
      expect(trade.fee).toBeUndefined();
      expect(trade.feeRate).toBeUndefined();
    });

    it('throws when no long position is open', () => {
      const p = new Portfolio(INITIAL, SYMBOL);
      expect(() => p.closeLong('all', 10_000, NOW)).toThrow('Cannot close long: no long position is open');
    });

    it('throws when close amount exceeds position amount', () => {
      expect(() => portfolio.closeLong(0.6, 10_000, NOW + 1)).toThrow(
        'Cannot close 0.6, only 0.5 available'
      );
    });

    it('throws when price is zero', () => {
      expect(() => portfolio.closeLong('all', 0, NOW + 1)).toThrow('Price must be positive');
    });

    it('fees eat all profit at breakeven price', () => {
      // Open: 0.5 BTC at $10,000, fee=0
      // Close: 0.5 BTC at $10,000, fee 0.1% → fee = 5, grossPnl = 0 → pnl = -5
      const trade = portfolio.closeLong('all', 10_000, NOW + 1, 0.001);
      expect(trade.pnl).toBeCloseTo(-5, 8);
      // cash = 5000 + 5000 - 5 = 9995
      expect(portfolio.cash).toBeCloseTo(9_995, 8);
    });

    it('balanceAfter in the close trade matches portfolio cash', () => {
      portfolio.closeLong('all', 11_000, NOW + 1);
      const closeTrade = portfolio.trades[1];
      expect(closeTrade.balanceAfter).toBeCloseTo(portfolio.cash, 8);
    });
  });

  // ---------------------------------------------------------------------------
  // openShort
  // ---------------------------------------------------------------------------

  describe('openShort (non-prediction market)', () => {
    it('only deducts fee from cash (no collateral locked for traditional short)', () => {
      // Short 1 BTC at $10,000, fee 0.1% → fee = 10, cash = 10000 - 10 = 9990
      portfolio.openShort(1, 10_000, NOW, 0.001);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 10, 8);
    });

    it('does not change cash when fee is zero', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      expect(portfolio.cash).toBeCloseTo(INITIAL, 8);
    });

    it('creates a short position with correct fields', () => {
      portfolio.openShort(1, 10_000, NOW);
      const pos = portfolio.shortPosition;
      expect(pos).not.toBeNull();
      expect(pos?.side).toBe('short');
      expect(pos?.amount).toBe(1);
      expect(pos?.entryPrice).toBe(10_000);
      expect(pos?.entryTime).toBe(NOW);
      expect(pos?.symbol).toBe(SYMBOL);
    });

    it('sets hasShortPosition to true after open', () => {
      portfolio.openShort(1, 10_000, NOW);
      expect(portfolio.hasShortPosition).toBe(true);
    });

    it('records an OPEN_SHORT trade with correct fields', () => {
      portfolio.openShort(0.5, 10_000, NOW, 0.001);
      const trade = portfolio.trades[0];
      expect(trade.action).toBe('OPEN_SHORT');
      expect(trade.price).toBe(10_000);
      expect(trade.amount).toBe(0.5);
      expect(trade.fee).toBeCloseTo(5, 8); // 0.5 * 10000 * 0.001
    });

    it('throws when a short position is already open', () => {
      portfolio.openShort(1, 10_000, NOW);
      expect(() => portfolio.openShort(1, 10_000, NOW)).toThrow(
        'Cannot open short: a short position is already open'
      );
    });

    it('throws when fee exceeds available cash', () => {
      const tiny = new Portfolio(0.5, SYMBOL); // only $0.50
      // fee = 1 * 10000 * 0.001 = 10 > 0.50
      expect(() => tiny.openShort(1, 10_000, NOW, 0.001)).toThrow('Insufficient funds');
    });

    it('throws when amount is zero', () => {
      expect(() => portfolio.openShort(0, 10_000, NOW)).toThrow('Amount must be positive');
    });

    it('throws when amount is negative', () => {
      expect(() => portfolio.openShort(-1, 10_000, NOW)).toThrow('Amount must be positive');
    });

    it('throws when price is zero', () => {
      expect(() => portfolio.openShort(1, 0, NOW)).toThrow('Price must be positive');
    });

    it('returns the trade record', () => {
      const trade = portfolio.openShort(0.5, 10_000, NOW);
      expect(trade.id).toBeDefined();
      expect(trade.action).toBe('OPEN_SHORT');
    });
  });

  // ---------------------------------------------------------------------------
  // closeShort
  // ---------------------------------------------------------------------------

  describe('closeShort (non-prediction market)', () => {
    beforeEach(() => {
      portfolio.openShort(1, 10_000, NOW); // fee=0, cash stays at 10000
    });

    it('adds gross PnL to cash when price drops (profit)', () => {
      // grossPnl = (10000-9000)*1 = 1000, fee = 0 → cash += 1000
      portfolio.closeShort('all', 9_000, NOW + 1);
      expect(portfolio.cash).toBeCloseTo(INITIAL + 1_000, 8);
    });

    it('calculates pnl correctly for profitable short (price down)', () => {
      // grossPnl = 1000, exit fee = 9000*0.001 = 9, pnl = 991
      const trade = portfolio.closeShort('all', 9_000, NOW + 1, 0.001);
      expect(trade.pnl).toBeCloseTo(1_000 - 9, 8);
    });

    it('calculates pnlPercent for profitable short', () => {
      // (10000-9000)/10000 * 100 = 10%
      const trade = portfolio.closeShort('all', 9_000, NOW + 1);
      expect(trade.pnlPercent).toBeCloseTo(10, 8);
    });

    it('adds negative gross PnL to cash when price rises (loss)', () => {
      // grossPnl = (10000-11000)*1 = -1000, fee = 0 → cash += -1000
      portfolio.closeShort('all', 11_000, NOW + 1);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 1_000, 8);
    });

    it('calculates negative pnl for a losing short (price up)', () => {
      // grossPnl = -1000, exit fee = 11000*0.001 = 11, pnl = -1011
      const trade = portfolio.closeShort('all', 11_000, NOW + 1, 0.001);
      expect(trade.pnl).toBeCloseTo(-1_000 - 11, 8);
    });

    it('calculates negative pnlPercent for losing short', () => {
      // (10000-11000)/10000 * 100 = -10%
      const trade = portfolio.closeShort('all', 11_000, NOW + 1);
      expect(trade.pnlPercent).toBeCloseTo(-10, 8);
    });

    it('clears short position after full close with "all"', () => {
      portfolio.closeShort('all', 9_000, NOW + 1);
      expect(portfolio.hasShortPosition).toBe(false);
      expect(portfolio.shortPosition).toBeNull();
    });

    it('clears short position when exact amount passed', () => {
      portfolio.closeShort(1, 9_000, NOW + 1);
      expect(portfolio.hasShortPosition).toBe(false);
    });

    it('supports partial close — reduces position amount', () => {
      portfolio.closeShort(0.4, 9_000, NOW + 1);
      const pos = portfolio.shortPosition;
      expect(pos).not.toBeNull();
      expect(pos?.amount).toBeCloseTo(0.6, 8);
    });

    it('records a CLOSE_SHORT trade with closedPositionId', () => {
      const openTrade = portfolio.trades[0];
      portfolio.closeShort('all', 9_000, NOW + 1);
      const closeTrade = portfolio.trades[1];
      expect(closeTrade.action).toBe('CLOSE_SHORT');
      expect(closeTrade.closedPositionId).toBe(openTrade.id);
    });

    it('throws when no short position is open', () => {
      const p = new Portfolio(INITIAL, SYMBOL);
      expect(() => p.closeShort('all', 10_000, NOW)).toThrow('Cannot close short: no short position is open');
    });

    it('throws when close amount exceeds position amount', () => {
      expect(() => portfolio.closeShort(2, 9_000, NOW + 1)).toThrow(
        'Cannot close 2, only 1 available'
      );
    });

    it('throws when price is zero', () => {
      expect(() => portfolio.closeShort('all', 0, NOW + 1)).toThrow('Price must be positive');
    });

    it('does not include fee/feeRate when zero', () => {
      const trade = portfolio.closeShort('all', 9_000, NOW + 1, 0);
      expect(trade.fee).toBeUndefined();
      expect(trade.feeRate).toBeUndefined();
    });

    it('balanceAfter in the close trade matches portfolio cash', () => {
      portfolio.closeShort('all', 9_000, NOW + 1);
      const closeTrade = portfolio.trades[1];
      expect(closeTrade.balanceAfter).toBeCloseTo(portfolio.cash, 8);
    });
  });

  // ---------------------------------------------------------------------------
  // equity (getEquity)
  // ---------------------------------------------------------------------------

  describe('equity', () => {
    it('returns initial capital when no positions exist', () => {
      expect(portfolio.equity).toBe(INITIAL);
    });

    it('includes long position value at current price', () => {
      // Open 0.5 BTC at $10,000, no fee → cash = 5000
      portfolio.openLong(0.5, 10_000, NOW);
      // Price moves to $12,000 → long value = 0.5 * 12000 = 6000
      portfolio.updatePrice(12_000);
      // equity = 5000 + 6000 = 11000
      expect(portfolio.equity).toBeCloseTo(11_000, 8);
    });

    it('includes unrealized short PnL (price went down = profit)', () => {
      // Short 1 BTC at $10,000, no fee → cash unchanged = 10000
      portfolio.openShort(1, 10_000, NOW, 0);
      // Price drops to $9,000 → short pnl = (10000-9000)*1 = 1000
      portfolio.updatePrice(9_000);
      // equity = cash(10000) + shortPnl(1000) = 11000
      expect(portfolio.equity).toBeCloseTo(11_000, 8);
    });

    it('includes negative unrealized short PnL (price went up = loss)', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      portfolio.updatePrice(11_000);
      // shortPnl = (10000-11000)*1 = -1000
      // equity = 10000 + (-1000) = 9000
      expect(portfolio.equity).toBeCloseTo(9_000, 8);
    });

    it('equals cash after all positions are closed', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.closeLong('all', 11_000, NOW + 1);
      expect(portfolio.equity).toBeCloseTo(portfolio.cash, 10);
    });

    it('correctly sums cash + long value at entry price (no price movement)', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      // equity = 5000 + 0.5*10000 = 10000
      expect(portfolio.equity).toBeCloseTo(INITIAL, 8);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePrice
  // ---------------------------------------------------------------------------

  describe('updatePrice', () => {
    it('updates unrealized PnL on long position', () => {
      portfolio.openLong(1, 10_000, NOW);
      portfolio.updatePrice(12_000);
      expect(portfolio.longPosition?.unrealizedPnl).toBeCloseTo(2_000, 8);
    });

    it('updates unrealized PnL on short position (profit when price drops)', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      portfolio.updatePrice(8_000);
      expect(portfolio.shortPosition?.unrealizedPnl).toBeCloseTo(2_000, 8);
    });

    it('updates unrealized PnL on short position (loss when price rises)', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      portfolio.updatePrice(12_000);
      expect(portfolio.shortPosition?.unrealizedPnl).toBeCloseTo(-2_000, 8);
    });

    it('throws when price is zero', () => {
      expect(() => portfolio.updatePrice(0)).toThrow('Price must be positive');
    });

    it('throws when price is negative', () => {
      expect(() => portfolio.updatePrice(-100)).toThrow('Price must be positive');
    });

    it('does nothing when no position is open (no throw)', () => {
      expect(() => portfolio.updatePrice(10_000)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // applyFundingPayment
  // ---------------------------------------------------------------------------

  describe('applyFundingPayment', () => {
    it('adds positive payment to cash', () => {
      portfolio.applyFundingPayment(100);
      expect(portfolio.cash).toBeCloseTo(INITIAL + 100, 8);
    });

    it('deducts negative payment from cash', () => {
      portfolio.applyFundingPayment(-50);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 50, 8);
    });

    it('zero payment leaves cash unchanged', () => {
      portfolio.applyFundingPayment(0);
      expect(portfolio.cash).toBeCloseTo(INITIAL, 8);
    });

    it('accumulates multiple payments correctly', () => {
      portfolio.applyFundingPayment(200);
      portfolio.applyFundingPayment(-80);
      portfolio.applyFundingPayment(30);
      // Net: 200 - 80 + 30 = 150
      expect(portfolio.cash).toBeCloseTo(INITIAL + 150, 8);
    });

    it('affects equity through the cash pool', () => {
      portfolio.applyFundingPayment(300);
      expect(portfolio.equity).toBeCloseTo(INITIAL + 300, 8);
    });

    it('can push cash below zero (no guard in implementation)', () => {
      portfolio.applyFundingPayment(-20_000);
      expect(portfolio.cash).toBeCloseTo(INITIAL - 20_000, 8);
    });

    it('does not affect position amount or unrealizedPnl', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.updatePrice(11_000);
      const unrealizedBefore = portfolio.longPosition?.unrealizedPnl;
      portfolio.applyFundingPayment(500);
      expect(portfolio.longPosition?.amount).toBeCloseTo(0.5, 8);
      expect(portfolio.longPosition?.unrealizedPnl).toBeCloseTo(unrealizedBefore ?? 0, 8);
    });
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  describe('reset', () => {
    it('restores cash to initial capital', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.applyFundingPayment(500);
      portfolio.reset();
      expect(portfolio.cash).toBe(INITIAL);
    });

    it('clears long position', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.reset();
      expect(portfolio.hasLongPosition).toBe(false);
      expect(portfolio.longPosition).toBeNull();
    });

    it('clears short position', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      portfolio.reset();
      expect(portfolio.hasShortPosition).toBe(false);
      expect(portfolio.shortPosition).toBeNull();
    });

    it('clears trades', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.closeLong('all', 11_000, NOW + 1);
      portfolio.reset();
      expect(portfolio.trades).toHaveLength(0);
    });

    it('restores equity to initial capital', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.updatePrice(12_000);
      portfolio.reset();
      expect(portfolio.equity).toBe(INITIAL);
    });

    it('allows opening a position after reset', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.reset();
      expect(() => portfolio.openLong(0.3, 9_000, NOW + 1)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // canAfford
  // ---------------------------------------------------------------------------

  describe('canAfford', () => {
    it('returns true when cost is less than cash', () => {
      expect(portfolio.canAfford(0.5, 10_000)).toBe(true);
    });

    it('returns true when cost exactly equals cash', () => {
      expect(portfolio.canAfford(1, 10_000)).toBe(true);
    });

    it('returns false when cost exceeds cash', () => {
      expect(portfolio.canAfford(1.1, 10_000)).toBe(false);
    });

    it('returns false after cash is reduced by a trade', () => {
      portfolio.openLong(0.9, 10_000, NOW, 0);
      // cash = 1000; check 0.2 at 10000 → cost 2000 > 1000
      expect(portfolio.canAfford(0.2, 10_000)).toBe(false);
    });

    it('returns true for zero amount', () => {
      expect(portfolio.canAfford(0, 10_000)).toBe(true);
    });

    it('returns true for zero price', () => {
      expect(portfolio.canAfford(100, 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getTotalReturnPercent
  // ---------------------------------------------------------------------------

  describe('getTotalReturnPercent', () => {
    it('returns 0 when equity equals initial capital', () => {
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(0, 8);
    });

    it('returns positive percent after profitable trade', () => {
      // Buy 1 BTC at $1,000, fee=0, price rises to $1,200
      portfolio.openLong(1, 1_000, NOW, 0);
      portfolio.updatePrice(1_200);
      // equity = 9000 + 1200 = 10200 → return = (10200-10000)/10000*100 = 2%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(2, 8);
    });

    it('returns negative percent after losing trade', () => {
      portfolio.openLong(1, 1_000, NOW, 0);
      portfolio.updatePrice(900);
      // equity = 9000 + 900 = 9900 → return = -1%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(-1, 8);
    });

    it('returns correct return after closing position', () => {
      portfolio.openLong(1, 1_000, NOW, 0);
      portfolio.closeLong('all', 1_500, NOW + 1, 0);
      // cash = 10500 → return = 5%
      expect(portfolio.getTotalReturnPercent()).toBeCloseTo(5, 8);
    });
  });

  // ---------------------------------------------------------------------------
  // getState
  // ---------------------------------------------------------------------------

  describe('getState', () => {
    it('returns current cash, balance, equity, and null positions initially', () => {
      const state = portfolio.getState();
      expect(state.cash).toBe(INITIAL);
      expect(state.balance).toBe(INITIAL);
      expect(state.equity).toBe(INITIAL);
      expect(state.longPosition).toBeNull();
      expect(state.shortPosition).toBeNull();
    });

    it('returns position details after opening', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      const state = portfolio.getState();
      expect(state.longPosition).not.toBeNull();
      expect(state.longPosition?.amount).toBe(0.5);
      expect(state.shortPosition).toBeNull();
    });

    it('returns a snapshot — modifying returned object does not affect internal state', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      const state = portfolio.getState();
      // longPosition is a copy; mutating it should not change internal state
      if (state.longPosition) {
        state.longPosition.amount = 999;
      }
      expect(portfolio.longPosition?.amount).toBe(0.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Sequential trades edge cases
  // ---------------------------------------------------------------------------

  describe('sequential trades', () => {
    it('re-opens a long position after full close', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.closeLong('all', 11_000, NOW + 1);
      expect(() => portfolio.openLong(0.3, 9_000, NOW + 2)).not.toThrow();
      expect(portfolio.longPosition?.entryPrice).toBe(9_000);
    });

    it('re-opens a short position after full close', () => {
      portfolio.openShort(1, 10_000, NOW, 0);
      portfolio.closeShort('all', 9_000, NOW + 1);
      expect(() => portfolio.openShort(0.5, 8_000, NOW + 2, 0)).not.toThrow();
      expect(portfolio.shortPosition?.entryPrice).toBe(8_000);
    });

    it('accumulates trades from multiple open/close cycles', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      portfolio.closeLong('all', 11_000, NOW + 1);
      portfolio.openLong(0.3, 10_500, NOW + 2);
      portfolio.closeLong('all', 10_200, NOW + 3);
      // 4 trades total
      expect(portfolio.trades).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Prediction market mode
  // ---------------------------------------------------------------------------

  // isPredictionMarket tests removed — Polymarket support was removed in commit 5ba3116

  // ---------------------------------------------------------------------------
  // Trades array is a copy (immutability)
  // ---------------------------------------------------------------------------

  describe('trades immutability', () => {
    it('returns a copy — pushing to result does not affect internal array', () => {
      portfolio.openLong(0.5, 10_000, NOW);
      const copy = portfolio.trades;
      copy.push({ ...copy[0], id: 'fake' });
      expect(portfolio.trades).toHaveLength(1);
    });
  });
});
