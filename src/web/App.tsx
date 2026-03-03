/**
 * Main application component.
 * Provides the layout structure with sidebar, chart, and dashboard.
 */

import { useState, useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chart } from './components/Chart';
import { PortfolioChart } from './components/Chart/PortfolioChart';
import { PairsChart } from './components/PairsChart';
import { SpreadChart } from './components/SpreadChart';
import { Dashboard } from './components/Dashboard';
import { StrategyConfig } from './components/StrategyConfig';
import { OptimizerModal } from './components/OptimizerModal';
import { ScannerResults } from './components/ScannerResults';
import { HistoryExplorer } from './components/HistoryExplorer';
import { RunParamsModal } from './components/HistoryExplorer/RunParamsModal';
import { useBacktestStore, useConfigStore } from './stores/backtestStore';
import { useScannerStore } from './stores/scannerStore';
import { useLoadBacktest, useCandles, useRunBacktest } from './hooks/useBacktest';
import { runAdhocAggregation } from './api/client';
import { getTradeActionLabel, getTradeActionColor, isCloseTrade, type BacktestResult, type PairsBacktestResult, type BacktestSummary, type Timeframe } from './types';
import { PaperTradingPage } from './components/PaperTradingPage';
import { usePaperTradingStore } from './stores/paperTradingStore';
import { useAuthStore } from './stores/authStore';
import { LoginPage } from './components/LoginPage';

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
  const runBacktestMutation = useRunBacktest();
  const { setRunning, setResult, setError } = useBacktestStore();
  const { scanResults } = useScannerStore();
  const { activePage, setActivePage } = usePaperTradingStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authUser = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const isPairs = currentResult && isPairsResult(currentResult);
  const showScanner = scanResults.length > 0;
  const [showExplorer, setShowExplorer] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);

  // Multi-asset state
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1); // -1 = portfolio view

  // Detect multi-asset via perAssetResults (new approach) with fallback for legacy MULTI symbol
  const perAssetResults = (currentResult as any)?.perAssetResults as Record<string, import('./types').PerAssetResult> | undefined;
  const isMultiAsset = currentResult && perAssetResults && Object.keys(perAssetResults).length > 0;
  const multiAssets = isMultiAsset
    ? Object.entries(perAssetResults!).map(([symbol, par]) => ({
        symbol,
        timeframe: par.timeframe,
        label: symbol.replace('/USDT:USDT', ''),
      }))
    : [];
  const selectedAsset = selectedAssetIndex >= 0 && selectedAssetIndex < multiAssets.length
    ? multiAssets[selectedAssetIndex]
    : null;

  // Build a BacktestSummary-like object from currentResult for RunParamsModal
  const currentRunSummary = useMemo<BacktestSummary | null>(() => {
    if (!currentResult) return null;
    return {
      id: selectedBacktestId ?? 'current',
      strategyName: currentResult.config.strategyName,
      symbol: isPairs
        ? `${(currentResult as PairsBacktestResult).config.symbolA} / ${(currentResult as PairsBacktestResult).config.symbolB}`
        : (currentResult as BacktestResult).config.symbol ?? 'MULTI',
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
  }, [currentResult, selectedBacktestId, isPairs]);

  // If not authenticated, force paper-trading page (backtesting requires auth)
  useEffect(() => {
    if (!isAuthenticated && activePage === 'backtesting') {
      setActivePage('paper-trading');
    }
  }, [isAuthenticated, activePage, setActivePage]);

  // Reset selected asset when result changes
  useEffect(() => {
    setSelectedAssetIndex(-1);
  }, [currentResult?.id]);

  // Fetch candles for selected asset in multi-asset view
  const candleParams = selectedAsset && currentResult ? {
    exchange: (currentResult as BacktestResult).config.exchange,
    symbol: selectedAsset.symbol,
    timeframe: selectedAsset.timeframe as Timeframe,
    startDate: (() => {
      const sd = (currentResult as BacktestResult).config.startDate;
      const timestamp = sd != null ? (typeof sd === 'number' ? sd : new Date(sd).getTime()) : 0;
      return new Date(timestamp).toISOString().split('T')[0];
    })(),
    endDate: (() => {
      const ed = (currentResult as BacktestResult).config.endDate;
      const timestamp = ed != null ? (typeof ed === 'number' ? ed : new Date(ed).getTime()) : 0;
      return new Date(timestamp).toISOString().split('T')[0];
    })(),
  } : null;
  const { data: assetCandles } = useCandles(candleParams);

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
          <div className="flex items-center gap-6">
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

            {/* Page navigation */}
            <nav className="flex items-center gap-1">
              {isAuthenticated && (
                <button
                  onClick={() => setActivePage('backtesting')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    activePage === 'backtesting'
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  Backtesting
                </button>
              )}
              <button
                onClick={() => setActivePage('paper-trading')}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  activePage === 'paper-trading'
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                Paper Trading
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {/* Status indicator + actions (only show in backtesting mode) */}
            {activePage === 'backtesting' && (
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
                {currentResult && currentResult.config.params && Object.keys(currentResult.config.params).length > 0 && (
                  <button
                    onClick={() => setShowParamsModal(true)}
                    className="px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Params
                  </button>
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
            )}

            {/* User info / login */}
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  {authUser?.username}
                </span>
                <button
                  onClick={() => authLogout()}
                  className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
              >
                Login
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      {activePage === 'backtesting' && (
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-96 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
          <div className="p-4 space-y-4">
            <StrategyConfig />
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Chart Section */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">
                  {isPairs ? 'Pairs Charts' : isMultiAsset ? 'Multi-Asset Portfolio' : 'Chart'}
                </h2>
                {currentResult && (
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>
                      {isPairs
                        ? `${(currentResult as PairsBacktestResult).config.symbolA} / ${(currentResult as PairsBacktestResult).config.symbolB}`
                        : isMultiAsset && selectedAsset
                          ? `${selectedAsset.label} / ${selectedAsset.timeframe}`
                          : isMultiAsset
                            ? `${multiAssets.length} assets`
                            : `${(currentResult as BacktestResult).config.symbol} / ${currentResult.config.timeframe}`}
                    </span>
                    <span>
                      {new Date(currentResult.config.startDate).toLocaleDateString()}{' '}
                      -{' '}
                      {new Date(currentResult.config.endDate).toLocaleDateString()}
                    </span>
                    <span>
                      {isPairs
                        ? `${(currentResult as PairsBacktestResult).candlesA.length} candles`
                        : isMultiAsset && selectedAsset
                          ? `${assetCandles?.length ?? 0} candles`
                          : isMultiAsset
                            ? `${currentResult.trades.length} trades`
                            : `${(currentResult as BacktestResult).candles?.length ?? 0} candles`}
                    </span>
                  </div>
                )}
              </div>

              {/* Multi-asset tab selector */}
              {isMultiAsset && multiAssets.length > 0 && (
                <div className="flex items-center gap-1 mb-3 flex-wrap">
                  <button
                    onClick={() => setSelectedAssetIndex(-1)}
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
                      onClick={() => setSelectedAssetIndex(idx)}
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
              ) : isMultiAsset && selectedAsset ? (
                /* Multi-asset with specific asset selected - show that asset's chart */
                <>
                  {assetCandles && assetCandles.length > 0 ? (
                    <Chart
                      candles={assetCandles}
                      trades={currentResult.trades.filter(t => t.symbol === selectedAsset.symbol)}
                      height={450}
                      isFutures={true}
                      backtestTimeframe={selectedAsset.timeframe as Timeframe}
                      exchange={(currentResult as BacktestResult).config.exchange}
                      symbol={selectedAsset.symbol}
                      startDate={(() => {
                        const sd = (currentResult as BacktestResult).config.startDate;
                        return sd != null ? (typeof sd === 'number' ? sd : new Date(sd).getTime()) : undefined;
                      })()}
                      endDate={(() => {
                        const ed = (currentResult as BacktestResult).config.endDate;
                        return ed != null ? (typeof ed === 'number' ? ed : new Date(ed).getTime()) : undefined;
                      })()}
                      rollingMetrics={(currentResult as any).perAssetResults?.[selectedAsset.symbol]?.rollingMetrics}
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
                  trades={currentResult.trades}
                  height={450}
                />
              ) : (
                /* Single-asset chart (original code) */
                <>
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
                    rollingMetrics={(currentResult as BacktestResult)?.rollingMetrics}
                  />
                </>
              )}
            </section>

            {/* Scanner Results - shown when scan results exist */}
            {showScanner && (
              <ScannerResults />
            )}

            {/* Dashboard Section */}
            <section>
              <Dashboard metrics={(() => {
                if (isMultiAsset && selectedAsset && currentResult) {
                  // First, try to use full per-asset results from aggregate engine
                  const perAssetResults = (currentResult as any).perAssetResults as Record<string, {
                    symbol: string;
                    timeframe: string;
                    trades: any[];
                    metrics: import('./types').PerformanceMetrics;
                    fundingIncome?: number;
                    tradingPnl?: number;
                  }> | undefined;

                  const assetResult = perAssetResults?.[selectedAsset.symbol];
                  if (assetResult?.metrics) {
                    // Full per-asset metrics available (from aggregate engine) - use directly
                    return assetResult.metrics;
                  }

                  // Fallback: build from perAssetSummary (loaded from history)
                  const perAssetSummary = (currentResult as any).config?.params?.perAssetSummary as Array<{
                    symbol: string;
                    timeframe: string;
                    sharpe: number;
                    returnPct: number;
                    trades: number;
                    fundingIncome: number;
                    tradingPnl: number;
                  }> | undefined;
                  const assetSummary = perAssetSummary?.find(a => a.symbol === selectedAsset.symbol);
                  if (assetSummary) {
                    const assetTrades = currentResult.trades.filter(t => t.symbol === selectedAsset.symbol);
                    const closeTrades = assetTrades.filter(t => t.action === 'CLOSE_LONG' || t.action === 'CLOSE_SHORT');
                    const wins = closeTrades.filter(t => (t.pnl ?? 0) > 0);
                    const losses = closeTrades.filter(t => (t.pnl ?? 0) <= 0);
                    const totalPnl = closeTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
                    const totalFees = assetTrades.reduce((sum, t) => sum + (t.fee ?? 0), 0);
                    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
                    const totalWins = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
                    const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

                    // Build metrics WITHOUT spreading portfolio-level metrics
                    // Only include fields we can actually compute from per-asset data
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
                      avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0,
                      avgWinPercent: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / wins.length : 0,
                      avgLossPercent: losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / losses.length : 0,
                      maxDrawdown: 0,
                      maxDrawdownPercent: 0,
                      totalFees,
                      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl ?? 0)) : 0,
                      largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl ?? 0)) : 0,
                      avgTradeDuration: 0,
                      exposureTime: 0,
                      expectancy: closeTrades.length > 0 ? totalPnl / closeTrades.length : 0,
                      expectancyPercent: closeTrades.length > 0
                        ? closeTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / closeTrades.length
                        : 0,
                      totalFundingIncome: assetSummary.fundingIncome,
                      tradingPnl: assetSummary.tradingPnl,
                    } as import('./types').PerformanceMetrics;
                  }
                }
                return currentResult?.metrics ?? null;
              })()} />
            </section>

            {/* Trades Table Section */}
            {currentResult && currentResult.trades.length > 0 && (
              <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                {(() => {
                  // Filter trades based on selected asset
                  const displayedTrades = isMultiAsset && selectedAsset
                    ? currentResult.trades.filter(t => t.symbol === selectedAsset.symbol)
                    : currentResult.trades;

                  return (
                    <>
                      <h2 className="text-lg font-semibold text-white mb-4">
                        Trades ({displayedTrades.length}
                        {isMultiAsset && selectedAsset && ` - ${selectedAsset.label}`}
                        {isMultiAsset && !selectedAsset && ` - All Assets`})
                      </h2>

                      {/* PnL Clarity Banner - shown only in futures mode when funding income data is available */}
                      {currentResult.metrics.totalFundingIncome !== undefined && !selectedAsset && (
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
                              {isMultiAsset && !selectedAsset && <th className="pb-2 pr-4">Asset</th>}
                              <th className="pb-2 pr-4">Action</th>
                              <th className="pb-2 pr-4">Price</th>
                              <th className="pb-2 pr-4">Amount</th>
                              <th className="pb-2 pr-4">P&L</th>
                              <th className="pb-2 pr-4">P&L %</th>
                              <th className="pb-2 pr-4">Cost</th>
                              {currentResult.metrics.totalFundingIncome !== undefined && (
                                <>
                                  <th className="pb-2 pr-4">Funding</th>
                                  <th className="pb-2 pr-4">FR Rate</th>
                                </>
                              )}
                              <th className="pb-2 pr-4">Balance</th>
                              <th className="pb-2">Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedTrades.slice(0, 100).map((trade, index) => {
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
                                  {isMultiAsset && !selectedAsset && (
                                    <td className="py-2 pr-4 text-gray-400 text-xs">
                                      {trade.symbol?.replace('/USDT:USDT', '') ?? '-'}
                                    </td>
                                  )}
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
                              <>
                                <td className={`py-2 pr-4 ${
                                  trade.fundingIncome == null
                                    ? 'text-gray-600'
                                    : trade.fundingIncome >= 0
                                      ? 'text-green-400'
                                      : 'text-red-400'
                                }`}>
                                  {trade.fundingIncome != null
                                    ? `${trade.fundingIncome >= 0 ? '+' : ''}$${trade.fundingIncome.toFixed(2)}`
                                    : '-'}
                                </td>
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
                              </>
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
                        {displayedTrades.length > 100 && (
                          <p className="text-sm text-gray-500 mt-3 text-center">
                            Showing first 100 of {displayedTrades.length} trades
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </section>
            )}
          </div>
        </main>
      </div>
      )}

      {activePage === 'paper-trading' && <PaperTradingPage />}

      {/* Footer */}
      <footer className="border-t border-gray-700 px-4 py-2 text-xs text-gray-500 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span>Backtesting Platform v1.0.0</span>
          <span>
            {activePage === 'backtesting' && currentResult && (
              <>
                Backtest completed in {currentResult.duration}ms |{' '}
                {currentResult.trades.length} trades
              </>
            )}
            {activePage === 'paper-trading' && 'Paper Trading Mode'}
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

      {/* Login modal — shown when unauthenticated user clicks Login */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="relative">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-sm font-bold z-10 transition-colors"
              aria-label="Close login"
            >
              ×
            </button>
            <LoginPage onSuccess={() => setShowLoginModal(false)} />
          </div>
        </div>
      )}

      {/* Run Params Modal — view/edit params for the current loaded run */}
      {showParamsModal && currentRunSummary && (
        <RunParamsModal
          run={currentRunSummary}
          isOpen={true}
          onClose={() => setShowParamsModal(false)}
          isRunning={useBacktestStore.getState().isRunning}
          onRerun={async (params) => {
            const isAgg = currentRunSummary.symbol === 'MULTI' || !!currentRunSummary.aggregationName;

            if (isAgg && params.subStrategies) {
              // Ad-hoc aggregation run with edited config
              setShowParamsModal(false);
              setRunning(true);
              try {
                const config = currentResult!.config as any;
                const result = await runAdhocAggregation({
                  subStrategies: params.subStrategies as any[],
                  allocationMode: (params.allocationMode as string) ?? config.allocationMode ?? 'top_n',
                  maxPositions: (params.maxPositions as number) ?? config.maxPositions ?? 5,
                  initialCapital: (params.initialCapital as number) ?? config.initialCapital ?? 10000,
                  startDate: config.startDate,
                  endDate: config.endDate,
                  exchange: (params.exchange as string) ?? config.exchange ?? 'bybit',
                  mode: (params.mode as string) ?? config.mode ?? 'futures',
                });
                setResult(result);
                // Invalidate history queries
                queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Aggregation run failed');
              }
            } else {
              // Strategy run — apply params to config and auto-trigger
              const { applyHistoryParams } = useConfigStore.getState();
              const updated = {
                ...currentResult!,
                config: { ...currentResult!.config, params },
              } as BacktestResult | PairsBacktestResult;
              applyHistoryParams(updated);
              setShowParamsModal(false);
              // Auto-trigger backtest with updated config
              const cfg = useConfigStore.getState().getConfig();
              runBacktestMutation.mutate(cfg);
            }
          }}
        />
      )}
    </div>
  );
}

function App() {
  const { loadFromStorage } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <QueryClientProvider client={queryClient}>
      <OptimizerModal />
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
