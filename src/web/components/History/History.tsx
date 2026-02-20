/**
 * History component showing past backtest runs.
 * Allows loading and deleting previous results.
 */

import { useHistory, useLoadBacktest, useDeleteBacktest, useDeleteAllHistory } from '../../hooks/useBacktest';
import { useBacktestStore, useConfigStore } from '../../stores/backtestStore';
import type { BacktestSummary } from '../../types';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatReturn(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

interface HistoryItemProps {
  item: BacktestSummary;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

function HistoryItem({
  item,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: HistoryItemProps) {
  const returnColor =
    item.totalReturnPercent >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div
      className={`
        group relative p-3 rounded-lg border cursor-pointer transition-colors
        ${
          isSelected
            ? 'bg-primary-900/30 border-primary-600'
            : 'bg-gray-800 border-gray-700 hover:border-gray-600'
        }
      `}
      onClick={onSelect}
    >
      {/* Main content */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">
              {item.strategyName}
            </span>
            <span className="text-xs text-gray-500">{item.timeframe}</span>
          </div>
          <div className="text-sm text-gray-400 truncate">{item.symbol}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`font-medium ${returnColor}`}>
            {formatReturn(item.totalReturnPercent)}
          </div>
          <div className="text-xs text-gray-500">
            Sharpe: {item.sharpeRatio.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Date */}
      <div className="text-xs text-gray-500 mt-2">{formatDate(item.runAt)}</div>

      {/* Delete button - shows on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={isDeleting}
        className={`
          absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100
          transition-opacity bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white
          ${isDeleting ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title="Delete backtest"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </div>
  );
}

export function History() {
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useHistory();
  const { selectedBacktestId } = useBacktestStore();
  const { applyHistoryParams } = useConfigStore();
  const { loadBacktest } = useLoadBacktest();
  const deleteMutation = useDeleteBacktest();
  const deleteAllMutation = useDeleteAllHistory();

  // Flatten pages into single list
  const history = data?.pages.flatMap(page => page.results) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const handleSelect = async (id: string) => {
    const result = await loadBacktest(id);
    if (result) {
      applyHistoryParams(result);
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Delete all backtest history? This cannot be undone.')) {
      deleteAllMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 className="text-lg font-semibold text-white mb-4">History</h2>
        <div className="flex items-center justify-center py-8">
          <svg
            className="animate-spin h-6 w-6 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 className="text-lg font-semibold text-white mb-4">History</h2>
        <div className="text-sm text-red-400 bg-red-900/30 rounded p-3">
          Failed to load history: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">History</h2>
        {history.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {history.length} of {total} run{total !== 1 ? 's' : ''}
            </span>
            <button
              onClick={handleClearAll}
              disabled={deleteAllMutation.isPending}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed underline"
            >
              {deleteAllMutation.isPending ? 'Clearing...' : 'Clear All'}
            </button>
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <svg
            className="w-12 h-12 mx-auto mb-3 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm">No backtest runs yet</p>
          <p className="text-xs text-gray-600 mt-1">
            Configure and run your first backtest
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {history.map((item) => (
            <HistoryItem
              key={item.id}
              item={item}
              isSelected={selectedBacktestId === item.id}
              onSelect={() => handleSelect(item.id)}
              onDelete={() => deleteMutation.mutate(item.id)}
              isDeleting={deleteMutation.isPending}
            />
          ))}

          {/* Load More button */}
          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full py-2 text-sm text-gray-400 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFetchingNextPage ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Loading...
                </span>
              ) : (
                'Load More'
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default History;
