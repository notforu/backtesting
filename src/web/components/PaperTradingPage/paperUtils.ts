/**
 * Utility functions for Paper Trading page — trade mapping and metrics computation.
 */

import type { Trade, TradeAction, PerformanceMetrics, PaperTrade } from '../../types';

/**
 * Map a PaperTrade action to a backtesting TradeAction.
 */
function mapAction(action: PaperTrade['action']): TradeAction {
  switch (action) {
    case 'open_long': return 'OPEN_LONG';
    case 'close_long': return 'CLOSE_LONG';
    case 'open_short': return 'OPEN_SHORT';
    case 'close_short': return 'CLOSE_SHORT';
  }
}

/**
 * Convert paper trades to backtesting Trade[] format for use with <Chart /> and <Dashboard />.
 */
export function mapPaperTrades(trades: PaperTrade[]): Trade[] {
  return trades.map((t) => ({
    id: String(t.id),
    symbol: t.symbol,
    action: mapAction(t.action),
    price: t.price,
    amount: t.amount,
    timestamp: t.timestamp,
    pnl: t.pnl ?? undefined,
    pnlPercent: t.pnlPercent ?? undefined,
    balanceAfter: t.balanceAfter,
    fee: t.fee,
    fundingIncome: t.fundingIncome ?? undefined,
  }));
}

/**
 * Compute PerformanceMetrics from paper trades and session state.
 */
export function computePaperMetrics(
  trades: PaperTrade[],
  initialCapital: number,
  currentEquity: number,
  equitySnapshots: { equity: number }[] = [],
): PerformanceMetrics {
  const closeTrades = trades.filter(
    (t) => t.action === 'close_long' || t.action === 'close_short',
  );
  const wins = closeTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closeTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const totalPnl = closeTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fee ?? 0), 0);
  const totalWins = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const totalFunding = trades.reduce((s, t) => s + (t.fundingIncome ?? 0), 0);

  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / losses.length : 0;

  const totalReturn = currentEquity - initialCapital;
  const totalReturnPercent = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;
  const winRate = closeTrades.length > 0 ? (wins.length / closeTrades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const expectancy = closeTrades.length > 0 ? totalPnl / closeTrades.length : 0;
  const expectancyPct = closeTrades.length > 0
    ? closeTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / closeTrades.length
    : 0;

  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  for (const snap of equitySnapshots) {
    if (snap.equity > peak) peak = snap.equity;
    const dd = peak - snap.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;
  }

  // Long/Short PnL breakdown
  const longCloseTrades = closeTrades.filter(t => t.action === 'close_long');
  const shortCloseTrades = closeTrades.filter(t => t.action === 'close_short');

  const longPnl = longCloseTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const shortPnl = shortCloseTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);

  const longWins = longCloseTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const shortWins = shortCloseTrades.filter(t => (t.pnl ?? 0) > 0).length;

  const longWinRate = longCloseTrades.length > 0 ? (longWins / longCloseTrades.length) * 100 : 0;
  const shortWinRate = shortCloseTrades.length > 0 ? (shortWins / shortCloseTrades.length) * 100 : 0;

  return {
    totalReturn,
    totalReturnPercent,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio: 0,
    sortinoRatio: 0,
    winRate,
    profitFactor,
    totalTrades: closeTrades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    avgWin,
    avgLoss,
    avgWinPercent: avgWinPct,
    avgLossPercent: avgLossPct,
    expectancy,
    expectancyPercent: expectancyPct,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl ?? 0)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl ?? 0)) : 0,
    avgTradeDuration: 0,
    exposureTime: 0,
    totalFees,
    longPnl,
    shortPnl,
    longTrades: longCloseTrades.length,
    shortTrades: shortCloseTrades.length,
    longWinRate,
    shortWinRate,
    ...(totalFunding !== 0 ? { totalFundingIncome: totalFunding, tradingPnl: totalPnl - totalFunding } : {}),
  };
}
