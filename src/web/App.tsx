/**
 * Main application component.
 * Provides the layout structure with sidebar, chart, and dashboard.
 */

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chart } from './components/Chart';
import { PairsChart } from './components/PairsChart';
import { SpreadChart } from './components/SpreadChart';
import { PerformanceCharts } from './components/PerformanceCharts';
import { Dashboard } from './components/Dashboard';
import { StrategyConfig } from './components/StrategyConfig';
import { History } from './components/History';
import { OptimizerModal } from './components/OptimizerModal';
import { ScannerResults } from './components/ScannerResults';
import { HistoryExplorer } from './components/HistoryExplorer';
import { useBacktestStore, useConfigStore } from './stores/backtestStore';
import { useScannerStore } from './stores/scannerStore';
import { useLoadBacktest } from './hooks/useBacktest';
import { getTradeActionLabel, getTradeActionColor, isCloseTrade, type BacktestResult, type PairsBacktestResult } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function isPairsResult(result: unknown): result is PairsBacktestResult {
  if (result === null || typeof result !== 'object') return false;
  // Check for candlesA/candlesB (live results) OR symbolA in config (loaded from history)
  if ('candlesA' in result && 'candlesB' in result) return true;
  if ('config' in result) {
    const config = (result as any).config;
    return config && typeof config === 'object' && 'symbolA' in config && 'symbolB' in config;
  }
  return false;
}

