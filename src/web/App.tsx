/**
 * Main application component.
 * Provides the layout structure with sidebar, chart, and dashboard.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chart } from './components/Chart';
import { Dashboard } from './components/Dashboard';
import { StrategyConfig } from './components/StrategyConfig';
import { History } from './components/History';
import { useBacktestStore } from './stores/backtestStore';
import { getTradeActionLabel, getTradeActionColor, isCloseTrade } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function AppContent() {
  const { currentResult } = useBacktestStore();

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

          {/* Status indicator */}
          <div className="flex items-center gap-2 text-sm">
            {currentResult && (
              <span className="text-gray-400">
                Last run:{' '}
                <span className="text-white">
                  {currentResult.config.strategyName}
                </span>{' '}
                on{' '}
                <span className="text-white">{currentResult.config.symbol}</span>
              </span>
            )}
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
                <h2 className="text-lg font-semibold text-white">Chart</h2>
                {currentResult && (
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>
                      {currentResult.config.symbol} /{' '}
                      {currentResult.config.timeframe}
                    </span>
                    <span>
                      {new Date(currentResult.config.startDate).toLocaleDateString()}{' '}
                      -{' '}
                      {new Date(currentResult.config.endDate).toLocaleDateString()}
                    </span>
                    <span>{currentResult.candles.length} candles</span>
                  </div>
                )}
              </div>
              <Chart
                candles={currentResult?.candles ?? []}
                trades={currentResult?.trades ?? []}
                height={450}
              />
            </section>

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
                        <th className="pb-2 pr-4">Fee</th>
                        <th className="pb-2 pr-4">Balance</th>
                        <th className="pb-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentResult.trades.slice(0, 100).map((trade, index) => {
                        const hasClosePnl = isCloseTrade(trade);

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
                              {trade.fee ? `$${trade.fee.toFixed(2)}` : '-'}
                            </td>
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
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
