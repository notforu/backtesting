/**
 * Performance metrics calculation
 * Calculates all trading performance metrics from trades and equity curve
 */

import type { Trade, EquityPoint, PerformanceMetrics, RollingMetrics } from '../core/types.js';
import { SORTINO_CAP, ROLLING_SHARPE_WINDOW, PROFIT_FACTOR_CAP } from '../core/constants.js';

/**
 * Check if a trade is a close trade (has PnL)
 */
function isCloseTrade(trade: Trade): boolean {
  return trade.action === 'CLOSE_LONG' || trade.action === 'CLOSE_SHORT';
}

/**
 * Calculate performance metrics from trades and equity curve
 * Note: Metrics are calculated from CLOSE trades only (where PnL is realized)
 * @param trades - Array of all trades (open and close)
 * @param equity - Array of equity points over time
 * @param initialCapital - Starting capital
 * @param timeframe - Optional timeframe for annualization (e.g., '1h', '1d')
 * @returns Complete performance metrics
 */
export function calculateMetrics(
  trades: Trade[],
  equity: EquityPoint[],
  initialCapital: number,
  timeframe?: string
): PerformanceMetrics {
  // Filter to only close trades for PnL calculations
  const closeTrades = trades.filter(isCloseTrade);

  // Handle edge case of no close trades
  if (closeTrades.length === 0) {
    return {
      totalReturn: 0,
      totalReturnPercent: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinPercent: 0,
      avgLossPercent: 0,
      expectancy: 0,
      expectancyPercent: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradeDuration: 0,
      exposureTime: 0,
      totalFees: 0,
      totalSlippage: 0,
    };
  }

  // Separate winning and losing trades (based on realized PnL)
  const winningTrades = closeTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losingTrades = closeTrades.filter((t) => (t.pnl ?? 0) < 0);

  // Basic trade statistics
  const totalTrades = closeTrades.length;
  const winCount = winningTrades.length;
  const lossCount = losingTrades.length;

  // Win rate
  const winRate = (winCount / totalTrades) * 100;

  // Total return
  const finalEquity = equity.length > 0 ? equity[equity.length - 1].equity : initialCapital;
  const totalReturn = finalEquity - initialCapital;
  const totalReturnPercent = (totalReturn / initialCapital) * 100;

  // Gross profit and loss
  const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0));

  // Profit factor
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Average win/loss
  const avgWin = winCount > 0 ? grossProfit / winCount : 0;
  const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0;

  // Average win/loss percentages
  const avgWinPercent = winCount > 0
    ? winningTrades.reduce((sum, t) => sum + (t.pnlPercent ?? 0), 0) / winCount
    : 0;
  const avgLossPercent = lossCount > 0
    ? losingTrades.reduce((sum, t) => sum + (t.pnlPercent ?? 0), 0) / lossCount
    : 0;

  // Expectancy (expected value per trade)
  const expectancy = totalTrades > 0 ? totalReturn / totalTrades : 0;
  const expectancyPercent = totalTrades > 0
    ? closeTrades.reduce((sum, t) => sum + (t.pnlPercent ?? 0), 0) / totalTrades
    : 0;

  // Largest win/loss
  const largestWin = winCount > 0
    ? Math.max(...winningTrades.map(t => t.pnl ?? 0))
    : 0;
  const largestLoss = lossCount > 0
    ? Math.min(...losingTrades.map(t => t.pnl ?? 0))
    : 0;

  // Average trade duration (from open trades to close trades)
  const avgTradeDuration = calculateAvgTradeDuration(trades);

  // Max drawdown calculation
  const { maxDrawdown, maxDrawdownPercent } = calculateMaxDrawdown(equity, initialCapital);

  // Calculate daily returns for Sharpe and Sortino
  const dailyReturns = calculateReturns(equity);

  // Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
  const sharpeRatio = calculateSharpeRatio(dailyReturns, timeframe);

  // Sortino Ratio
  const sortinoRatio = calculateSortinoRatio(dailyReturns, timeframe);

  // Exposure time (percentage of time in the market)
  const exposureTime = calculateExposureTime(trades, equity);

  // Total fees paid across all trades
  const totalFees = trades.reduce((sum, t) => sum + (t.fee ?? 0), 0);

  // Total slippage cost across all trades
  const totalSlippage = trades.reduce((sum, t) => sum + (t.slippage ?? 0), 0);

  return {
    totalReturn,
    totalReturnPercent,
    maxDrawdown,
    maxDrawdownPercent,
    sharpeRatio,
    sortinoRatio,
    winRate,
    profitFactor,
    totalTrades,
    winningTrades: winCount,
    losingTrades: lossCount,
    avgWin,
    avgLoss,
    avgWinPercent,
    avgLossPercent,
    expectancy,
    expectancyPercent,
    largestWin,
    largestLoss,
    avgTradeDuration,
    exposureTime,
    totalFees,
    totalSlippage,
  };
}

