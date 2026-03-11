/**
 * Strategy configuration panel component.
 * Compact sidebar showing recent runs and actions. Strategy form lives in RunBacktestModal.
 */

import { useState } from 'react';
import { useLoadBacktest } from '../../hooks/useBacktest';
import { useOptimizedParams } from '../../hooks/useOptimization';
import {
  useBacktestStore,
  useConfigStore,
  useOptimizationStore,
  useOptimizerModalStore,
} from '../../stores/backtestStore';
import { useAggregationStore } from '../../stores/aggregationStore';
import { useAuthStore } from '../../stores/authStore';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import type { BacktestSummary, StrategyConfigListItem } from '../../types';
import { useStrategyConfigs } from '../../hooks/useConfigurations';
import { AggregationsPanel } from '../AggregationsPanel/AggregationsPanel';
import { Spinner } from '../Spinner/Spinner';
import { HistoryExplorerContent } from '../HistoryExplorer/HistoryExplorer';

export function StrategyConfig() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { activeConfigTab, setActiveConfigTab } = useAggregationStore();
  const { isRunning, error, selectedBacktestId } = useBacktestStore();
  const { strategy, symbol, timeframe, applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();

  // Optimization hooks
  const { data: optimizedParams } = useOptimizedParams(strategy, symbol, timeframe);
  const { isOptimizing, usingOptimizedParams, setUsingOptimizedParams } = useOptimizationStore();
  const { setOptimizerModalOpen } = useOptimizerModalStore();

  // Modal stores
  const openRunBacktestModal = useRunBacktestModalStore((s) => s.open);
  const setActivePage = usePaperTradingStore((s) => s.setActivePage);

  // Strategy configs list
  const { data: strategyConfigs, isLoading: isLoadingConfigs } = useStrategyConfigs();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  // Track which history run is being loaded
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  const handleSelectHistoryRun = async (run: BacktestSummary) => {
    setLoadingRunId(run.id);
    try {
      const result = await loadBacktest(run.id);
      if (result) {
        applyHistoryParams(result);
      }
    } finally {
      setLoadingRunId(null);
    }
  };

  const handleSelectConfig = async (config: StrategyConfigListItem) => {
    setSelectedConfigId(config.id);
  };

  const handleResetOptimized = () => {
    setUsingOptimizedParams(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 space-y-3">
      <h2 className="text-lg font-semibold text-white">Configuration</h2>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-700 -mx-3 px-3">
        <button
          onClick={() => setActiveConfigTab('strategies')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeConfigTab === 'strategies'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-300'
          }`}
        >
          Strategies
        </button>
        <button
          onClick={() => setActiveConfigTab('aggregations')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeConfigTab === 'aggregations'
              ? 'border-primary-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-300'
          }`}
        >
          Aggregations
        </button>
      </div>

      {activeConfigTab === 'strategies' && (
        <>
          {/* Strategy Configs List */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Saved Configurations</h3>
            {isLoadingConfigs ? (
              <div className="text-sm text-gray-500 py-2">Loading configurations...</div>
            ) : !strategyConfigs || strategyConfigs.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-3">
                No configurations yet. Run a backtest to create one.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                {strategyConfigs.map((config) => (
                  <div
                    key={config.id}
                    onClick={() => handleSelectConfig(config)}
                    className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedConfigId === config.id
                        ? 'border-primary-500 bg-primary-900/20'
                        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white truncate">
                        {config.strategyName}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {config.runCount} run{config.runCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">
                        {config.symbol.replace('/USDT:USDT', '')} · {config.timeframe}
                      </span>
                      {config.latestRunSharpe != null && (
                        <span className={`text-xs shrink-0 ${config.latestRunSharpe >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          Sharpe: {config.latestRunSharpe.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {isAuthenticated && (
            <div className={`grid gap-2 pt-1 ${strategy ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <button
                onClick={() => openRunBacktestModal()}
                disabled={isRunning || isOptimizing}
                className={`
                  py-2.5 rounded font-medium text-white transition-colors text-sm
                  ${!isRunning && !isOptimizing
                    ? 'bg-primary-600 hover:bg-primary-500'
                    : 'bg-gray-600 cursor-not-allowed'}
                `}
              >
                {isRunning ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner size="sm" />
                    Running...
                  </span>
                ) : (
                  '+ New Backtest'
                )}
              </button>

              {strategy && (
                <button
                  onClick={() => setOptimizerModalOpen(true)}
                  disabled={isOptimizing}
                  className={`
                    py-2.5 rounded font-medium text-white transition-colors text-sm
                    ${!isOptimizing
                      ? 'bg-purple-600 hover:bg-purple-500'
                      : 'bg-gray-600 cursor-not-allowed'}
                  `}
                >
                  {isOptimizing ? 'Searching...' : 'Grid Search'}
                </button>
              )}
            </div>
          )}

          {/* Optimized Params Indicator */}
          {usingOptimizedParams && optimizedParams && optimizedParams.length > 0 && (
            <div className="flex items-center justify-between text-xs bg-green-900/20 border border-green-700/50 rounded px-2 py-1.5">
              <span className="text-green-400 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                </svg>
                Grid Search Applied (Sharpe: {optimizedParams[0].bestMetrics.sharpeRatio.toFixed(2)})
              </span>
              <button
                onClick={handleResetOptimized}
                className="text-green-400 hover:text-green-300 underline"
              >
                reset
              </button>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded p-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Inline History */}
          <div className="border-t border-gray-700 pt-3 mt-1">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Strategy Runs</h3>
            {isRunning && (
              <div className="flex items-center gap-2 px-2 py-1.5 mb-2 bg-primary-900/30 border border-primary-800/50 rounded text-xs text-primary-300">
                <Spinner size="sm" />
                Running backtest...
              </div>
            )}
            <HistoryExplorerContent
              fixedRunType="strategies"
              compact={true}
              showFilters={false}
              showGroupToggle={false}
              maxHeight="320px"
              selectedId={selectedBacktestId}
              loadingId={loadingRunId}
              onSelectRun={handleSelectHistoryRun}
            />
          </div>

          {/* View All Configurations link */}
          <div className="pt-1 border-t border-gray-700">
            <button
              onClick={() => setActivePage('configurations')}
              className="w-full text-xs text-gray-400 hover:text-primary-400 transition-colors text-right py-1"
            >
              View All Configurations →
            </button>
          </div>
        </>
      )}

      {activeConfigTab === 'aggregations' && <AggregationsPanel />}
    </div>
  );
}

export default StrategyConfig;
