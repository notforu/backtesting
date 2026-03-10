/**
 * Hook to compute per-asset metrics for the dashboard when a specific asset
 * is selected in multi-asset backtest mode.
 */

import type { BacktestResult, AggregateBacktestResult, PerformanceMetrics, PerAssetResult } from '../types';

interface MultiAsset {
  symbol: string;
  timeframe: string;
  label: string;
}

/**
 * Returns the metrics for the currently selected asset in a multi-asset result,
 * or the top-level metrics when no specific asset is selected.
 */
export function usePerAssetMetrics(
  currentResult: BacktestResult | AggregateBacktestResult | null,
  isMultiAsset: boolean,
  selectedAsset: MultiAsset | null,
): PerformanceMetrics | null {
  if (!currentResult) return null;

  if (isMultiAsset && selectedAsset) {
    const perAssetResults = (currentResult as any).perAssetResults as
      | Record<string, PerAssetResult>
      | undefined;

    const assetResult = perAssetResults?.[selectedAsset.symbol];
    if (assetResult?.metrics) {
      // Full per-asset metrics available (from aggregate engine) - use directly
      return assetResult.metrics;
    }

    // Fallback: build from perAssetSummary (loaded from history)
    const perAssetSummary = (currentResult as any).config?.params?.perAssetSummary as
      | Array<{
          symbol: string;
          timeframe: string;
          sharpe: number;
          returnPct: number;
          trades: number;
          fundingIncome: number;
          tradingPnl: number;
        }>
      | undefined;

    const assetSummary = perAssetSummary?.find((a) => a.symbol === selectedAsset.symbol);
    if (assetSummary) {
      const assetTrades = currentResult.trades.filter((t) => t.symbol === selectedAsset.symbol);
      const closeTrades = assetTrades.filter(
        (t) => t.action === 'CLOSE_LONG' || t.action === 'CLOSE_SHORT',
      );
      const wins = closeTrades.filter((t) => (t.pnl ?? 0) > 0);
      const losses = closeTrades.filter((t) => (t.pnl ?? 0) <= 0);
      const totalPnl = closeTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const totalFees = assetTrades.reduce((sum, t) => sum + (t.fee ?? 0), 0);
      const avgWin =
        wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
      const totalWins = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

      return {
        totalReturn: totalPnl,
        totalReturnPercent: assetSummary.returnPct,
        sharpeRatio: assetSummary.sharpe,
        sortinoRatio: 0,
        winRate: closeTrades.length > 0 ? (wins.length / closeTrades.length) * 100 : 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : 0,
        totalTrades: closeTrades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        avgWin,
        avgLoss:
          losses.length > 0
            ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length
            : 0,
        avgWinPercent:
          wins.length > 0
            ? wins.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / wins.length
            : 0,
        avgLossPercent:
          losses.length > 0
            ? losses.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / losses.length
            : 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        totalFees,
        largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl ?? 0)) : 0,
        largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl ?? 0)) : 0,
        avgTradeDuration: 0,
        exposureTime: 0,
        expectancy: closeTrades.length > 0 ? totalPnl / closeTrades.length : 0,
        expectancyPercent:
          closeTrades.length > 0
            ? closeTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / closeTrades.length
            : 0,
        totalFundingIncome: assetSummary.fundingIncome,
        tradingPnl: assetSummary.tradingPnl,
      } as PerformanceMetrics;
    }
  }

  return currentResult.metrics ?? null;
}
