import { useLoadBacktest } from '../../hooks/useBacktest';
import { useBacktestStore, useConfigStore } from '../../stores/backtestStore';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore';
import type { BacktestSummary } from '../../types';
import { HistoryExplorerContent } from '../HistoryExplorer/HistoryExplorer';

export function AggregationsPanel() {
  const openRunBacktestModal = useRunBacktestModalStore((s) => s.open);
  const { applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();
  const selectedBacktestId = useBacktestStore((s) => s.selectedBacktestId);

  const handleSelectHistoryRun = async (run: BacktestSummary) => {
    const result = await loadBacktest(run.id);
    if (result) {
      applyHistoryParams(result);
    }
  };

  return (
    <div className="space-y-3">
      {/* New Backtest button */}
      <button
        onClick={() => openRunBacktestModal()}
        className="w-full py-2.5 rounded font-medium text-white bg-primary-600 hover:bg-primary-500 transition-colors text-sm"
      >
        + New Backtest
      </button>

      {/* Recent Aggregation Runs */}
      <div className="border-t border-gray-700 pt-3">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Aggregation Runs</h3>
        <HistoryExplorerContent
          fixedRunType="aggregations"
          compact={true}
          showFilters={false}
          showGroupToggle={false}
          maxHeight="320px"
          selectedId={selectedBacktestId}
          onSelectRun={handleSelectHistoryRun}
        />
      </div>
    </div>
  );
}
