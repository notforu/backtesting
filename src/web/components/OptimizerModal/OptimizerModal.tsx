/**
 * Grid Search Optimizer modal component.
 * Two tabs: Setup (configure and run optimization) and History (view/apply past results).
 */

import { useState } from 'react';
import { Modal } from '../Modal';
import {
  useOptimizerModalStore,
  useConfigStore,
  useOptimizationStore,
} from '../../stores/backtestStore';
import {
  useAllOptimizations,
  useRunOptimization,
  useDeleteOptimization,
} from '../../hooks/useOptimization';
import type { OptimizationRequest, OptimizationResult } from '../../types';

const OPTIMIZE_FOR_OPTIONS = [
  { value: 'sharpeRatio', label: 'Sharpe Ratio' },
  { value: 'totalReturnPercent', label: 'Total Return %' },
  { value: 'profitFactor', label: 'Profit Factor' },
  { value: 'winRate', label: 'Win Rate' },
] as const;

export function OptimizerModal() {
  const {
    isOptimizerModalOpen,
    optimizerModalTab,
    setOptimizerModalOpen,
    setOptimizerModalTab,
  } = useOptimizerModalStore();

  const {
    strategy,
    symbol,
    timeframe,
    startDate,
    endDate,
    initialCapital,
    getConfig,
    setParams,
  } = useConfigStore();

  const {
    isOptimizing,
    setOptimizing,
    setOptimizationError,
    setUsingOptimizedParams,
    clearOptimization,
  } = useOptimizationStore();

  // Setup tab state
  const [optimizeFor, setOptimizeFor] = useState<OptimizationRequest['optimizeFor']>('sharpeRatio');
  const [maxCombinations, setMaxCombinations] = useState(100);
  const [batchSize, setBatchSize] = useState(4);

  // History tab state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // History tab data
  const { data: allOptimizations, isLoading: loadingHistory } = useAllOptimizations();
  const runOptimizationMutation = useRunOptimization();
  const deleteOptimizationMutation = useDeleteOptimization();

  const handleClose = () => {
    setOptimizerModalOpen(false);
  };

  const handleRunOptimization = () => {
    if (!strategy || !symbol) return;

    setOptimizing(true);
    clearOptimization();

    const config = getConfig();
    runOptimizationMutation.mutate(
      {
        strategyName: config.strategyName,
        symbol: config.symbol,
        timeframe: config.timeframe,
        startDate: config.startDate,
        endDate: config.endDate,
        initialCapital: config.initialCapital,
        exchange: config.exchange || 'binance',
        optimizeFor,
        maxCombinations,
        batchSize,
      },
      {
        onSuccess: (result) => {
          setOptimizing(false);
          setParams(result.bestParams);
          setUsingOptimizedParams(true);
          // Switch to history tab to show result
          setOptimizerModalTab('history');
        },
        onError: (err) => {
          setOptimizationError(err.message);
          setOptimizing(false);
        },
      }
    );
  };

  const handleApplyOptimization = (result: OptimizationResult) => {
    setParams(result.bestParams);
    setUsingOptimizedParams(true);
    handleClose();
  };

  const handleDeleteOptimization = (strategyName: string, symbol: string, timeframe: string) => {
    deleteOptimizationMutation.mutate({ strategyName, symbol, timeframe });
  };

  const toggleRowExpansion = (id: string) => {
    setExpandedRowId(expandedRowId === id ? null : id);
  };

  const formatParamValue = (value: unknown): string => {
    if (typeof value === 'number') {
      // Format numbers with appropriate precision
      if (Number.isInteger(value)) {
        return value.toString();
      }
      return value.toFixed(4);
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (value === null || value === undefined) {
      return 'N/A';
    }
    return String(value);
  };

  const canRun = strategy && symbol && startDate && endDate && !isOptimizing;

  const inputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent';

  return (
    <Modal
      isOpen={isOptimizerModalOpen}
      onClose={handleClose}
      title="Grid Search Optimizer"
      size="xl"
    >
      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-700">
        <button
          onClick={() => setOptimizerModalTab('setup')}
          className={`px-4 py-2 font-medium transition-colors ${
            optimizerModalTab === 'setup'
              ? 'text-white border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Setup
        </button>
        <button
          onClick={() => setOptimizerModalTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            optimizerModalTab === 'history'
              ? 'text-white border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          History
        </button>
      </div>

      {/* Setup Tab */}
      {optimizerModalTab === 'setup' && (
        <div className="space-y-4">
          {/* Current Configuration (Read-only) */}
          <div className="bg-gray-700/50 rounded p-3 space-y-2">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Current Configuration</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-400">Strategy:</span>{' '}
                <span className="text-white">{strategy || 'Not selected'}</span>
              </div>
              <div>
                <span className="text-gray-400">Symbol:</span>{' '}
                <span className="text-white">{symbol || 'Not selected'}</span>
              </div>
              <div>
                <span className="text-gray-400">Timeframe:</span>{' '}
                <span className="text-white">{timeframe}</span>
              </div>
              <div>
                <span className="text-gray-400">Capital:</span>{' '}
                <span className="text-white">${initialCapital.toLocaleString()}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-400">Period:</span>{' '}
                <span className="text-white">
                  {startDate && endDate
                    ? `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`
                    : 'Not set'}
                </span>
              </div>
            </div>
          </div>

          {/* Optimization Settings */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Optimization Settings</h3>

            {/* Optimize For */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Optimize For</label>
              <select
                value={optimizeFor}
                onChange={(e) => setOptimizeFor(e.target.value as OptimizationRequest['optimizeFor'])}
                className={inputClass}
                disabled={isOptimizing}
              >
                {OPTIMIZE_FOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Max Combinations */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Max Combinations
              </label>
              <input
                type="number"
                value={maxCombinations}
                onChange={(e) => setMaxCombinations(parseInt(e.target.value) || 100)}
                min={1}
                max={1000}
                className={inputClass}
                disabled={isOptimizing}
              />
              <p className="text-xs text-gray-500 mt-1">
                Maximum number of parameter combinations to test
              </p>
            </div>

            {/* Batch Size */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Batch Size
              </label>
              <input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 4)}
                min={1}
                max={16}
                className={inputClass}
                disabled={isOptimizing}
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of parallel backtests to run
              </p>
            </div>
          </div>

          {/* Progress Indicator */}
          {isOptimizing && (
            <div className="bg-purple-900/30 border border-purple-700 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-purple-300">Optimizing parameters...</span>
                <span className="text-xs text-purple-400">
                  This may take several minutes
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300 animate-pulse"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          {/* Run Button */}
          <button
            onClick={handleRunOptimization}
            disabled={!canRun}
            className={`
              w-full py-3 rounded font-medium text-white transition-colors
              ${
                canRun
                  ? 'bg-purple-600 hover:bg-purple-500'
                  : 'bg-gray-600 cursor-not-allowed'
              }
            `}
          >
            {isOptimizing ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-5 w-5"
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
                Running Optimization...
              </span>
            ) : (
              'Run Optimization'
            )}
          </button>
        </div>
      )}

      {/* History Tab */}
      {optimizerModalTab === 'history' && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">Optimization Results</h3>

          {loadingHistory ? (
            <div className="text-sm text-gray-500 text-center py-8">Loading history...</div>
          ) : allOptimizations && allOptimizations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="pb-2 pr-3 w-8"></th>
                    <th className="pb-2 pr-3">Strategy</th>
                    <th className="pb-2 pr-3">Symbol</th>
                    <th className="pb-2 pr-3">TF</th>
                    <th className="pb-2 pr-3">Period</th>
                    <th className="pb-2 pr-3">Sharpe</th>
                    <th className="pb-2 pr-3">Return%</th>
                    <th className="pb-2 pr-3">Trades</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allOptimizations.map((opt) => {
                    const startDateStr = opt.startDate
                      ? new Date(opt.startDate).toLocaleDateString()
                      : '?';
                    const endDateStr = opt.endDate
                      ? new Date(opt.endDate).toLocaleDateString()
                      : '?';
                    const isExpanded = expandedRowId === opt.id;

                    return (
                      <>
                        <tr
                          key={opt.id}
                          className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                          onClick={() => toggleRowExpansion(opt.id)}
                        >
                          <td className="py-2 pr-3 text-gray-400">
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </td>
                          <td className="py-2 pr-3 text-white">{opt.strategyName}</td>
                          <td className="py-2 pr-3 text-gray-300">{opt.symbol}</td>
                          <td className="py-2 pr-3 text-gray-300">{opt.timeframe}</td>
                          <td className="py-2 pr-3 text-gray-400 text-xs">
                            {startDateStr} - {endDateStr}
                          </td>
                          <td className="py-2 pr-3 text-white">
                            {opt.bestMetrics.sharpeRatio?.toFixed(2) ?? 'N/A'}
                          </td>
                          <td className={`py-2 pr-3 ${
                            (opt.bestMetrics.totalReturnPercent ?? 0) >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}>
                            {(opt.bestMetrics.totalReturnPercent ?? 0) >= 0 ? '+' : ''}
                            {opt.bestMetrics.totalReturnPercent?.toFixed(2) ?? 'N/A'}%
                          </td>
                          <td className="py-2 pr-3 text-gray-300">
                            {opt.bestMetrics.totalTrades ?? 0}
                          </td>
                          <td className="py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleApplyOptimization(opt)}
                                className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded font-medium transition-colors"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => handleDeleteOptimization(opt.strategyName, opt.symbol, opt.timeframe)}
                                className="px-2 py-1 bg-red-600/80 hover:bg-red-500 text-white text-xs rounded font-medium transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${opt.id}-expanded`} className="border-b border-gray-700/50 bg-gray-800/50">
                            <td colSpan={9} className="py-3 px-4">
                              <div className="ml-6">
                                <h4 className="text-xs font-medium text-gray-400 mb-2">Optimized Parameters</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                  {Object.entries(opt.bestParams).map(([key, value]) => (
                                    <div key={key} className="bg-gray-700/50 rounded px-3 py-2">
                                      <div className="text-xs text-gray-400 mb-1">{key}</div>
                                      <div className="text-sm text-white font-medium">
                                        {formatParamValue(value)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-8">
              No optimization results yet. Run an optimization to see results here.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
