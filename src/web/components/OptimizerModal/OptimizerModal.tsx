/**
 * Grid Search modal component.
 * Two tabs: Setup (configure and run grid search) and History (view/apply past results).
 */

import { useState, useEffect, useMemo } from 'react';
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
import { useStrategy } from '../../hooks/useBacktest';
import type { OptimizationRequest, OptimizationResult, ParamRange, StrategyParam } from '../../types';

const OPTIMIZE_FOR_OPTIONS = [
  { value: 'sharpeRatio', label: 'Sharpe Ratio' },
  { value: 'sortinoRatio', label: 'Sortino Ratio' },
  { value: 'totalReturnPercent', label: 'Total Return %' },
  { value: 'profitFactor', label: 'Profit Factor' },
  { value: 'winRate', label: 'Win Rate' },
  { value: 'maxDrawdownPercent', label: 'Max Drawdown % (min)' },
  { value: 'composite', label: 'Composite Score' },
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

  // Fetch strategy details to get parameter definitions
  const { data: strategyDetails } = useStrategy(strategy);

  // Setup tab state
  const [optimizeFor, setOptimizeFor] = useState<OptimizationRequest['optimizeFor']>('sharpeRatio');
  const [minTrades, setMinTrades] = useState<number>(10);
  const [maxCombinations, setMaxCombinations] = useState(100);
  const [batchSize, setBatchSize] = useState(4);
  const [saveAllRuns, setSaveAllRuns] = useState(false);
  const [mode, setMode] = useState<'spot' | 'futures'>('spot');
  const [multiSymbols, setMultiSymbols] = useState('');
  const [multiTimeframes, setMultiTimeframes] = useState<string[]>([]);

  // Parameter ranges state - initialized from strategy params
  const [paramRanges, setParamRanges] = useState<Record<string, ParamRange>>({});

  // Initialize param ranges when strategy changes
  useEffect(() => {
    if (strategyDetails?.params) {
      const initialRanges: Record<string, ParamRange> = {};

      strategyDetails.params.forEach((param: StrategyParam) => {
        if (param.type === 'number' && param.min !== undefined && param.max !== undefined) {
          initialRanges[param.name] = {
            min: param.min,
            max: param.max,
            step: param.step ?? 1,
          };
        }
      });

      setParamRanges(initialRanges);
    }
  }, [strategyDetails]);

  // Calculate total combinations
  const totalCombinations = useMemo(() => {
    if (!strategyDetails?.params) return 0;

    let total = 1;
    strategyDetails.params.forEach((param: StrategyParam) => {
      if (param.type === 'number') {
        const range = paramRanges[param.name];
        if (range) {
          const steps = Math.floor((range.max - range.min) / range.step) + 1;
          total *= steps;
        }
      } else if (param.type === 'boolean') {
        // Boolean parameters test both true and false
        total *= 2;
      }
    });

    return Math.min(total, maxCombinations);
  }, [strategyDetails, paramRanges, maxCombinations]);

  // History tab state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // History tab data
  const { data: allOptimizations, isLoading: loadingHistory } = useAllOptimizations();
  const { mutate: runOptimizationMutate, progress: optimizationProgress, isPending: isOptimizationPending } = useRunOptimization();
  const deleteOptimizationMutation = useDeleteOptimization();

  const handleClose = () => {
    setOptimizerModalOpen(false);
  };

  const handleParamRangeChange = (paramName: string, field: keyof ParamRange, value: number) => {
    setParamRanges(prev => ({
      ...prev,
      [paramName]: {
        ...prev[paramName],
        [field]: value,
      },
    }));
  };

  const handleRunOptimization = () => {
    if (!strategy || !symbol) return;

    setOptimizing(true);
    clearOptimization();
    // Switch to history tab immediately to show progress
    setOptimizerModalTab('history');

    const config = getConfig();
    runOptimizationMutate(
      {
        strategyName: config.strategyName,
        symbol: config.symbol,
        timeframe: config.timeframe,
        startDate: config.startDate,
        endDate: config.endDate,
        initialCapital: config.initialCapital,
        exchange: config.exchange || 'binance',
        paramRanges,
        optimizeFor,
        minTrades,
        maxCombinations,
        batchSize,
        saveAllRuns,
        mode,
        ...(multiSymbols.trim() ? { symbols: multiSymbols.split(',').map(s => s.trim()).filter(Boolean) } : {}),
        ...(multiTimeframes.length > 0 ? { timeframes: multiTimeframes } : {}),
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

  const smallInputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent';

  return (
    <Modal
      isOpen={isOptimizerModalOpen}
      onClose={handleClose}
      title="Grid Search Optimizer"
      size="2xl"
    >
      {/* Tabs */}
      <div className="flex gap-2 mb-2 border-b border-gray-700">
        <button
          onClick={() => setOptimizerModalTab('setup')}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            optimizerModalTab === 'setup'
              ? 'text-white border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Setup
        </button>
        <button
          onClick={() => setOptimizerModalTab('history')}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
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
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
          {/* Current Configuration (Read-only) */}
          <div className="bg-gray-700/50 rounded p-2">
            <h3 className="text-xs font-medium text-gray-300 mb-1.5">Current Configuration</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
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
              <div className="col-span-3">
                <span className="text-gray-400">Period:</span>{' '}
                <span className="text-white">
                  {startDate && endDate
                    ? `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`
                    : 'Not set'}
                </span>
              </div>
            </div>
          </div>

          {/* Parameter Ranges */}
          {strategyDetails?.params && strategyDetails.params.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-medium text-gray-300">Parameter Ranges</h3>
                <p className="text-xs text-gray-500">Configure the search space</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {strategyDetails.params.map((param: StrategyParam) => {
                  if (param.type === 'number') {
                    const range = paramRanges[param.name] || {
                      min: param.min ?? (param.default as number),
                      max: param.max ?? (param.default as number),
                      step: param.step ?? 1,
                    };

                    return (
                      <div key={param.name} className="bg-gray-700/30 rounded p-2">
                        <div className="text-xs text-white font-medium mb-1">{param.label}</div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <label className="block text-xs text-gray-400 mb-0.5">Min</label>
                            <input
                              type="number"
                              value={range.min}
                              onChange={(e) => handleParamRangeChange(param.name, 'min', parseFloat(e.target.value) || 0)}
                              className={smallInputClass}
                              disabled={isOptimizing}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-0.5">Max</label>
                            <input
                              type="number"
                              value={range.max}
                              onChange={(e) => handleParamRangeChange(param.name, 'max', parseFloat(e.target.value) || 0)}
                              className={smallInputClass}
                              disabled={isOptimizing}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-0.5">Step</label>
                            <input
                              type="number"
                              value={range.step}
                              onChange={(e) => handleParamRangeChange(param.name, 'step', parseFloat(e.target.value) || 1)}
                              step={0.01}
                              min={0.01}
                              className={smallInputClass}
                              disabled={isOptimizing}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  } else if (param.type === 'boolean') {
                    return (
                      <div key={param.name} className="bg-gray-700/30 rounded p-2">
                        <div className="text-xs text-white font-medium mb-0.5">{param.label}</div>
                        <div className="text-xs text-gray-400">
                          Tests true & false
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          )}

          {/* Grid Search Settings */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-gray-300">Optimization Settings</h3>

            {/* First Row: Optimize For and Min Trades */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-0.5">Optimize For</label>
                <select
                  value={optimizeFor}
                  onChange={(e) => setOptimizeFor(e.target.value as OptimizationRequest['optimizeFor'])}
                  className={smallInputClass}
                  disabled={isOptimizing}
                >
                  {OPTIMIZE_FOR_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-0.5">
                  Min Trades
                </label>
                <input
                  type="number"
                  value={minTrades}
                  onChange={(e) => setMinTrades(parseInt(e.target.value) || 0)}
                  min={0}
                  className={smallInputClass}
                  disabled={isOptimizing}
                />
              </div>
            </div>

            {/* Second Row: Max Combinations and Batch Size */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-0.5">
                  Max Combinations
                </label>
                <input
                  type="number"
                  value={maxCombinations}
                  onChange={(e) => setMaxCombinations(parseInt(e.target.value) || 100)}
                  min={1}
                  max={10000}
                  className={smallInputClass}
                  disabled={isOptimizing}
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-0.5">
                  Batch Size
                </label>
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value) || 4)}
                  min={1}
                  max={16}
                  className={smallInputClass}
                  disabled={isOptimizing}
                />
              </div>
            </div>

            {/* Mode and Save All Runs */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-0.5">Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'spot' | 'futures')}
                  className={smallInputClass}
                  disabled={isOptimizing}
                >
                  <option value="spot">Spot</option>
                  <option value="futures">Futures</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pb-1">
                  <input
                    type="checkbox"
                    checked={saveAllRuns}
                    onChange={(e) => setSaveAllRuns(e.target.checked)}
                    disabled={isOptimizing}
                    className="rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500"
                  />
                  Save all runs to history
                </label>
              </div>
            </div>

            {/* Multi-Symbol Input */}
            <div>
              <label className="block text-xs text-gray-400 mb-0.5">
                Multiple Symbols <span className="text-gray-600">(comma-separated, optional)</span>
              </label>
              <input
                type="text"
                value={multiSymbols}
                onChange={(e) => setMultiSymbols(e.target.value)}
                placeholder="e.g. BTC/USDT:USDT, ETH/USDT:USDT, SOL/USDT:USDT"
                className={smallInputClass}
                disabled={isOptimizing}
              />
            </div>

            {/* Multi-Timeframe Checkboxes */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Multiple Timeframes <span className="text-gray-600">(optional)</span>
              </label>
              <div className="flex gap-2 flex-wrap">
                {(['15m', '1h', '4h'] as const).map((tf) => (
                  <label key={tf} className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={multiTimeframes.includes(tf)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setMultiTimeframes(prev => [...prev, tf]);
                        } else {
                          setMultiTimeframes(prev => prev.filter(t => t !== tf));
                        }
                      }}
                      disabled={isOptimizing}
                      className="rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500"
                    />
                    {tf}
                  </label>
                ))}
              </div>
            </div>

            {/* Combination Count Warning */}
            {totalCombinations > 0 && (
              <div className={`rounded p-2 text-xs ${
                totalCombinations > 1000 || (saveAllRuns && totalCombinations > 100)
                  ? 'bg-yellow-900/30 border border-yellow-700'
                  : 'bg-blue-900/30 border border-blue-700'
              }`}>
                <span className={totalCombinations > 1000 || (saveAllRuns && totalCombinations > 100) ? 'text-yellow-300' : 'text-blue-300'}>
                  Will test ~{totalCombinations.toLocaleString()} combinations
                  {multiSymbols.trim() ? ` x ${multiSymbols.split(',').filter(Boolean).length} symbols` : ''}
                  {multiTimeframes.length > 0 ? ` x ${multiTimeframes.length} timeframes` : ''}
                  {totalCombinations > 1000 && ' (may take a while)'}
                  {saveAllRuns && totalCombinations > 100 && ' - saving all runs will create many history entries'}
                </span>
              </div>
            )}
          </div>

          {/* Progress Indicator */}
          {isOptimizing && (
            <div className="bg-purple-900/30 border border-purple-700 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-purple-300">
                  {optimizationProgress
                    ? `Testing: ${optimizationProgress.current}/${optimizationProgress.total}`
                    : 'Starting...'}
                </span>
                <span className="text-xs text-purple-400">
                  {optimizationProgress
                    ? `${optimizationProgress.percent.toFixed(1)}%`
                    : 'Preparing...'}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-purple-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: optimizationProgress
                      ? `${optimizationProgress.percent}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          )}

          {/* Run Button */}
          <button
            onClick={handleRunOptimization}
            disabled={!canRun}
            className={`
              w-full py-2 rounded font-medium text-sm text-white transition-colors
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
                Running Grid Search...
              </span>
            ) : (
              'Run Grid Search'
            )}
          </button>
        </div>
      )}

      {/* History Tab */}
      {optimizerModalTab === 'history' && (
        <div>
          <h3 className="text-xs font-medium text-gray-300 mb-2">Grid Search Results</h3>

          {/* Progress Indicator - show when optimizing */}
          {(isOptimizing || isOptimizationPending) && (
            <div className="bg-purple-900/30 border border-purple-700 rounded p-2 mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-purple-300">
                  {optimizationProgress
                    ? `Testing: ${optimizationProgress.current}/${optimizationProgress.total}`
                    : 'Starting grid search...'}
                </span>
                <span className="text-xs text-purple-400">
                  {optimizationProgress
                    ? `${optimizationProgress.percent.toFixed(1)}%`
                    : '0%'}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-purple-500 h-full rounded-full transition-all duration-300"
                  style={{
                    width: optimizationProgress
                      ? `${optimizationProgress.percent}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          )}

          {loadingHistory ? (
            <div className="text-sm text-gray-500 text-center py-8">Loading history...</div>
          ) : allOptimizations && allOptimizations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="pb-1.5 pr-2 w-6"></th>
                    <th className="pb-1.5 pr-2">Date/Time</th>
                    <th className="pb-1.5 pr-2">Strategy</th>
                    <th className="pb-1.5 pr-2">Symbol</th>
                    <th className="pb-1.5 pr-2">TF</th>
                    <th className="pb-1.5 pr-2">Period</th>
                    <th className="pb-1.5 pr-2">Sharpe</th>
                    <th className="pb-1.5 pr-2">Return%</th>
                    <th className="pb-1.5 pr-2">Trades</th>
                    <th className="pb-1.5">Actions</th>
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

                    // Format optimizedAt timestamp
                    const optimizedAtStr = opt.optimizedAt
                      ? new Date(opt.optimizedAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })
                      : 'N/A';

                    return (
                      <>
                        <tr
                          key={opt.id}
                          className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                          onClick={() => toggleRowExpansion(opt.id)}
                        >
                          <td className="py-1.5 pr-2 text-gray-400">
                            <svg
                              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
                          <td className="py-1.5 pr-2 text-gray-300 whitespace-nowrap">
                            {optimizedAtStr}
                          </td>
                          <td className="py-1.5 pr-2 text-white">{opt.strategyName}</td>
                          <td className="py-1.5 pr-2 text-gray-300">{opt.symbol}</td>
                          <td className="py-1.5 pr-2 text-gray-300">{opt.timeframe}</td>
                          <td className="py-1.5 pr-2 text-gray-400">
                            {startDateStr} - {endDateStr}
                          </td>
                          <td className="py-1.5 pr-2 text-white">
                            {opt.bestMetrics.sharpeRatio?.toFixed(2) ?? 'N/A'}
                          </td>
                          <td className={`py-1.5 pr-2 ${
                            (opt.bestMetrics.totalReturnPercent ?? 0) >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                          }`}>
                            {(opt.bestMetrics.totalReturnPercent ?? 0) >= 0 ? '+' : ''}
                            {opt.bestMetrics.totalReturnPercent?.toFixed(2) ?? 'N/A'}%
                          </td>
                          <td className="py-1.5 pr-2 text-gray-300">
                            {opt.bestMetrics.totalTrades ?? 0}
                          </td>
                          <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleApplyOptimization(opt)}
                                className="px-1.5 py-0.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded font-medium transition-colors"
                              >
                                Apply
                              </button>
                              <button
                                onClick={() => handleDeleteOptimization(opt.strategyName, opt.symbol, opt.timeframe)}
                                className="px-1.5 py-0.5 bg-red-600/80 hover:bg-red-500 text-white text-xs rounded font-medium transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${opt.id}-expanded`} className="border-b border-gray-700/50 bg-gray-800/50">
                            <td colSpan={10} className="py-2 px-2">
                              <div className="ml-4">
                                <h4 className="text-xs font-medium text-gray-400 mb-1">Best Parameters</h4>
                                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                  {Object.entries(opt.bestParams).map(([key, value]) => (
                                    <div key={key} className="bg-gray-700/50 rounded px-2 py-1">
                                      <div className="text-xs text-gray-400">{key}</div>
                                      <div className="text-xs text-white font-medium">
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
            <div className="text-xs text-gray-500 text-center py-4">
              No grid search results yet. Run a grid search to see results here.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
