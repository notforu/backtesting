/**
 * Prediction Market Strategy Utilities
 * Shared helpers for prediction market strategies
 */

/** Check if a market price is in a tradeable range */
export function isTradeablePrice(price: number, minPct: number = 5, maxPct: number = 95): boolean {
  return price >= minPct / 100 && price <= maxPct / 100;
}

/** Calculate expected slippage cost for a round-trip trade */
export function roundTripSlippageCost(price: number, amount: number, slippagePct: number = 2): number {
  return amount * price * (slippagePct / 100) * 2;
}

/** Check if expected profit exceeds transaction costs */
export function isProfitableAfterCosts(
  expectedProfitPct: number,
  slippagePct: number = 2,
  feeRate: number = 0
): boolean {
  const roundTripCostPct = (slippagePct * 2) + (feeRate * 100 * 2);
  return expectedProfitPct > roundTripCostPct;
}

/** Calculate position size in shares for PM markets */
export function pmPositionSize(
  equity: number,
  positionSizePct: number,
  maxPositionUSD: number,
  price: number,
  isShort: boolean = false
): number {
  const notional = Math.min(equity * (positionSizePct / 100), maxPositionUSD);
  if (isShort) {
    return notional / (1 - price);
  }
  return notional / price;
}