/**
 * Calculate average trade duration from open/close trade pairs
 */
function calculateAvgTradeDuration(trades: Trade[]): number {
  // Find matching open/close pairs by closedPositionId
  const closeTrades = trades.filter(t => t.closedPositionId);
  const openTradesById = new Map<string, Trade>();

  for (const trade of trades) {
    if (trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT') {
      openTradesById.set(trade.id, trade);
    }
  }

  let totalDuration = 0;
  let count = 0;

  for (const closeTrade of closeTrades) {
    const openTrade = openTradesById.get(closeTrade.closedPositionId!);
    if (openTrade) {
      totalDuration += closeTrade.timestamp - openTrade.timestamp;
      count++;
    }
  }

  return count > 0 ? totalDuration / count : 0;
}

/**
 * Calculate maximum drawdown from equity curve
 */
function calculateMaxDrawdown(
  equity: EquityPoint[],
  initialCapital: number
): { maxDrawdown: number; maxDrawdownPercent: number } {
  if (equity.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }

  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const point of equity) {
    if (point.equity > peak) {
      peak = point.equity;
    }

    const drawdown = peak - point.equity;
    const drawdownPercent = (drawdown / peak) * 100;

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }

  return { maxDrawdown, maxDrawdownPercent };
}

/**
 * Calculate period-over-period returns from equity curve
 */
function calculateReturns(equity: EquityPoint[]): number[] {
  if (equity.length < 2) return [];

  const returns: number[] = [];

  for (let i = 1; i < equity.length; i++) {
    const prevEquity = equity[i - 1].equity;
    const currEquity = equity[i].equity;

    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  return returns;
}

/**
 * Get annualization factor based on timeframe
 * Defaults to 252 (daily trading days) for backward compatibility
 */
function getAnnualizationFactor(timeframe?: string): number {
  if (!timeframe) return 252;
  const factors: Record<string, number> = {
    '1m': 525600, '5m': 105120, '15m': 35040, '30m': 17520,
    '1h': 8760, '4h': 2190, '1d': 365, '1w': 52
  };
  return factors[timeframe] ?? 365;
}

/**
 * Calculate Sharpe Ratio
 * Assumes risk-free rate of 0 and annualizes based on timeframe
 */
function calculateSharpeRatio(returns: number[], timeframe?: string): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize based on timeframe
  const factor = getAnnualizationFactor(timeframe);
  const annualizedReturn = mean * factor;
  const annualizedStdDev = stdDev * Math.sqrt(factor);

  return annualizedReturn / annualizedStdDev;
}

/**
 * Calculate Sortino Ratio
 * Uses only downside deviation in the denominator
 */
function calculateSortinoRatio(returns: number[], timeframe?: string): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate downside deviation (only negative returns)
  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) {
    // No negative returns means infinite Sortino (or very high)
    return mean > 0 ? SORTINO_CAP : 0;
  }

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
    negativeReturns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) return 0;

  // Annualize based on timeframe
  const factor = getAnnualizationFactor(timeframe);
  const annualizedReturn = mean * factor;
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(factor);

  return annualizedReturn / annualizedDownsideDev;
}

/**
 * Calculate exposure time (percentage of time in the market)
 */
function calculateExposureTime(trades: Trade[], equity: EquityPoint[]): number {
  if (trades.length === 0 || equity.length < 2) return 0;

  const startTime = equity[0].timestamp;
  const endTime = equity[equity.length - 1].timestamp;
  const totalTime = endTime - startTime;

  if (totalTime === 0) return 0;

  // Build a map of open trades by their ID
  const openTradesById = new Map<string, Trade>();
  for (const trade of trades) {
    if (trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT') {
      openTradesById.set(trade.id, trade);
    }
  }

  // Sum up time spent in positions
  let timeInMarket = 0;
  for (const trade of trades) {
    if (trade.closedPositionId) {
      const openTrade = openTradesById.get(trade.closedPositionId);
      if (openTrade) {
        timeInMarket += trade.timestamp - openTrade.timestamp;
      }
    }
  }

  return (timeInMarket / totalTime) * 100;
}

/**
 * Generate equity curve with drawdown calculations
 */
export function generateEquityCurve(
  timestamps: number[],
  equityValues: number[],
  initialCapital: number
): EquityPoint[] {
  if (timestamps.length !== equityValues.length) {
    throw new Error('Timestamps and equity values must have the same length');
  }

  const curve: EquityPoint[] = [];
  let peak = initialCapital;

  for (let i = 0; i < timestamps.length; i++) {
    const equity = equityValues[i];

    if (equity > peak) {
      peak = equity;
    }

    const drawdown = ((peak - equity) / peak) * 100;

    curve.push({
      timestamp: timestamps[i],
      equity,
      drawdown,
    });
  }

  return curve;
}

/**
 * Calculate risk-adjusted metrics
 */
