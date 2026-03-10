/**
 * Hook for multi-asset backtest state and derived data.
 * Computes asset list, selected asset, candles, and displayed trades from a backtest result.
 */

import { useState, useEffect } from 'react';
import { useCandles } from './useBacktest';
import { configDateToTimestamp } from '../utils/frThresholds';
import type { BacktestResult, Timeframe, PerAssetResult } from '../types';

export interface MultiAssetItem {
  symbol: string;
  timeframe: string;
  label: string;
}

export interface UseMultiAssetReturn {
  isMultiAsset: boolean;
  multiAssets: MultiAssetItem[];
  selectedAssetIndex: number;
  setSelectedAssetIndex: (idx: number) => void;
  selectedAsset: MultiAssetItem | null;
  assetCandles: ReturnType<typeof useCandles>['data'];
  displayedTrades: BacktestResult['trades'];
}

export function useMultiAsset(currentResult: BacktestResult | null): UseMultiAssetReturn {
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1);

  const perAssetResults = (currentResult as any)?.perAssetResults as
    | Record<string, PerAssetResult>
    | undefined;
  const isMultiAsset = !!(currentResult && perAssetResults && Object.keys(perAssetResults).length > 0);

  const multiAssets: MultiAssetItem[] = isMultiAsset
    ? Object.entries(perAssetResults!).map(([symbol, par]) => ({
        symbol,
        timeframe: par.timeframe,
        label: symbol.replace('/USDT:USDT', ''),
      }))
    : [];

  const selectedAsset =
    selectedAssetIndex >= 0 && selectedAssetIndex < multiAssets.length
      ? multiAssets[selectedAssetIndex]
      : null;

  // Reset selected asset when result changes
  useEffect(() => {
    setSelectedAssetIndex(-1);
  }, [currentResult?.id]);

  const candleParams =
    selectedAsset && currentResult
      ? {
          exchange: currentResult.config.exchange,
          symbol: selectedAsset.symbol,
          timeframe: selectedAsset.timeframe as Timeframe,
          startDate: (() => {
            const ts = configDateToTimestamp(currentResult.config.startDate);
            return new Date(ts ?? 0).toISOString().split('T')[0];
          })(),
          endDate: (() => {
            const ts = configDateToTimestamp(currentResult.config.endDate);
            return new Date(ts ?? 0).toISOString().split('T')[0];
          })(),
        }
      : null;

  const { data: assetCandles } = useCandles(candleParams);

  const displayedTrades =
    isMultiAsset && selectedAsset
      ? currentResult!.trades.filter((t) => t.symbol === selectedAsset.symbol)
      : currentResult?.trades ?? [];

  return {
    isMultiAsset,
    multiAssets,
    selectedAssetIndex,
    setSelectedAssetIndex,
    selectedAsset,
    assetCandles,
    displayedTrades,
  };
}
