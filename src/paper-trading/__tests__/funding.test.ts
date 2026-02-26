/**
 * Funding Payment Tests (6B)
 *
 * Tests funding rate processing using MultiSymbolPortfolio directly.
 * Verifies exact dollar amounts, direction, and edge cases.
 *
 * Funding formula (engine.ts step 4):
 *   Long position:  payment = -(amount * markPrice * fundingRate)
 *   Short position: payment = +(amount * markPrice * fundingRate)
 */

import { describe, it, expect } from 'vitest';
import { MultiSymbolPortfolio } from '../../core/multi-portfolio.js';
import type { FundingRate } from '../../core/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeFundingRate(
  timestamp: number,
  fundingRate: number,
  markPrice?: number,
): FundingRate {
  return { timestamp, fundingRate, markPrice };
}

/**
 * Simulate the engine's funding payment logic for a given portfolio, symbol,
 * and list of funding rates that haven't yet been processed.
 *
 * Returns total payment applied.
 */
function applyFundingPayments(
  portfolio: MultiSymbolPortfolio,
  symbol: string,
  fundingRates: FundingRate[],
  lastProcessedTs: number,
  fallbackPrice: number,
): number {
  let total = 0;

  for (const fr of fundingRates) {
    if (fr.timestamp <= lastProcessedTs) continue;

    const positions = portfolio.getPositionForSymbol(symbol);
    if (!positions.longPosition && !positions.shortPosition) continue;

    const markPrice = fr.markPrice ?? fallbackPrice;
    if (markPrice === 0) continue;

    if (positions.longPosition) {
      const payment = -positions.longPosition.amount * markPrice * fr.fundingRate;
      portfolio.applyFundingPayment(payment);
      total += payment;
    }

    if (positions.shortPosition) {
      const payment = positions.shortPosition.amount * markPrice * fr.fundingRate;
      portfolio.applyFundingPayment(payment);
      total += payment;
    }
  }

  return total;
}

// ============================================================================
// Tests
// ============================================================================

