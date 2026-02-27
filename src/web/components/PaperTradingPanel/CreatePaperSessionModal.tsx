/**
 * Modal for creating a new paper trading session.
 * Supports two modes:
 *   1. From Aggregation — select a saved aggregation config
 *   2. Simple Strategy — configure a single strategy inline
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAggregations, getStrategies } from '../../api/client';
import { useCreatePaperSession } from '../../hooks/usePaperTrading';
import type { StrategyParam } from '../../types';

interface CreatePaperSessionModalProps {
  onClose: () => void;
  onCreated?: (sessionId: string) => void;
}

type Mode = 'aggregation' | 'strategy';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export function CreatePaperSessionModal({ onClose, onCreated }: CreatePaperSessionModalProps) {
  const { data: aggregations, isLoading: loadingAggregations } = useQuery({
    queryKey: ['aggregations'],
    queryFn: getAggregations,
  });

  const { data: strategies, isLoading: loadingStrategies } = useQuery({
    queryKey: ['strategies'],
    queryFn: getStrategies,
  });

  const createMutation = useCreatePaperSession();

  // Mode toggle — default to simple strategy for quick testing
  const [mode, setMode] = useState<Mode>('strategy');

  // Shared
  const [name, setName] = useState('SMA Crossover 1m Test');
  const [initialCapital, setInitialCapital] = useState<number>(10000);

  // Aggregation mode
  const [aggregationConfigId, setAggregationConfigId] = useState('');

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
    }
  }, [aggregationConfigId, aggregations]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">New Paper Trading Session</h2>
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
          {/* Mode Toggle */}
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
                    {strategies?.filter((s) => !('isPairs' in s && s.isPairs)).map((s) => (
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
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              min={1}
              step={1000}
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
