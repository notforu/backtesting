/**
 * Chart section with multi-asset tab selector.
 * Renders either a per-asset chart, portfolio chart, or single-asset chart.
 */

import { Chart } from '../Chart';
import { PortfolioChart } from '../Chart/PortfolioChart';
import { ErrorBoundary } from '../ErrorBoundary/ErrorBoundary';
import { getFrShortThreshold, getFrLongThreshold, configDateToTimestamp } from '../../utils/frThresholds';
import type { BacktestResult, Timeframe } from '../../types';
import type { MultiAssetItem } from '../../hooks/useMultiAsset';

interface ChartSectionProps {
  currentResult: BacktestResult | null;
  isMultiAsset: boolean;
  multiAssets: MultiAssetItem[];
  selectedAssetIndex: number;
  onSelectAsset: (idx: number) => void;
  selectedAsset: MultiAssetItem | null;
  assetCandles: BacktestResult['candles'] | undefined;
}

export function ChartSection({
  currentResult,
  isMultiAsset,
  multiAssets,
  selectedAssetIndex,
  onSelectAsset,
  selectedAsset,
  assetCandles,
}: ChartSectionProps) {
  const result = currentResult as BacktestResult;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-white">
          {isMultiAsset ? 'Multi-Asset Portfolio' : 'Chart'}
        </h2>
        {currentResult && (
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>
              {isMultiAsset && selectedAsset
                ? `${selectedAsset.label} / ${selectedAsset.timeframe}`
                : isMultiAsset
                  ? `${multiAssets.length} assets`
                  : `${result.config.symbol} / ${currentResult.config.timeframe}`}
            </span>
            <span>
              {new Date(currentResult.config.startDate).toLocaleDateString()}{' '}
              -{' '}
              {new Date(currentResult.config.endDate).toLocaleDateString()}
            </span>
            <span>
              {isMultiAsset && selectedAsset
                ? `${assetCandles?.length ?? 0} candles`
                : isMultiAsset
                  ? `${currentResult.trades.length} trades`
                  : `${result.candles?.length ?? 0} candles`}
            </span>
          </div>
        )}
      </div>

      {/* Multi-asset tab selector */}
      {isMultiAsset && multiAssets.length > 0 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          <button
            onClick={() => onSelectAsset(-1)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedAssetIndex === -1
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
            }`}
          >
            Portfolio
          </button>
          {multiAssets.map((asset, idx) => (
            <button
              key={asset.symbol}
              onClick={() => onSelectAsset(idx)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedAssetIndex === idx
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
            >
              {asset.label} ({asset.timeframe})
            </button>
          ))}
        </div>
      )}

      <ErrorBoundary label="Chart">
        {isMultiAsset && selectedAsset ? (
          /* Multi-asset with specific asset selected */
          <>
            {assetCandles && assetCandles.length > 0 ? (
              <Chart
                candles={assetCandles}
                trades={currentResult!.trades.filter((t) => t.symbol === selectedAsset.symbol)}
                height={450}
                isFutures={true}
                backtestTimeframe={selectedAsset.timeframe as Timeframe}
                exchange={result.config.exchange}
                symbol={selectedAsset.symbol}
                startDate={configDateToTimestamp(result.config.startDate)}
                endDate={configDateToTimestamp(result.config.endDate)}
                rollingMetrics={(currentResult as any).perAssetResults?.[selectedAsset.symbol]?.rollingMetrics}
                frShortThreshold={getFrShortThreshold(result, selectedAsset.symbol)}
                frLongThreshold={getFrLongThreshold(result, selectedAsset.symbol)}
                indicators={(currentResult as any).perAssetResults?.[selectedAsset.symbol]?.indicators}
              />
            ) : (
              <div className="h-[450px] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
                Loading candles for {selectedAsset.label}...
              </div>
            )}
          </>
        ) : isMultiAsset ? (
          /* Portfolio view - equity curve for the whole portfolio */
          <PortfolioChart
            equity={(currentResult as any).equity ?? []}
            rollingMetrics={(currentResult as any).rollingMetrics}
            trades={currentResult!.trades}
            height={450}
          />
        ) : (
          /* Single-asset chart */
          <Chart
            candles={result?.candles ?? []}
            trades={currentResult?.trades ?? []}
            height={450}
            isFutures={
              (currentResult as any)?.config?.mode === 'futures' ||
              result?.metrics?.totalFundingIncome !== undefined
            }
            backtestTimeframe={result?.config.timeframe}
            exchange={result?.config.exchange}
            symbol={result?.config.symbol}
            startDate={configDateToTimestamp(result?.config.startDate)}
            endDate={configDateToTimestamp(result?.config.endDate)}
            rollingMetrics={result?.rollingMetrics}
            frShortThreshold={getFrShortThreshold(result)}
            frLongThreshold={getFrLongThreshold(result)}
            indicators={result?.indicators}
          />
        )}
      </ErrorBoundary>
    </section>
  );
}