function AppContent() {
  const { currentResult, selectedBacktestId } = useBacktestStore();
  const { applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();
  const { scanResults } = useScannerStore();
  const isPairs = currentResult && isPairsResult(currentResult);
  const showScanner = scanResults.length > 0;
  const [showExplorer, setShowExplorer] = useState(false);

  const handleSelectRun = async (id: string) => {
    const result = await loadBacktest(id);
    if (result) {
      applyHistoryParams(result);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-700 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg
              className="w-8 h-8 text-primary-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
              />
            </svg>
            <h1 className="text-xl font-bold text-white">
              Backtesting Platform
            </h1>
          </div>

          {/* Status indicator + actions */}
          <div className="flex items-center gap-4 text-sm">
            {currentResult && (
              <span className="text-gray-400">
                Last run:{' '}
                <span className="text-white">
                  {currentResult.config.strategyName}
                </span>{' '}
                on{' '}
                <span className="text-white">
                  {isPairs
                    ? `${(currentResult as PairsBacktestResult).config.symbolA} / ${(currentResult as PairsBacktestResult).config.symbolB}`
                    : (currentResult as BacktestResult).config.symbol}
                </span>
              </span>
            )}
            <button
              onClick={() => setShowExplorer(true)}
              className="px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Explore Runs
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
          <div className="p-4 space-y-4">
            <StrategyConfig />
            <History />
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Chart Section */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">
                  {isPairs ? 'Pairs Charts' : 'Chart'}
                </h2>
                {currentResult && (
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>
                      {isPairs
                        ? `${(currentResult as PairsBacktestResult).config.symbolA} / ${(currentResult as PairsBacktestResult).config.symbolB}`
                        : (currentResult as BacktestResult).config.symbol}{' '}
                      / {currentResult.config.timeframe}
                    </span>
                    <span>
                      {new Date(currentResult.config.startDate).toLocaleDateString()}{' '}
                      -{' '}
                      {new Date(currentResult.config.endDate).toLocaleDateString()}
                    </span>
                    <span>
                      {isPairs
                        ? `${(currentResult as PairsBacktestResult).candlesA.length} candles`
                        : `${(currentResult as BacktestResult).candles?.length ?? 0} candles`}
                    </span>
                  </div>
                )}
              </div>
              {isPairs ? (
                <>
                  <PairsChart
                    candlesA={(currentResult as PairsBacktestResult).candlesA}
                    candlesB={(currentResult as PairsBacktestResult).candlesB}
                    trades={currentResult.trades}
                    symbolA={(currentResult as PairsBacktestResult).config.symbolA}
                    symbolB={(currentResult as PairsBacktestResult).config.symbolB}
                    height={450}
                  />
                  <div className="mt-4">
                    <SpreadChart
                      spreadData={(currentResult as PairsBacktestResult).spreadData ?? []}
                      height={150}
                    />
                  </div>
                </>
              ) : (
                <Chart
                  candles={(currentResult as BacktestResult)?.candles ?? []}
                  trades={currentResult?.trades ?? []}
                  height={450}
                  isPolymarket={(currentResult as BacktestResult)?.config.exchange === 'polymarket'}
                  isFutures={
                    (currentResult as any)?.config?.mode === 'futures' ||
                    (currentResult as BacktestResult)?.metrics?.totalFundingIncome !== undefined
                  }
                  backtestTimeframe={(currentResult as BacktestResult)?.config.timeframe}
                  exchange={(currentResult as BacktestResult)?.config.exchange}
                  symbol={(currentResult as BacktestResult)?.config.symbol}
                  startDate={(() => { const sd = (currentResult as BacktestResult)?.config.startDate; return sd != null ? (typeof sd === 'number' ? sd : new Date(sd).getTime()) : undefined; })()}
                  endDate={(() => { const ed = (currentResult as BacktestResult)?.config.endDate; return ed != null ? (typeof ed === 'number' ? ed : new Date(ed).getTime()) : undefined; })()}
                />
              )}
            </section>

            {/* Scanner Results - shown when scan results exist */}
            {showScanner && (
              <ScannerResults />
            )}

            {/* Performance Charts */}
            {currentResult && currentResult.equity.length > 0 && (
              <section>
                <PerformanceCharts
                  equity={currentResult.equity}
                  rollingMetrics={currentResult.rollingMetrics}
                />
              </section>
            )}

            {/* Dashboard Section */}
            <section>
              <Dashboard metrics={currentResult?.metrics ?? null} />
            </section>

            {/* Trades Table Section */}
            {currentResult && currentResult.trades.length > 0 && (
              <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Trades ({currentResult.trades.length})
                </h2>

                {/* PnL Clarity Banner - shown only in futures mode when funding income data is available */}
                {currentResult.metrics.totalFundingIncome !== undefined && (
                  <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <div>
                      <span className="text-gray-400">Trading P&amp;L: </span>
                      <span className={`font-semibold ${(currentResult.metrics.tradingPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(currentResult.metrics.tradingPnl ?? 0) >= 0 ? '+' : ''}${(currentResult.metrics.tradingPnl ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-gray-600 hidden sm:block">|</div>
                    <div>
                      <span className="text-gray-400">Funding Income: </span>
                      <span className={`font-semibold ${(currentResult.metrics.totalFundingIncome ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(currentResult.metrics.totalFundingIncome ?? 0) >= 0 ? '+' : ''}${(currentResult.metrics.totalFundingIncome ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-gray-600 hidden sm:block">|</div>
                    <div>
                      <span className="text-gray-400">Total Return: </span>
                      <span className={`font-semibold ${currentResult.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {currentResult.metrics.totalReturn >= 0 ? '+' : ''}${currentResult.metrics.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="pb-2 pr-4">#</th>
                        <th className="pb-2 pr-4">Action</th>
                        <th className="pb-2 pr-4">Price</th>
                        <th className="pb-2 pr-4">Amount</th>
                        <th className="pb-2 pr-4">P&L</th>
                        <th className="pb-2 pr-4">P&L %</th>
                        <th className="pb-2 pr-4">Cost</th>
                        {currentResult.metrics.totalFundingIncome !== undefined && (
                          <th className="pb-2 pr-4">FR Rate</th>
                        )}
                        <th className="pb-2 pr-4">Balance</th>
                        <th className="pb-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentResult.trades.slice(0, 100).map((trade, index) => {
                        const hasClosePnl = isCloseTrade(trade);
                        const isFutures = currentResult.metrics.totalFundingIncome !== undefined;

                        return (
                          <tr
                            key={trade.id}
                            className="border-b border-gray-700/50 hover:bg-gray-700/30"
                          >
                            <td className="py-2 pr-4 text-gray-500">
                              {index + 1}
                            </td>
                            <td className="py-2 pr-4">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${getTradeActionColor(trade.action)}`}
                              >
                                {getTradeActionLabel(trade.action)}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-white">
                              ${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 pr-4 text-gray-300">
                              {trade.amount.toFixed(6)}
                            </td>
                            <td
                              className={`py-2 pr-4 ${
                                hasClosePnl
                                  ? (trade.pnl ?? 0) >= 0
                                    ? 'text-green-400'
                                    : 'text-red-400'
                                  : 'text-gray-500'
                              }`}
                            >
                              {hasClosePnl
                                ? `${(trade.pnl ?? 0) >= 0 ? '+' : ''}$${(trade.pnl ?? 0).toFixed(2)}`
                                : '-'}
                            </td>
                            <td
                              className={`py-2 pr-4 ${
                                hasClosePnl
                                  ? (trade.pnlPercent ?? 0) >= 0
                                    ? 'text-green-400'
                                    : 'text-red-400'
                                  : 'text-gray-500'
                              }`}
                            >
                              {hasClosePnl
                                ? `${(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%`
                                : '-'}
                            </td>
                            <td className="py-2 pr-4 text-gray-400">
                              {(trade.fee || trade.slippage) ? `$${((trade.fee ?? 0) + (trade.slippage ?? 0)).toFixed(2)}` : '-'}
                            </td>
                            {isFutures && (
                              <td className={`py-2 pr-4 font-mono text-xs ${
                                trade.fundingRate == null
                                  ? 'text-gray-600'
                                  : trade.fundingRate >= 0
                                    ? 'text-green-400'
                                    : 'text-red-400'
                              }`}>
                                {trade.fundingRate != null
                                  ? `${trade.fundingRate >= 0 ? '+' : ''}${(trade.fundingRate * 100).toFixed(4)}%`
                                  : '-'}
                              </td>
                            )}
                            <td className="py-2 pr-4 text-gray-300">
                              ${trade.balanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 text-gray-400">
                              {new Date(trade.timestamp).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {currentResult.trades.length > 100 && (
                    <p className="text-sm text-gray-500 mt-3 text-center">
                      Showing first 100 of {currentResult.trades.length} trades
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span>Backtesting Platform v1.0.0</span>
          <span>
            {currentResult && (
              <>
                Backtest completed in {currentResult.duration}ms |{' '}
                {currentResult.trades.length} trades
              </>
            )}
          </span>
        </div>
      </footer>

      {/* History Explorer Modal */}
      <HistoryExplorer
        isOpen={showExplorer}
        onClose={() => setShowExplorer(false)}
        onSelectRun={handleSelectRun}
        selectedId={selectedBacktestId}
      />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OptimizerModal />
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
