/**
 * Strategy configuration panel component.
 * Provides form inputs for configuring and running backtests.
 */

import { useEffect } from 'react';
import { useStrategies, useStrategy, useRunBacktest } from '../../hooks/useBacktest';
import { useConfigStore, useBacktestStore } from '../../stores/backtestStore';
import type { StrategyParam, Timeframe } from '../../types';

// Available timeframes
const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1 Minute' },
  { value: '5m', label: '5 Minutes' },
  { value: '15m', label: '15 Minutes' },
  { value: '30m', label: '30 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
  { value: '1w', label: '1 Week' },
];

// Common trading pairs
const COMMON_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
];

interface ParamInputProps {
  param: StrategyParam;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ParamInput({ param, value, onChange }: ParamInputProps) {
  const inputId = `param-${param.name}`;
  const currentValue = value ?? param.default;

  const baseInputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  switch (param.type) {
    case 'number':
      return (
        <div>
          <label
            htmlFor={inputId}
            className="block text-sm text-gray-400 mb-1"
          >
            {param.label}
          </label>
          <input
            id={inputId}
            type="number"
            value={currentValue as number}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            className={baseInputClass}
          />
          {param.description && (
            <p className="text-xs text-gray-500 mt-1">{param.description}</p>
          )}
        </div>
      );

    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            type="checkbox"
            checked={currentValue as boolean}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-primary-500"
          />
          <label htmlFor={inputId} className="text-sm text-gray-300">
            {param.label}
          </label>
        </div>
      );

    case 'select':
      return (
        <div>
          <label
            htmlFor={inputId}
            className="block text-sm text-gray-400 mb-1"
          >
            {param.label}
          </label>
          <select
            id={inputId}
            value={currentValue as string}
            onChange={(e) => onChange(e.target.value)}
            className={baseInputClass}
          >
            {param.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'string':
    default:
      return (
        <div>
          <label
            htmlFor={inputId}
            className="block text-sm text-gray-400 mb-1"
          >
            {param.label}
          </label>
          <input
            id={inputId}
            type="text"
            value={currentValue as string}
            onChange={(e) => onChange(e.target.value)}
            className={baseInputClass}
          />
        </div>
      );
  }
}

export function StrategyConfig() {
  const { data: strategies, isLoading: loadingStrategies } = useStrategies();
  const {
    strategy,
    params,
    symbol,
    timeframe,
    startDate,
    endDate,
    initialCapital,
    exchange,
    setStrategy,
    updateParam,
    setSymbol,
    setTimeframe,
    setStartDate,
    setEndDate,
    setInitialCapital,
    setParams,
    getConfig,
  } = useConfigStore();

  const { data: strategyDetails, isLoading: loadingDetails } =
    useStrategy(strategy);

  const { isRunning, error } = useBacktestStore();
  const runBacktestMutation = useRunBacktest();

  // Initialize params with defaults when strategy changes
  useEffect(() => {
    if (strategyDetails?.params) {
      const defaultParams: Record<string, unknown> = {};
      strategyDetails.params.forEach((p) => {
        defaultParams[p.name] = p.default;
      });
      setParams(defaultParams);
    }
  }, [strategyDetails, setParams]);

  const handleRunBacktest = () => {
    if (!strategy) return;
    const config = getConfig();
    runBacktestMutation.mutate({
      ...config,
      exchange: exchange || 'binance',
    });
  };

  const canRun = strategy && symbol && startDate && endDate && !isRunning;

  const inputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
      <h2 className="text-lg font-semibold text-white">Configuration</h2>

      {/* Strategy Selection */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Strategy</label>
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className={inputClass}
          disabled={loadingStrategies}
        >
          <option value="">Select a strategy...</option>
          {strategies?.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        {strategyDetails && (
          <p className="text-xs text-gray-500 mt-1">
            {strategyDetails.description}
          </p>
        )}
      </div>

      {/* Strategy Parameters */}
      {strategyDetails?.params && strategyDetails.params.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-gray-700">
          <h3 className="text-sm font-medium text-gray-300">
            Strategy Parameters
          </h3>
          {loadingDetails ? (
            <div className="text-sm text-gray-500">Loading parameters...</div>
          ) : (
            strategyDetails.params.map((param) => (
              <ParamInput
                key={param.name}
                param={param}
                value={params[param.name]}
                onChange={(value) => updateParam(param.name, value)}
              />
            ))
          )}
        </div>
      )}

      {/* Symbol */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="BTCUSDT"
          className={inputClass}
          list="symbols"
        />
        <datalist id="symbols">
          {COMMON_SYMBOLS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {/* Timeframe */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Timeframe</label>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          className={inputClass}
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf.value} value={tf.value}>
              {tf.label}
            </option>
          ))}
        </select>
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
        <label className="block text-sm text-gray-400 mb-1">
          Initial Capital ($)
        </label>
        <input
          type="number"
          value={initialCapital}
          onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
          min={0}
          step={1000}
          className={inputClass}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Run Button */}
      <button
        onClick={handleRunBacktest}
        disabled={!canRun}
        className={`
          w-full py-3 rounded font-medium text-white transition-colors
          ${
            canRun
              ? 'bg-primary-600 hover:bg-primary-500'
              : 'bg-gray-600 cursor-not-allowed'
          }
        `}
      >
        {isRunning ? (
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
            Running Backtest...
          </span>
        ) : (
          'Run Backtest'
        )}
      </button>
    </div>
  );
}

export default StrategyConfig;
