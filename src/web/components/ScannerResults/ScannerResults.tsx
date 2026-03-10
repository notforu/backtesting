/**
 * Scanner results table component.
 * Displays multi-market scan results sorted by Sharpe ratio.
 */

import { useScannerStore } from '../../stores/scannerStore';
import { useConfigStore } from '../../stores/backtestStore';
import { useRunBacktest } from '../../hooks/useBacktest';
import { useAuthStore } from '../../stores/authStore';
import type { ScanResultRow } from '../../types';

export function ScannerResults() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { scanResults, isScanning, scanProgress, scanSummary, scanError } = useScannerStore();
  const { setSymbol } = useConfigStore();
  const runBacktestMutation = useRunBacktest();
  const configStore = useConfigStore();

  // Sort results by Sharpe ratio (descending), errors at bottom
  const sortedResults = [...scanResults].sort((a, b) => {
    if (a.status === 'error' && b.status !== 'error') return 1;
    if (a.status !== 'error' && b.status === 'error') return -1;
    return b.metrics.sharpeRatio - a.metrics.sharpeRatio;
  });

  const handleRowClick = (result: ScanResultRow) => {
    if (result.status === 'error') return;
    if (!isAuthenticated) return;
    // Set the symbol in config store and run a full backtest
    setSymbol(result.symbol);
    const config = configStore.getConfig();
    runBacktestMutation.mutate({
      ...config,
      symbol: result.symbol,
    });
  };

  if (scanResults.length === 0 && !isScanning) return null;

  return (
    <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          Scanner Results
          {scanSummary && (
            <span className="text-sm font-normal text-gray-400 ml-2">
              ({scanSummary.profitable}/{scanSummary.total} profitable, avg Sharpe: {scanSummary.avgSharpe.toFixed(2)})
            </span>
          )}
        </h2>
        {isAuthenticated && !isScanning && scanResults.length > 0 && (
          <button
            onClick={() => useScannerStore.getState().clearResults()}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Progress bar */}
      {isScanning && scanProgress && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-gray-400 mb-1">
            <span>Scanning market {scanProgress.current} of {scanProgress.total}...</span>
            <span>{Math.round((scanProgress.current / scanProgress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {scanError && (
        <div className="mb-4 bg-red-900/50 border border-red-700 rounded p-2 text-sm text-red-300">
          {scanError}
        </div>
      )}

      {/* Results table */}
      {sortedResults.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">Market</th>
                <th className="pb-2 pr-4 text-right">Sharpe</th>
                <th className="pb-2 pr-4 text-right">Return %</th>
                <th className="pb-2 pr-4 text-right">Trades</th>
                <th className="pb-2 pr-4 text-right">Win Rate %</th>
                <th className="pb-2 pr-4 text-right">Max DD %</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((result, index) => {
                const isError = result.status === 'error';
                const isProfitable = !isError && result.metrics.totalReturnPercent > 0;

                return (
                  <tr
                    key={result.symbol}
                    onClick={() => handleRowClick(result)}
                    className={`
                      border-b border-gray-700/50 transition-colors
                      ${isError || !isAuthenticated ? 'opacity-50 cursor-default' : 'hover:bg-gray-700/30 cursor-pointer'}
                    `}
                  >
                    <td className="py-2 pr-4 text-gray-500">{index + 1}</td>
                    <td className="py-2 pr-4 text-white max-w-[200px] truncate" title={result.symbol}>
                      {result.symbol.replace('PM:', '')}
                    </td>
                    <td className={`py-2 pr-4 text-right ${isProfitable ? 'text-green-400' : isError ? 'text-gray-500' : 'text-red-400'}`}>
                      {isError ? '-' : result.metrics.sharpeRatio.toFixed(2)}
                    </td>
                    <td className={`py-2 pr-4 text-right ${isProfitable ? 'text-green-400' : isError ? 'text-gray-500' : 'text-red-400'}`}>
                      {isError ? '-' : `${result.metrics.totalReturnPercent >= 0 ? '+' : ''}${result.metrics.totalReturnPercent.toFixed(1)}%`}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-300">
                      {isError ? '-' : result.tradesCount}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-300">
                      {isError ? '-' : `${result.metrics.winRate.toFixed(1)}%`}
                    </td>
                    <td className="py-2 pr-4 text-right text-red-400">
                      {isError ? '-' : `-${result.metrics.maxDrawdownPercent.toFixed(1)}%`}
                    </td>
                    <td className="py-2 text-right">
                      {isError ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-400" title={result.error}>
                          Error
                        </span>
                      ) : (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${isProfitable ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                          {isProfitable ? 'Profit' : 'Loss'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary footer */}
      {scanSummary && (
        <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-4 text-xs text-gray-400">
          <span>Total: {scanSummary.total} markets</span>
          <span className="text-green-400">{scanSummary.profitable} profitable</span>
          <span>Avg Sharpe: {scanSummary.avgSharpe.toFixed(2)}</span>
          <span>Avg Return: {scanSummary.avgReturn >= 0 ? '+' : ''}{scanSummary.avgReturn.toFixed(1)}%</span>
        </div>
      )}
    </section>
  );
}

export default ScannerResults;
