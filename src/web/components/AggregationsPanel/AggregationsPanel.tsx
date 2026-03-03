import { useAggregations, useDeleteAggregation, useRunAggregation, useLoadBacktest } from '../../hooks/useBacktest';
import { useAggregationStore } from '../../stores/aggregationStore';
import { CreateAggregationModal } from './CreateAggregationModal';
import { useBacktestStore, useConfigStore } from '../../stores/backtestStore';
import { useAuthStore } from '../../stores/authStore';
import { HistoryExplorerContent } from '../HistoryExplorer/HistoryExplorer';
import type { BacktestSummary } from '../../types';

export function AggregationsPanel() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: aggregations, isLoading } = useAggregations();
  const deleteAggregation = useDeleteAggregation();
  const runAggregationMutation = useRunAggregation();
  const { isRunning, selectedBacktestId } = useBacktestStore();
  const { applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();
  const {
    selectedAggregationId,
    setSelectedAggregation,
    startDate,
    endDate,
    initialCapital,
    setStartDate,
    setEndDate,
    setInitialCapital,
    isCreateModalOpen,
    setCreateModalOpen,
  } = useAggregationStore();

  const selectedAggregation = aggregations?.find(a => a.id === selectedAggregationId);

  const handleRun = () => {
    if (!selectedAggregationId) return;
    runAggregationMutation.mutate({
      id: selectedAggregationId,
      request: { startDate, endDate, initialCapital },
    });
  };

  const handleSelectHistoryRun = async (run: BacktestSummary) => {
    const result = await loadBacktest(run.id);
    if (result) {
      applyHistoryParams(result);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this aggregation?')) {
      deleteAggregation.mutate(id);
      if (selectedAggregationId === id) {
        setSelectedAggregation(null);
      }
    }
  };

  const inputClass = 'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  return (
    <div className="space-y-3">
      {/* Create New button - only for authenticated users */}
      {isAuthenticated && (
        <button
          onClick={() => setCreateModalOpen(true)}
          className="w-full py-2 rounded font-medium text-white bg-primary-600 hover:bg-primary-500 transition-colors text-sm"
        >
          + Create Aggregation
        </button>
      )}

      {/* Aggregation List */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading aggregations...</div>
      ) : !aggregations || aggregations.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-4">
          No aggregations yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {aggregations.map((agg) => (
            <div
              key={agg.id}
              onClick={() => {
                setSelectedAggregation(agg.id);
                setInitialCapital(agg.initialCapital);
              }}
              className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                selectedAggregationId === agg.id
                  ? 'border-primary-500 bg-primary-900/20'
                  : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{agg.name}</span>
                {isAuthenticated && (
                  <button
                    onClick={(e) => handleDelete(agg.id, e)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {agg.allocationMode.replace(/_/g, ' ')} | {agg.subStrategies.length} strategies
              </div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">
                {agg.subStrategies.map(s => s.symbol.replace('/USDT:USDT', '')).join(', ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Run Config (shown when aggregation selected) */}
      {selectedAggregation && (
        <div className="border-t border-gray-700 pt-3 space-y-3">
          <div className="text-sm font-medium text-white">
            Run: {selectedAggregation.name}
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {/* Initial Capital */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              min={0}
              step={1000}
              className={inputClass}
            />
          </div>

          {/* Sub-strategies summary */}
          <div className="bg-blue-900/20 border border-blue-700/30 rounded p-2.5">
            <div className="text-xs text-blue-400 font-medium mb-1">Sub-Strategies</div>
            {selectedAggregation.subStrategies.map((s, i) => (
              <div key={i} className="text-xs text-gray-400">
                {s.strategyName} on {s.symbol.replace('/USDT:USDT', '')} ({s.timeframe})
              </div>
            ))}
          </div>

          {/* Run button - only for authenticated users */}
          {isAuthenticated && (
            <button
              onClick={handleRun}
              disabled={isRunning}
              className={`w-full py-2.5 rounded font-medium text-white transition-colors text-sm ${
                !isRunning
                  ? 'bg-primary-600 hover:bg-primary-500'
                  : 'bg-gray-600 cursor-not-allowed'
              }`}
            >
              {isRunning ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Running...
                </span>
              ) : (
                'Run Aggregation'
              )}
            </button>
          )}
        </div>
      )}

      {/* Create Modal */}
      {isCreateModalOpen && (
        <CreateAggregationModal onClose={() => setCreateModalOpen(false)} />
      )}

      {/* Inline History */}
      <div className="border-t border-gray-700 pt-3 mt-3">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Aggregation Runs</h3>
        <HistoryExplorerContent
          fixedRunType="aggregations"
          compact={true}
          showFilters={false}
          showGroupToggle={false}
          maxHeight="280px"
          selectedId={selectedBacktestId}
          onSelectRun={handleSelectHistoryRun}
        />
      </div>
    </div>
  );
}
