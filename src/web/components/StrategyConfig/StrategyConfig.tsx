/**
 * Strategy configuration panel component.
 * Compact sidebar showing recent runs and actions. Strategy form lives in RunBacktestModal.
 */

import { useState } from 'react';
import { useLoadBacktest } from '../../hooks/useBacktest';
import {
  useBacktestStore,
  useConfigStore,
  useOptimizerModalStore,
} from '../../stores/backtestStore';
import { useAggregationStore } from '../../stores/aggregationStore';
import { useAuthStore } from '../../stores/authStore';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore';
import type { BacktestSummary } from '../../types';
import { AggregationsPanel } from '../AggregationsPanel/AggregationsPanel';
import { Spinner } from '../Spinner/Spinner';
import { HistoryExplorerContent } from '../HistoryExplorer/HistoryExplorer';

export function StrategyConfig() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { activeConfigTab, setActiveConfigTab } = useAggregationStore();
  const { isRunning, error, selectedBacktestId } = useBacktestStore();
  const { strategy, applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();

  const { setOptimizerModalOpen } = useOptimizerModalStore();
  const openRunBacktestModal = useRunBacktestModalStore((s) => s.open);

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
          {/* Action Buttons */}
          {isAuthenticated && (
            <div className={`grid gap-2 pt-1 ${strategy ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <button
                onClick={() => openRunBacktestModal()}
                disabled={isRunning}
                className={`
                  py-2.5 rounded font-medium text-white transition-colors text-sm
                  ${!isRunning
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
                  className="py-2.5 rounded font-medium text-white transition-colors text-sm bg-purple-600 hover:bg-purple-500"
                >
                  Grid Search
                </button>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded p-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Recent Strategy Runs */}
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
        </>
      )}

      {activeConfigTab === 'aggregations' && <AggregationsPanel />}
    </div>
  );
}

export default StrategyConfig;