describe('Funding Rate Processing', () => {
  const INITIAL_CAPITAL = 10_000;
  const ENTRY_PRICE = 50_000;
  const MARK_PRICE = 51_000;
  const AMOUNT = 0.1; // 0.1 BTC
  const POSITIVE_FR = 0.001; // 0.1% (typical positive funding, longs pay shorts)
  const NEGATIVE_FR = -0.0005; // -0.05% (negative funding, shorts pay longs)

  // ==========================================================================
  // 1. Long position pays positive FR (cash decreases)
  // ==========================================================================

  it('long position with positive FR: cash decreases (longs pay shorts)', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, POSITIVE_FR, MARK_PRICE);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, MARK_PRICE);

    // Expected payment: -(0.1 * 51000 * 0.001) = -5.1
    const expectedPayment = -(AMOUNT * MARK_PRICE * POSITIVE_FR);
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
    expect(portfolio.cash).toBeLessThan(cashBefore); // cash decreased
  });

  // ==========================================================================
  // 2. Short position receives positive FR (cash increases)
  // ==========================================================================

  it('short position with positive FR: cash increases (shorts receive)', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openShort('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, POSITIVE_FR, MARK_PRICE);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, MARK_PRICE);

    // Expected payment: +(0.1 * 51000 * 0.001) = +5.1
    const expectedPayment = AMOUNT * MARK_PRICE * POSITIVE_FR;
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
    expect(portfolio.cash).toBeGreaterThan(cashBefore); // cash increased
  });

  // ==========================================================================
  // 3. Negative FR reverses direction: long receives, short pays
  // ==========================================================================

  it('negative FR: long receives payment (cash increases)', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, NEGATIVE_FR, MARK_PRICE);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, MARK_PRICE);

    // Expected payment: -(0.1 * 51000 * -0.0005) = +2.55
    const expectedPayment = -(AMOUNT * MARK_PRICE * NEGATIVE_FR); // positive (received)
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
    expect(portfolio.cash).toBeGreaterThan(cashBefore);
  });

  it('negative FR: short pays (cash decreases)', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openShort('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, NEGATIVE_FR, MARK_PRICE);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, MARK_PRICE);

    // Expected payment: +(0.1 * 51000 * -0.0005) = -2.55
    const expectedPayment = AMOUNT * MARK_PRICE * NEGATIVE_FR; // negative (paid)
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
    expect(portfolio.cash).toBeLessThan(cashBefore);
  });

  // ==========================================================================
  // 4. No position = no payment
  // ==========================================================================

  it('no position: funding rate is skipped, cash unchanged', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    // No positions opened
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, POSITIVE_FR, MARK_PRICE);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, MARK_PRICE);

    expect(portfolio.cash).toBe(cashBefore);
  });

  // ==========================================================================
  // 5. Multiple FR timestamps between ticks
  // ==========================================================================

  it('multiple FR timestamps between ticks: all applied cumulatively', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    // Three funding rate events (all after lastProcessedTs=0)
    const frs: FundingRate[] = [
      makeFundingRate(1_000_000, 0.001, MARK_PRICE),
      makeFundingRate(1_029_000_000, 0.002, MARK_PRICE),
      makeFundingRate(1_058_000_000, 0.0005, MARK_PRICE),
    ];

    applyFundingPayments(portfolio, 'BTC/USDT', frs, 0, MARK_PRICE);

    // Expected total: sum of all payments
    const totalRate = 0.001 + 0.002 + 0.0005;
    const expectedTotal = -(AMOUNT * MARK_PRICE * totalRate);
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedTotal, 4);
  });

  // ==========================================================================
  // 6. Only newer FR timestamps are applied (lastProcessedTs guard)
  // ==========================================================================

  it('lastProcessedTs guard: older FR timestamps are skipped', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const frs: FundingRate[] = [
      makeFundingRate(500, POSITIVE_FR, MARK_PRICE),   // old — skip
      makeFundingRate(1000, POSITIVE_FR, MARK_PRICE),  // exactly at lastProcessed — skip
      makeFundingRate(2000, POSITIVE_FR, MARK_PRICE),  // new — apply
    ];

    // lastProcessedTs = 1000, so only ts=2000 should be applied
    applyFundingPayments(portfolio, 'BTC/USDT', frs, 1000, MARK_PRICE);

    const expectedPayment = -(AMOUNT * MARK_PRICE * POSITIVE_FR); // only one payment
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
  });

  // ==========================================================================
  // 7. Exact dollar amount verification
  // ==========================================================================

  it('exact dollar amount: payment = -(amount * markPrice * fundingRate) for long', () => {
    const portfolio = new MultiSymbolPortfolio(200_000); // enough for 2.5 BTC @ 47k
    const amount = 2.5;
    const markPrice = 48_000;
    const fundingRate = 0.0015;

    portfolio.openLong('BTC/USDT', amount, 47_000, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, fundingRate, markPrice);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, markPrice);

    // payment = -(2.5 * 48000 * 0.0015) = -180.0
    const expectedPayment = -(amount * markPrice * fundingRate);
    expect(expectedPayment).toBeCloseTo(-180.0, 6);
    expect(portfolio.cash).toBeCloseTo(cashBefore - 180.0, 4);
  });

  it('exact dollar amount: payment = +(amount * markPrice * fundingRate) for short', () => {
    const portfolio = new MultiSymbolPortfolio(200_000); // enough for 2.5 BTC @ 47k
    const amount = 2.5;
    const markPrice = 48_000;
    const fundingRate = 0.0015;

    portfolio.openShort('BTC/USDT', amount, 47_000, Date.now(), 0);
    const cashBefore = portfolio.cash;

    const fr = makeFundingRate(1_000_000, fundingRate, markPrice);
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, markPrice);

    // payment = +(2.5 * 48000 * 0.0015) = +180.0
    const expectedPayment = amount * markPrice * fundingRate;
    expect(expectedPayment).toBeCloseTo(180.0, 6);
    expect(portfolio.cash).toBeCloseTo(cashBefore + 180.0, 4);
  });

  // ==========================================================================
  // 8. Mark price fallback to candle close
  // ==========================================================================

  it('falls back to provided price when markPrice is undefined', () => {
    const portfolio = new MultiSymbolPortfolio(INITIAL_CAPITAL);
    portfolio.openLong('BTC/USDT', AMOUNT, ENTRY_PRICE, Date.now(), 0);
    const cashBefore = portfolio.cash;

    // FR without markPrice — should use fallbackPrice
    const fr: FundingRate = { timestamp: 1_000_000, fundingRate: POSITIVE_FR }; // no markPrice
    const fallbackPrice = 52_000;
    applyFundingPayments(portfolio, 'BTC/USDT', [fr], 0, fallbackPrice);

    const expectedPayment = -(AMOUNT * fallbackPrice * POSITIVE_FR);
    expect(portfolio.cash).toBeCloseTo(cashBefore + expectedPayment, 6);
  });
});
