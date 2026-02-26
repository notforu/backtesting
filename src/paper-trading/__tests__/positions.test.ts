/**
 * Position & PnL Tests (6C)
 *
 * Tests PnL calculations, fee handling, unrealized PnL updates, and portfolio
 * equity accounting using MultiSymbolPortfolio directly.
 *
 * PnL formulas:
 *   Long close:  pnl = (exitPrice - entryPrice) * amount - exitFee
 *   Short close: pnl = (entryPrice - exitPrice) * amount - exitFee
 *   Fee:         fee = tradeValue * feeRate
 *   Equity:      cash + sum(longPositions.amount * currentPrice)
 *                     + sum(shortCollateral + unrealizedPnl)
 */

import { describe, it, expect } from 'vitest';
import { MultiSymbolPortfolio } from '../../core/multi-portfolio.js';

// ============================================================================
// Constants
// ============================================================================

const INITIAL_CAPITAL = 10_000;
const FEE_RATE = 0.00055; // Bybit taker fee (matches engine.ts)
const SYMBOL = 'BTC/USDT';
const TIMESTAMP = 1_700_000_000_000;

// ============================================================================
// Tests
// ============================================================================

describe('Position & PnL Calculations', () => {

  // ==========================================================================
  // 1. Long profit
  // ==========================================================================

  it('long profit: buy at 100, sell at 110 → PnL = (110-100)*amount - exitFee', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const exitPrice = 110;
    const amount = 10;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const entryFee = amount * entryPrice * FEE_RATE;

    const trade = portfolio.closeLong(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);
    const exitFee = amount * exitPrice * FEE_RATE;

    const expectedPnl = (exitPrice - entryPrice) * amount - exitFee;
    expect(trade.pnl).toBeCloseTo(expectedPnl, 6);
    expect(trade.pnl!).toBeGreaterThan(0);

    // Cash after: initial - cost + proceeds
    const costPaid = amount * entryPrice + entryFee;
    const proceeds = amount * exitPrice - exitFee;
    expect(portfolio.cash).toBeCloseTo(INITIAL_CAPITAL - costPaid + proceeds, 4);
  });

  // ==========================================================================
  // 2. Long loss
  // ==========================================================================

  it('long loss: buy at 100, sell at 90 → PnL is negative', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const exitPrice = 90;
    const amount = 10;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const trade = portfolio.closeLong(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);

    const exitFee = amount * exitPrice * FEE_RATE;
    const expectedPnl = (exitPrice - entryPrice) * amount - exitFee;

    expect(trade.pnl).toBeCloseTo(expectedPnl, 6);
    expect(trade.pnl!).toBeLessThan(0);
  });

  // ==========================================================================
  // 3. Short profit
  // ==========================================================================

  it('short profit: short at 100, cover at 90 → PnL = (100-90)*amount - exitFee', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const exitPrice = 90;
    const amount = 10;

    portfolio.openShort(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const trade = portfolio.closeShort(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);

    const exitFee = amount * exitPrice * FEE_RATE;
    const expectedPnl = (entryPrice - exitPrice) * amount - exitFee;

    expect(trade.pnl).toBeCloseTo(expectedPnl, 6);
    expect(trade.pnl!).toBeGreaterThan(0);
  });

  // ==========================================================================
  // 4. Short loss
  // ==========================================================================

  it('short loss: short at 100, cover at 110 → PnL is negative', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const exitPrice = 110;
    const amount = 10;

    portfolio.openShort(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const trade = portfolio.closeShort(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);

    const exitFee = amount * exitPrice * FEE_RATE;
    const expectedPnl = (entryPrice - exitPrice) * amount - exitFee;

    expect(trade.pnl).toBeCloseTo(expectedPnl, 6);
    expect(trade.pnl!).toBeLessThan(0);
  });

  // ==========================================================================
  // 5. Fee handling: entry fee + exit fee both deducted
  // ==========================================================================

  it('fee handling: entry fee deducted on open, exit fee deducted on close', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 1000;
    const exitPrice = 1000; // same price → PnL = -(exit fee)
    const amount = 1;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const entryFee = amount * entryPrice * FEE_RATE;

    // Cash after open: 10000 - (1000 + entryFee)
    expect(portfolio.cash).toBeCloseTo(INITIAL_CAPITAL - entryPrice - entryFee, 6);

    const trade = portfolio.closeLong(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);
    const exitFee = amount * exitPrice * FEE_RATE;

    // At same price, PnL = -exit fee (the price move PnL is zero)
    expect(trade.pnl).toBeCloseTo(-exitFee, 6);
    expect(trade.fee).toBeCloseTo(exitFee, 6);

    // Total fees paid = entry + exit
    const totalFees = entryFee + exitFee;
    // Final cash = initial - total fees (since price didn't move)
    expect(portfolio.cash).toBeCloseTo(INITIAL_CAPITAL - totalFees, 4);
  });

  // ==========================================================================
  // 6. Unrealized PnL updates when price changes before close
  // ==========================================================================

  it('unrealized PnL: updated after price changes, before close', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const amount = 5;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, 0);
    expect(portfolio.getPositionForSymbol(SYMBOL).longPosition!.unrealizedPnl).toBe(0);

    // Price goes up
    portfolio.updatePrice(SYMBOL, 120);
    const pos = portfolio.getPositionForSymbol(SYMBOL).longPosition!;
    expect(pos.unrealizedPnl).toBeCloseTo((120 - 100) * amount, 6); // +100

    // Price goes down
    portfolio.updatePrice(SYMBOL, 80);
    const pos2 = portfolio.getPositionForSymbol(SYMBOL).longPosition!;
    expect(pos2.unrealizedPnl).toBeCloseTo((80 - 100) * amount, 6); // -100
  });

  it('unrealized PnL for short: updated correctly', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const amount = 5;

    portfolio.openShort(SYMBOL, amount, entryPrice, TIMESTAMP, 0);

    // Price goes down (short profits)
    portfolio.updatePrice(SYMBOL, 80);
    const pos = portfolio.getPositionForSymbol(SYMBOL).shortPosition!;
    expect(pos.unrealizedPnl).toBeCloseTo((100 - 80) * amount, 6); // +100

    // Price goes up (short loses)
    portfolio.updatePrice(SYMBOL, 130);
    const pos2 = portfolio.getPositionForSymbol(SYMBOL).shortPosition!;
    expect(pos2.unrealizedPnl).toBeCloseTo((100 - 130) * amount, 6); // -150
  });

  // ==========================================================================
  // 7. Portfolio equity = cash + sum of all position mark-to-market values
  // ==========================================================================

  it('portfolio equity: cash + long position mark-to-market', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const amount = 10;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, 0); // zero fee for clarity
    // Cash: 10000 - 1000 = 9000
    // Position value: 10 * 100 = 1000
    // Equity: 9000 + 1000 = 10000
    expect(portfolio.equity).toBeCloseTo(INITIAL_CAPITAL, 6);

    // Price rises to 120
    portfolio.updatePrice(SYMBOL, 120);
    // Cash: 9000 (unchanged)
    // Position value: 10 * 120 = 1200
    // Equity: 9000 + 1200 = 10200
    expect(portfolio.equity).toBeCloseTo(9000 + 10 * 120, 6);
  });

  it('portfolio equity: cash + short position (collateral + unrealized PnL)', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 100;
    const amount = 10;

    portfolio.openShort(SYMBOL, amount, entryPrice, TIMESTAMP, 0);
    // Cash locked: 10000 - 1000 = 9000
    // Collateral: 100 * 10 = 1000, unrealized: 0
    // Equity: 9000 + 1000 + 0 = 10000
    expect(portfolio.equity).toBeCloseTo(INITIAL_CAPITAL, 6);

    // Price falls to 80 (short profits)
    portfolio.updatePrice(SYMBOL, 80);
    // Cash: 9000
    // Collateral + unrealized: 1000 + (100-80)*10 = 1000 + 200 = 1200
    // Equity: 9000 + 1200 = 10200
    expect(portfolio.equity).toBeCloseTo(9000 + 1000 + (100 - 80) * 10, 6);
  });

  it('portfolio equity: multi-symbol positions summed correctly', () => {
    const portfolio = new MultiSymbolPortfolio(50_000);

    portfolio.openLong('BTC/USDT', 0.5, 40_000, TIMESTAMP, 0);   // costs 20000
    portfolio.openLong('ETH/USDT', 5, 2_000, TIMESTAMP, 0);      // costs 10000
    // Cash: 50000 - 20000 - 10000 = 20000
    // Long BTC: 0.5 * 40000 = 20000
    // Long ETH: 5 * 2000 = 10000
    // Equity: 20000 + 20000 + 10000 = 50000
    expect(portfolio.equity).toBeCloseTo(50_000, 4);

    // BTC rises to 50000, ETH stays at 2000
    portfolio.updatePrice('BTC/USDT', 50_000);
    // Cash: 20000
    // BTC: 0.5 * 50000 = 25000
    // ETH: 5 * 2000 = 10000
    // Equity: 55000
    expect(portfolio.equity).toBeCloseTo(55_000, 4);
  });

  // ==========================================================================
  // 8. Zero trades: equity unchanged from initial capital
  // ==========================================================================

  it('zero trades: equity equals initial capital', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    expect(portfolio.equity).toBe(INITIAL_CAPITAL);
    expect(portfolio.cash).toBe(INITIAL_CAPITAL);
    expect(portfolio.trades).toHaveLength(0);
  });

  // ==========================================================================
  // 9. Single trade roundtrip: final equity matches expected
  // ==========================================================================

  it('single long roundtrip: open → close → verify final equity', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 1_000;
    const exitPrice = 1_100;
    const amount = 5;

    portfolio.openLong(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const closeTrade = portfolio.closeLong(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);

    // Expected final cash = initial - entryFee + (exitPrice - entryPrice) * amount - exitFee
    const entryFee = amount * entryPrice * FEE_RATE;
    const exitFee = amount * exitPrice * FEE_RATE;
    const expectedFinalCash = INITIAL_CAPITAL - entryFee + (exitPrice - entryPrice) * amount - exitFee;

    expect(portfolio.cash).toBeCloseTo(expectedFinalCash, 4);
    expect(portfolio.equity).toBeCloseTo(expectedFinalCash, 4); // no open positions
    expect(closeTrade.pnl).toBeCloseTo((exitPrice - entryPrice) * amount - exitFee, 4);
  });

  it('single short roundtrip: open → close → verify final equity', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    const entryPrice = 1_000;
    const exitPrice = 900;
    const amount = 5;

    portfolio.openShort(SYMBOL, amount, entryPrice, TIMESTAMP, FEE_RATE);
    const closeTrade = portfolio.closeShort(SYMBOL, 'all', exitPrice, TIMESTAMP + 1, FEE_RATE);

    const entryFee = amount * entryPrice * FEE_RATE;
    const exitFee = amount * exitPrice * FEE_RATE;
    const pnl = (entryPrice - exitPrice) * amount - exitFee;
    // We need to account for the full cash flow:
    // open: cash -= entryPrice * amount + entryFee = 5000 + 2.75 = 5002.75, cash = 4997.25
    // close: cash += collateral + grossPnl - exitFee
    //        = 5000 + 500 - 0.495*5*900... let's just check it matches closeTrade result
    expect(portfolio.cash).toBeCloseTo(INITIAL_CAPITAL - entryFee + pnl, 4);
    expect(closeTrade.pnl).toBeCloseTo(pnl, 4);
    expect(closeTrade.pnl!).toBeGreaterThan(0);
  });

  // ==========================================================================
  // 10. pnlPercent calculation
  // ==========================================================================

  it('pnlPercent: correct percentage based on entry price', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong(SYMBOL, 1, 100, TIMESTAMP, 0);
    const trade = portfolio.closeLong(SYMBOL, 'all', 110, TIMESTAMP + 1, 0);

    // pnlPercent = (exit - entry) / entry * 100 = 10%
    expect(trade.pnlPercent).toBeCloseTo(10, 4);
  });

  it('pnlPercent for short: correct percentage', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openShort(SYMBOL, 1, 100, TIMESTAMP, 0);
    const trade = portfolio.closeShort(SYMBOL, 'all', 80, TIMESTAMP + 1, 0);

    // pnlPercent = (entry - exit) / entry * 100 = 20%
    expect(trade.pnlPercent).toBeCloseTo(20, 4);
  });

  // ==========================================================================
  // 11. Position count tracking
  // ==========================================================================

  it('getPositionCount: returns correct count across multiple symbols', () => {
    const portfolio = new MultiSymbolPortfolio(50_000);

    expect(portfolio.getPositionCount()).toBe(0);

    portfolio.openLong('BTC/USDT', 0.1, 40_000, TIMESTAMP, 0);
    expect(portfolio.getPositionCount()).toBe(1);

    portfolio.openShort('ETH/USDT', 1, 2_000, TIMESTAMP, 0);
    expect(portfolio.getPositionCount()).toBe(2);

    portfolio.closeLong('BTC/USDT', 'all', 40_000, TIMESTAMP + 1, 0);
    expect(portfolio.getPositionCount()).toBe(1);
  });

  // ==========================================================================
  // 12. Insufficient funds for long: throws
  // ==========================================================================

  it('insufficient funds for long: throws error', () => {
    const portfolio = new MultiSymbolPortfolio(100); // only $100
    expect(() => {
      portfolio.openLong(SYMBOL, 1, 50_000, TIMESTAMP, 0); // needs $50000
    }).toThrow('Insufficient funds');
  });

  it('insufficient funds for short: throws error', () => {
    const portfolio = new MultiSymbolPortfolio(100); // only $100
    expect(() => {
      portfolio.openShort(SYMBOL, 1, 50_000, TIMESTAMP, 0); // needs $50000
    }).toThrow('Insufficient funds');
  });
});
