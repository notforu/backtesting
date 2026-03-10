/**
 * Main application component.
 * Provides the layout structure with sidebar, chart, and dashboard.
 */

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './components/Dashboard';
import { StrategyConfig } from './components/StrategyConfig';
import { OptimizerModal } from './components/OptimizerModal';
import { ScannerResults } from './components/ScannerResults';
import { HistoryExplorer } from './components/HistoryExplorer';
import { RunParamsModal } from './components/HistoryExplorer/RunParamsModal';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { TradesTable } from './components/TradesTable/TradesTable';
import { AppHeader } from './components/AppHeader/AppHeader';
import { AppFooter } from './components/AppFooter/AppFooter';
import { LoginModal } from './components/LoginModal/LoginModal';
import { ChartSection } from './components/ChartSection/ChartSection';
import { useBacktestStore, useConfigStore } from './stores/backtestStore';
import { useScannerStore } from './stores/scannerStore';
import { useLoadBacktest, useRunBacktest } from './hooks/useBacktest';
import { usePerAssetMetrics } from './hooks/usePerAssetMetrics';
import { useMultiAsset } from './hooks/useMultiAsset';
import { useCurrentRunSummary } from './hooks/useCurrentRunSummary';
import { runAdhocAggregation } from './api/client';
import type { BacktestResult } from './types';
import { PaperTradingPage } from './components/PaperTradingPage';
import { ConfigurationsPage } from './components/ConfigurationsPage';
import { RunBacktestModal } from './components/RunBacktestModal/RunBacktestModal.js';
import { usePaperTradingStore } from './stores/paperTradingStore';
import { useAuthStore } from './stores/authStore';
import { useUrlSync } from './hooks/useUrlSync';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function AppContent() {
  useUrlSync();
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
  const [showExplorer, setShowExplorer] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);

  const showScanner = scanResults.length > 0;

  const {
    isMultiAsset,
    multiAssets,
    selectedAssetIndex,
    setSelectedAssetIndex,
    selectedAsset,
    assetCandles,
    displayedTrades,
  } = useMultiAsset(currentResult);

  const currentRunSummary = useCurrentRunSummary(currentResult, selectedBacktestId ?? null);
  const dashboardMetrics = usePerAssetMetrics(currentResult, !!isMultiAsset, selectedAsset);

  const handleSelectRun = async (id: string) => {
    const result = await loadBacktest(id);
    if (result) {
      applyHistoryParams(result);
    }
  };

  // Auto-load backtest when selectedBacktestId is set from URL (e.g. direct link)
  useEffect(() => {
    if (selectedBacktestId && !currentResult) {
      handleSelectRun(selectedBacktestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBacktestId]);

  const handleRerun = async (params: Record<string, unknown>) => {
    const isAgg =
      currentRunSummary?.symbol === 'MULTI' || !!currentRunSummary?.aggregationName;

    if (isAgg && params.subStrategies) {
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
        queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Aggregation run failed');
      }
    } else {
      const { applyHistoryParams: apply } = useConfigStore.getState();
      const updated = {
        ...currentResult!,
        config: { ...currentResult!.config, params },
      } as BacktestResult;
      apply(updated);
      setShowParamsModal(false);
      const cfg = useConfigStore.getState().getConfig();
      runBacktestMutation.mutate(cfg);
    }
  };

  const hasParams =
    !!currentResult?.config.params &&
    Object.keys(currentResult.config.params).length > 0;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <AppHeader
        activePage={activePage}
        onNavigate={setActivePage}
        currentResult={currentResult}
        onShowParams={() => setShowParamsModal(true)}
        onShowExplorer={() => setShowExplorer(true)}
        onShowLogin={() => setShowLoginModal(true)}
        isAuthenticated={isAuthenticated}
        username={authUser?.username}
        onLogout={authLogout}
        hasParams={hasParams}
      />

      {/* Main Content */}
      {activePage === 'backtesting' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar */}
          <aside className="w-96 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
            <div className="p-4 space-y-4">
              <ErrorBoundary label="StrategyConfig">
                <StrategyConfig />
              </ErrorBoundary>
            </div>
          </aside>

          {/* Main Area */}
          <main className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              <ErrorBoundary label="ChartSection">
                <ChartSection
                  currentResult={currentResult}
                  isMultiAsset={isMultiAsset}
                  multiAssets={multiAssets}
                  selectedAssetIndex={selectedAssetIndex}
                  onSelectAsset={setSelectedAssetIndex}
                  selectedAsset={selectedAsset}
                  assetCandles={assetCandles}
                />
              </ErrorBoundary>

              {showScanner && (
                <ErrorBoundary label="ScannerResults">
                  <ScannerResults />
                </ErrorBoundary>
              )}

              <section>
                <ErrorBoundary label="Dashboard">
                  <Dashboard metrics={dashboardMetrics} />
                </ErrorBoundary>
              </section>

              {currentResult && currentResult.trades.length > 0 && (
                <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <ErrorBoundary label="TradesTable">
                    <TradesTable
                      trades={displayedTrades}
                      metrics={currentResult.metrics}
                      showAssetColumn={!!(isMultiAsset && !selectedAsset)}
                      assetLabel={
                        isMultiAsset && selectedAsset
                          ? selectedAsset.label
                          : isMultiAsset
                            ? 'All Assets'
                            : undefined
                      }
                    />
                  </ErrorBoundary>
                </section>
              )}
            </div>
          </main>
        </div>
      )}

      {activePage === 'configurations' && (
        <ErrorBoundary label="ConfigurationsPage">
          <div className="flex-1 overflow-hidden">
            <ConfigurationsPage />
          </div>
        </ErrorBoundary>
      )}

      {activePage === 'paper-trading' && (
        <ErrorBoundary label="PaperTradingPage">
          <PaperTradingPage />
        </ErrorBoundary>
      )}

      <AppFooter activePage={activePage} currentResult={currentResult} />

      <HistoryExplorer
        isOpen={showExplorer}
        onClose={() => setShowExplorer(false)}
        onSelectRun={handleSelectRun}
        selectedId={selectedBacktestId}
      />

      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}

      {showParamsModal && currentRunSummary && (
        <RunParamsModal
          run={currentRunSummary}
          isOpen={true}
          onClose={() => setShowParamsModal(false)}
          isRunning={useBacktestStore.getState().isRunning}
          onRerun={handleRerun}
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
      <ErrorBoundary label="App">
        <OptimizerModal />
        <RunBacktestModal />
        <AppContent />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
