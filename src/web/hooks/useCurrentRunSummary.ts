/**
 * Hook that builds a BacktestSummary-like object from the current backtest result.
 * Used for displaying run parameters in the RunParamsModal.
 */

import { useMemo } from 'react';
import type { BacktestResult, BacktestSummary } from '../types';

export function useCurrentRunSummary(
  currentResult: BacktestResult | null,
  selectedBacktestId: string | null,
): BacktestSummary | null {
  return useMemo<BacktestSummary | null>(() => {
    if (!currentResult) return null;
    return {
      id: selectedBacktestId ?? 'current',
      strategyName: currentResult.config.strategyName,
      symbol: currentResult.config.symbol ?? 'MULTI',
      timeframe: currentResult.config.timeframe,
      mode: (currentResult.config as any).mode ?? undefined,
      params: currentResult.config.params ?? {},
      runAt: new Date().toISOString(),
      sharpeRatio: currentResult.metrics.sharpeRatio,
      totalReturnPercent: currentResult.metrics.totalReturnPercent,
      maxDrawdownPercent: currentResult.metrics.maxDrawdownPercent,
      winRate: currentResult.metrics.winRate,
      profitFactor: currentResult.metrics.profitFactor,
      totalTrades: currentResult.metrics.totalTrades,
      aggregationId: (currentResult as any).aggregationId ?? undefined,
      aggregationName: (currentResult as any).aggregationName ?? undefined,
    };
  }, [currentResult, selectedBacktestId]);
}