export function calculateRiskMetrics(
  trades: Trade[],
  equity: EquityPoint[]
): {
  calmarRatio: number;
  ulcerIndex: number;
  riskRewardRatio: number;
} {
  const { maxDrawdownPercent } = calculateMaxDrawdown(equity, equity[0]?.equity ?? 0);
  const dailyReturns = calculateReturns(equity);

  // Calmar Ratio (annualized return / max drawdown)
  const annualizedReturn =
    dailyReturns.length > 0
      ? (dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length) * 252 * 100
      : 0;
  const calmarRatio = maxDrawdownPercent > 0 ? annualizedReturn / maxDrawdownPercent : 0;

  // Ulcer Index (measures depth and duration of drawdowns)
  const ulcerIndex = calculateUlcerIndex(equity);

  // Risk/Reward Ratio
  const closeTrades = trades.filter(isCloseTrade);
  const winningTrades = closeTrades.filter((t) => (t.pnl ?? 0) > 0);
  const losingTrades = closeTrades.filter((t) => (t.pnl ?? 0) < 0);
  const avgWin =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / winningTrades.length
      : 0;
  const avgLoss =
    losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)) / losingTrades.length
      : 0;
  const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  return {
    calmarRatio,
    ulcerIndex,
    riskRewardRatio,
  };
}

/**
 * Calculate Ulcer Index
 */
function calculateUlcerIndex(equity: EquityPoint[]): number {
  if (equity.length < 2) return 0;

  let sumSquaredDrawdowns = 0;
  let peak = equity[0].equity;

  for (const point of equity) {
    if (point.equity > peak) {
      peak = point.equity;
    }

    const drawdownPercent = ((peak - point.equity) / peak) * 100;
    sumSquaredDrawdowns += drawdownPercent * drawdownPercent;
  }

  return Math.sqrt(sumSquaredDrawdowns / equity.length);
}

/**
 * Calculate rolling performance metrics over time
 */
export function calculateRollingMetrics(
  trades: Trade[],
  equity: EquityPoint[],
  initialCapital: number
): RollingMetrics {
  const timestamps: number[] = [];
  const cumulativeReturn: number[] = [];
  const drawdown: number[] = [];
  const rollingSharpe: number[] = [];
  const cumulativeWinRate: number[] = [];
  const cumulativeProfitFactor: number[] = [];

  if (equity.length === 0) {
    return { timestamps, cumulativeReturn, drawdown, rollingSharpe, cumulativeWinRate, cumulativeProfitFactor };
  }

  const closeTrades = trades.filter(isCloseTrade);

  // Pre-compute equity returns for rolling Sharpe
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1].equity > 0) {
      returns.push((equity[i].equity - equity[i - 1].equity) / equity[i - 1].equity);
    } else {
      returns.push(0);
    }
  }

  // Track cumulative trade stats for win rate and profit factor
  let tradeIdx = 0;
  let wins = 0;
  let totalCloseTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let i = 0; i < equity.length; i++) {
    const point = equity[i];
    timestamps.push(point.timestamp);

    // Cumulative return %
    cumulativeReturn.push(((point.equity - initialCapital) / initialCapital) * 100);

    // Drawdown (already computed in equity)
    drawdown.push(point.drawdown);

    // Rolling Sharpe (ROLLING_SHARPE_WINDOW-bar window of returns)
    if (i < 2) {
      rollingSharpe.push(0);
    } else {
      const windowSize = ROLLING_SHARPE_WINDOW;
      const startIdx = Math.max(0, i - windowSize);
      const windowReturns = returns.slice(startIdx, i);

      if (windowReturns.length < 2) {
        rollingSharpe.push(0);
      } else {
        const mean = windowReturns.reduce((s, r) => s + r, 0) / windowReturns.length;
        const variance = windowReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (windowReturns.length - 1);
        const std = Math.sqrt(variance);
        rollingSharpe.push(std === 0 ? 0 : (mean / std) * Math.sqrt(252));
      }
    }

    // Advance trade pointer to include trades up to current timestamp
    while (tradeIdx < closeTrades.length && closeTrades[tradeIdx].timestamp <= point.timestamp) {
      const t = closeTrades[tradeIdx];
      totalCloseTrades++;
      const pnl = t.pnl ?? 0;
      if (pnl > 0) {
        wins++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
      }
      tradeIdx++;
    }

    // Cumulative win rate
    cumulativeWinRate.push(totalCloseTrades === 0 ? 0 : (wins / totalCloseTrades) * 100);

    // Cumulative profit factor
    if (totalCloseTrades === 0) {
      cumulativeProfitFactor.push(0);
    } else if (grossLoss === 0) {
      cumulativeProfitFactor.push(grossProfit > 0 ? PROFIT_FACTOR_CAP : 0);
    } else {
      cumulativeProfitFactor.push(grossProfit / grossLoss);
    }
  }

  return { timestamps, cumulativeReturn, drawdown, rollingSharpe, cumulativeWinRate, cumulativeProfitFactor };
}
