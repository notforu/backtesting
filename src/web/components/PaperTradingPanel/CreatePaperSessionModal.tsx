/**
 * Modal for creating a new paper trading session.
 * Supports three modes:
 *   1. From Aggregation — select a saved aggregation config
 *   2. From History — select a past aggregation backtest run
 *   3. Simple Strategy — configure a single strategy inline
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAggregations, getStrategies, getHistory } from '../../api/client';
import { useCreatePaperSession } from '../../hooks/usePaperTrading';
import type { StrategyParam, BacktestSummary } from '../../types';

interface CreatePaperSessionModalProps {
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
}

type Mode = 'aggregation' | 'history' | 'strategy';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

function formatDate(isoOrTimestamp: string | number | undefined): string {
  if (!isoOrTimestamp) return '—';
  const d = new Date(typeof isoOrTimestamp === 'number' ? isoOrTimestamp : isoOrTimestamp);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPct(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatSharpe(value: number | undefined): string {
  if (value === undefined || value === null) return '—';
  return value.toFixed(2);
}

export function CreatePaperSessionModal({ onClose, onCreated }: CreatePaperSessionModalProps) {
  const { data: aggregations, isLoading: loadingAggregations } = useQuery({
    queryKey: ['aggregations'],
    queryFn: getAggregations,
  });

  const { data: strategies, isLoading: loadingStrategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: getStrategies,
  });

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ['backtest-history-aggregations'],
    queryFn: () => getHistory({ runType: 'aggregations', limit: 20, sortBy: 'runAt', sortDir: 'desc' }),
  });

  const createMutation = useCreatePaperSession();

  // Mode toggle — default to simple strategy for quick testing
  const [mode, setMode] = useState<Mode>('strategy');

  // Shared
  const [name, setName] = useState('SMA Crossover 1m Test');
  const [initialCapital, setInitialCapital] = useState<number>(10000);
  const [initialCapitalStr, setInitialCapitalStr] = useState<string>('10000');

  // Aggregation mode
  const [aggregationConfigId, setAggregationConfigId] = useState('');

  // History mode
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<BacktestSummary | null>(null);

  // Simple strategy mode — defaults optimised for quick paper trading test
  const [strategyName, setStrategyName] = useState('sma-crossover');
  const [symbol, setSymbol] = useState('BTC/USDT:USDT');
  const [timeframe, setTimeframe] = useState('1m');
  const [exchange, setExchange] = useState('bybit');
  const [tradingMode, setTradingMode] = useState<'spot' | 'futures'>('futures');
  const [strategyParams, setStrategyParams] = useState<Record<string, unknown>>({
    fastPeriod: 3,
    slowPeriod: 7,
    enableShorts: true,
  });

  // When aggregation selection changes, set default capital from its config
  useEffect(() => {
    if (!aggregationConfigId || !aggregations) return;
    const agg = aggregations.find((a) => a.id === aggregationConfigId);
    if (agg) {
      setInitialCapital(agg.initialCapital);
      setInitialCapitalStr(String(agg.initialCapital));
    }
  }, [aggregationConfigId, aggregations]);

  // When a history run is selected, auto-populate capital from the run's config
  useEffect(() => {
    if (!selectedHistoryRun) return;
    // Use the run's initial capital if available (BacktestSummary doesn't store it directly,
    // but we can populate the name automatically)
    const runDate = formatDate(selectedHistoryRun.runAt);
    const aggLabel = selectedHistoryRun.aggregationName || selectedHistoryRun.strategyName;
    setName(`${aggLabel} — ${runDate}`);
  }, [selectedHistoryRun]);

  // When strategy selection changes, pre-fill defaults from strategy definition.
  // Uses a ref to track the previous strategy name so we only reset params on actual change,
  // not when the strategies list loads for the first time (which would overwrite our initial defaults).
  const prevStrategyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!strategyName || !strategies) return;
    // Skip the initial load — keep pre-set defaults
    if (prevStrategyRef.current === null) {
      prevStrategyRef.current = strategyName;
      return;
    }
    // Only reset params when the user picks a different strategy
    if (prevStrategyRef.current === strategyName) return;
    prevStrategyRef.current = strategyName;

    const strat = strategies.find((s) => s.name === strategyName);
    if (!strat) return;

    const defaults: Record<string, unknown> = {};
    if ('params' in strat && Array.isArray((strat as { params: StrategyParam[] }).params)) {
      for (const p of (strat as { params: StrategyParam[] }).params) {
        defaults[p.name] = p.default;
      }
    }
    setStrategyParams(defaults);
  }, [strategyName, strategies]);

  const selectedStrategy = strategies?.find((s) => s.name === strategyName);
  const selectedStrategyParams: StrategyParam[] =
    selectedStrategy && 'params' in selectedStrategy
      ? (selectedStrategy as { params: StrategyParam[] }).params
      : [];

  const handleParamChange = (paramName: string, value: unknown) => {
    setStrategyParams((prev) => ({ ...prev, [paramName]: value }));
  };

  const isSubmitDisabled = (() => {
    if (!name.trim()) return true;
    if (createMutation.isPending) return true;
    if (mode === 'aggregation') return !aggregationConfigId;
    if (mode === 'history') return !selectedHistoryRun;
    if (mode === 'strategy') return !strategyName;
    return false;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;

    try {
      if (mode === 'aggregation') {
        const session = await createMutation.mutateAsync({
          name: name.trim(),
          aggregationConfigId,
          initialCapital,
        });
        onCreated?.(session.id);
      } else if (mode === 'history') {
        if (!selectedHistoryRun) return;
        // If the run has an aggregationId, reference the saved config directly.
        // For ad-hoc runs without a saved config, pass the backtestRunId so the
        // backend can reconstruct the session from the stored run configuration.
        const session = await createMutation.mutateAsync({
          name: name.trim(),
          ...(selectedHistoryRun.aggregationId
            ? { aggregationConfigId: selectedHistoryRun.aggregationId }
            : { backtestRunId: selectedHistoryRun.id }),
          initialCapital,
        });
        onCreated?.(session.id);
      } else {
        const session = await createMutation.mutateAsync({
          name: name.trim(),
          strategyConfig: {
            strategyName,
            symbol: symbol.trim(),
            timeframe,
            exchange: exchange.trim(),
            params: strategyParams,
            mode: tradingMode,
          },
          initialCapital,
        });
        onCreated?.(session.id);
      }
      onClose();
    } catch {
      // Error shown below via createMutation.error
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const inputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  const historyRuns = historyData?.results ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">New Trading Session</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode Toggle — 3 buttons */}
          <div className="flex rounded overflow-hidden border border-gray-600 text-sm">
            <button
              type="button"
              onClick={() => setMode('aggregation')}
              className={`flex-1 py-2 transition-colors font-medium ${
                mode === 'aggregation'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              From Aggregation
            </button>
            <button
              type="button"
              onClick={() => setMode('history')}
              className={`flex-1 py-2 transition-colors font-medium border-l border-gray-600 ${
                mode === 'history'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              From History
            </button>
            <button
              type="button"
              onClick={() => setMode('strategy')}
              className={`flex-1 py-2 transition-colors font-medium border-l border-gray-600 ${
                mode === 'strategy'
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              Simple Strategy
            </button>
          </div>

          {/* Session Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Session Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ATOM 4h Live Test"
              className={inputClass}
              required
            />
          </div>

          {/* Aggregation Mode Fields */}
          {mode === 'aggregation' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Aggregation Config</label>
              {loadingAggregations ? (
                <div className="text-sm text-gray-500">Loading configs...</div>
              ) : (
                <select
                  value={aggregationConfigId}
                  onChange={(e) => setAggregationConfigId(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select a config...</option>
                  {aggregations?.map((agg) => (
                    <option key={agg.id} value={agg.id}>
                      {agg.name} — {agg.subStrategies.length} strategy{agg.subStrategies.length !== 1 ? 'ies' : 'y'}, ${agg.initialCapital.toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
              {aggregations?.length === 0 && (
                <p className="text-xs text-amber-400 mt-1">
                  No aggregation configs found. Create one in the Aggregations tab first.
                </p>
              )}
            </div>
          )}

          {/* History Mode Fields */}
          {mode === 'history' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Recent Aggregation Runs</label>
              {loadingHistory ? (
                <div className="text-sm text-gray-500 py-4 text-center">Loading history...</div>
              ) : historyRuns.length === 0 ? (
                <p className="text-xs text-amber-400 mt-1">
                  No aggregation runs found in history. Run an aggregation backtest first.
                </p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                  {historyRuns.map((run) => {
                    const isSelected = selectedHistoryRun?.id === run.id;
                    const returnPct = run.totalReturnPercent;
                    const returnColor =
                      returnPct === undefined || returnPct === null
                        ? 'text-gray-400'
                        : returnPct >= 0
                        ? 'text-green-400'
                        : 'text-red-400';

                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelectedHistoryRun(run)}
                        className={`w-full text-left px-3 py-2.5 rounded border transition-colors ${
                          isSelected
                            ? 'border-primary-500 bg-primary-600/20'
                            : 'border-gray-600 bg-gray-700/50 hover:border-gray-500 hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                              {run.aggregationName || run.strategyName}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {formatDate(run.runAt)}
                            </div>
                          </div>
                          <div className="flex gap-3 shrink-0 text-xs">
                            <div className="text-center">
                              <div className="text-gray-500 uppercase tracking-wide text-[10px]">Return</div>
                              <div className={`font-medium ${returnColor}`}>
                                {formatPct(run.totalReturnPercent)}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-gray-500 uppercase tracking-wide text-[10px]">Sharpe</div>
                              <div className="text-gray-200 font-medium">
                                {formatSharpe(run.sharpeRatio)}
                              </div>
                            </div>
                          </div>
                        </div>
                        {run.aggregationId && (
                          <div className="text-[10px] text-gray-500 mt-1">
                            Config ID: {run.aggregationId.slice(0, 8)}...
                          </div>
                        )}
                        {!run.aggregationId && (
                          <div className="text-[10px] text-amber-500 mt-1">
                            Ad-hoc run (no saved config)
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedHistoryRun && !selectedHistoryRun.aggregationId && (
                <p className="text-xs text-gray-400 mt-2">
                  This run will be recreated from its stored configuration.
                </p>
              )}
            </div>
          )}

          {/* Simple Strategy Mode Fields */}
          {mode === 'strategy' && (
            <>
              {/* Strategy Dropdown */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Strategy</label>
                {loadingStrategies ? (
                  <div className="text-sm text-gray-500">Loading strategies...</div>
                ) : (
                  <select
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    className={inputClass}
                    required
                  >
                    <option value="">Select a strategy...</option>
                    {strategies?.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Symbol + Timeframe row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Symbol</label>
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="BTC/USDT:USDT"
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Timeframe</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className={inputClass}
                  >
                    {TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Exchange + Mode row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Exchange</label>
                  <input
                    type="text"
                    value={exchange}
                    onChange={(e) => setExchange(e.target.value)}
                    placeholder="bybit"
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Mode</label>
                  <select
                    value={tradingMode}
                    onChange={(e) => setTradingMode(e.target.value as 'spot' | 'futures')}
                    className={inputClass}
                  >
                    <option value="spot">Spot</option>
                    <option value="futures">Futures</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Strategy Params */}
              {strategyName && selectedStrategyParams.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Strategy Parameters</label>
                  <div className="space-y-2 bg-gray-700/50 rounded p-3 border border-gray-600">
                    {selectedStrategyParams.map((param) => {
                      const label = param.label || param.name;
                      const value = strategyParams[param.name];

                      if (param.type === 'boolean') {
                        return (
                          <div key={param.name} className="flex items-center justify-between">
                            <label className="text-sm text-gray-300">{label}</label>
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={(e) => handleParamChange(param.name, e.target.checked)}
                              className="w-4 h-4 rounded accent-primary-500"
                            />
                          </div>
                        );
                      }

                      if (param.type === 'select' && param.options) {
                        const options = param.options as Array<string | { value: string | number; label: string }>;
                        return (
                          <div key={param.name}>
                            <label className="block text-xs text-gray-400 mb-1">{label}</label>
                            <select
                              value={String(value ?? '')}
                              onChange={(e) => handleParamChange(param.name, e.target.value)}
                              className={inputClass}
                            >
                              {options.map((opt) => {
                                if (typeof opt === 'string') {
                                  return <option key={opt} value={opt}>{opt}</option>;
                                }
                                return (
                                  <option key={String(opt.value)} value={String(opt.value)}>
                                    {opt.label}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        );
                      }

                      if (param.type === 'number') {
                        return (
                          <div key={param.name}>
                            <label className="block text-xs text-gray-400 mb-1">{label}</label>
                            <input
                              type="number"
                              value={value as number ?? param.default as number}
                              onChange={(e) => handleParamChange(param.name, parseFloat(e.target.value))}
                              min={param.min}
                              max={param.max}
                              step={param.step ?? 1}
                              className={inputClass}
                            />
                          </div>
                        );
                      }

                      // string fallback
                      return (
                        <div key={param.name}>
                          <label className="block text-xs text-gray-400 mb-1">{label}</label>
                          <input
                            type="text"
                            value={String(value ?? param.default ?? '')}
                            onChange={(e) => handleParamChange(param.name, e.target.value)}
                            className={inputClass}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Initial Capital */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapitalStr}
              onChange={(e) => {
                setInitialCapitalStr(e.target.value);
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed)) setInitialCapital(parsed);
              }}
              onBlur={() => {
                if (!initialCapitalStr || isNaN(parseFloat(initialCapitalStr))) {
                  setInitialCapital(10000);
                  setInitialCapitalStr('10000');
                }
              }}
              min={1}
              step="any"
              className={inputClass}
            />
          </div>

          {/* Error */}
          {createMutation.isError && (
            <div className="bg-red-900/50 border border-red-700 rounded p-2 text-sm text-red-300">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create session'}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="flex-1 py-2 rounded bg-primary-600 hover:bg-primary-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreatePaperSessionModal;
