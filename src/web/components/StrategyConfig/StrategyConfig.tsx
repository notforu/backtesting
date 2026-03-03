/**
 * Strategy configuration panel component.
 * Provides form inputs for configuring and running backtests.
 */

import { useEffect, useState } from 'react';
import { useStrategies, useStrategy, useRunBacktest, useRunPairsBacktest, useLoadBacktest } from '../../hooks/useBacktest';
import {
  useOptimizedParams,
} from '../../hooks/useOptimization';
import {
  useConfigStore,
  useBacktestStore,
  useOptimizationStore,
  useOptimizerModalStore,
} from '../../stores/backtestStore';
import { useScannerStore } from '../../stores/scannerStore';
import { useAggregationStore } from '../../stores/aggregationStore';
import { useAuthStore } from '../../stores/authStore';
import { runScan } from '../../api/client';
import type { BacktestSummary, StrategyParam, Timeframe } from '../../types';
import { PolymarketBrowser } from '../PolymarketBrowser';
import { AggregationsPanel } from '../AggregationsPanel/AggregationsPanel';
import { HistoryExplorerContent } from '../HistoryExplorer/HistoryExplorer';

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

// Polymarket limited timeframes (prediction markets have limited granularity)
const POLYMARKET_TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1h', label: '1 Hour' },
  { value: '1d', label: '1 Day' },
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
            {param.options?.map((opt) => {
              const value = typeof opt === 'string' ? opt : opt.value;
              const label = typeof opt === 'string' ? opt : opt.label;
              return (
                <option key={String(value)} value={String(value)}>
                  {label}
                </option>
              );
            })}
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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { activeConfigTab, setActiveConfigTab } = useAggregationStore();
  const { data: strategies, isLoading: loadingStrategies } = useStrategies();
  const {
    strategy,
    params,
    symbol,
    symbolB,
    timeframe,
    startDate,
    endDate,
    initialCapital,
    exchange,
    leverage,
    mode,
    setStrategy,
    updateParam,
    setSymbol,
    setSymbolB,
    setTimeframe,
    setStartDate,
    setEndDate,
    setInitialCapital,
    setExchange,
    setLeverage,
    setMode,
    setParams,
    getConfig,
    applyHistoryParams,
  } = useConfigStore();

  const { data: strategyDetails, isLoading: loadingDetails } =
    useStrategy(strategy);

  const { isRunning, error, selectedBacktestId } = useBacktestStore();
  const runBacktestMutation = useRunBacktest();
  const runPairsBacktestMutation = useRunPairsBacktest();
  const { loadBacktest } = useLoadBacktest();

  // Optimization hooks
  const { data: optimizedParams, isError: optimizedParamsError } =
    useOptimizedParams(strategy, symbol, timeframe);

  const {
    isOptimizing,
    usingOptimizedParams,
    setUsingOptimizedParams,
  } = useOptimizationStore();

  const { setOptimizerModalOpen } = useOptimizerModalStore();

  // Scanner store
  const {
    isScanning,
    selectedMarkets,
    setSelectedMarkets,
    toggleMarket,
    startScan,
    addResult,
    setScanProgress,
    setScanSummary,
    setScanError,
  } = useScannerStore();

  // Collapsible params state
  const [paramsExpanded, setParamsExpanded] = useState(true);

  // Track which history run is being loaded
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  // Initialize params with defaults when strategy changes (skip if loaded from history)
  useEffect(() => {
    if (strategyDetails?.params) {
      // Skip if params already set (applyHistoryParams sets params before this fires)
      // setStrategy() clears params to {}, so this only skips for history loads
      const currentParams = useConfigStore.getState().params;
      const source = useConfigStore.getState()._configSource;
      if (source === 'history' || Object.keys(currentParams).length > 0) {
        setParamsExpanded((strategyDetails.params.length || 0) < 4);
        return;
      }
      const defaultParams: Record<string, unknown> = {};
      strategyDetails.params.forEach((p) => {
        defaultParams[p.name] = p.default;
      });
      setParams(defaultParams);
      setUsingOptimizedParams(false);
      setParamsExpanded((strategyDetails.params.length || 0) < 4);
    }
  }, [strategyDetails, setParams, setUsingOptimizedParams]);

  // Auto-apply optimized params when available (skip if loaded from history)
  useEffect(() => {
    const source = useConfigStore.getState()._configSource;
    if (source === 'history') return;
    if (optimizedParams && optimizedParams.length > 0 && !optimizedParamsError && strategy && symbol && timeframe) {
      // Use the most recent optimization result (first in array)
      setParams(optimizedParams[0].bestParams);
      setUsingOptimizedParams(true);
    } else if (optimizedParamsError) {
      setUsingOptimizedParams(false);
    }
  }, [optimizedParams, optimizedParamsError, strategy, symbol, timeframe, setParams, setUsingOptimizedParams]);

  const handleRunBacktest = () => {
    if (!strategy) return;

    const isPairsStrategy = strategyDetails?.isPairs;

    if (isPairsStrategy) {
      const req = {
        strategyName: strategy,
        params,
        symbolA: symbol,
        symbolB: symbolB,
        timeframe,
        startDate,
        endDate,
        initialCapital,
        exchange: exchange || 'binance',
        leverage,
      };
      console.log('[Backtest] Running pairs:', JSON.stringify(req, null, 2));
      runPairsBacktestMutation.mutate(req);
    } else {
      const config = getConfig();
      const req = { ...config, exchange: exchange || 'binance', mode };
      console.log('[Backtest] Running single:', JSON.stringify(req, null, 2));
      runBacktestMutation.mutate(req);
    }
  };

  // Reset to strategy defaults (keeps optimization in DB)
  const handleResetToDefaults = () => {
    if (strategyDetails?.params) {
      const defaultParams: Record<string, unknown> = {};
      strategyDetails.params.forEach((p) => {
        defaultParams[p.name] = p.default;
      });
      setParams(defaultParams);
    }
    setUsingOptimizedParams(false);
  };

  const handleScanMarkets = async () => {
    if (selectedMarkets.length === 0 || !strategy) return;

    startScan();

    try {
      await runScan(
        {
          strategy,
          symbols: selectedMarkets,
          timeframe,
          from: startDate,
          to: endDate,
          slippage: 1.0,
          initialCapital,
          params,
        },
        {
          onProgress: (progress) => setScanProgress(progress),
          onResult: (result) => addResult(result),
          onDone: (summary) => setScanSummary(summary),
          onError: (error) => setScanError(error),
        }
      );
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    }
  };

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

  const isPairsStrategy = strategyDetails?.isPairs;
  const canRun =
    strategy &&
    symbol &&
    (!isPairsStrategy || symbolB) && // Require symbolB for pairs strategies
    startDate &&
    endDate &&
    !isRunning &&
    !isOptimizing;

  const inputClass =
    'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

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

      {activeConfigTab === 'strategies' && (<>
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

      {/* Exchange Selection */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Exchange</label>
        <select
          value={exchange}
          onChange={(e) => {
            setExchange(e.target.value);
            // Reset symbol when changing exchange
            if (e.target.value === 'polymarket') {
              setSymbol('');
            } else {
              setSymbol('BTCUSDT');
            }
          }}
          className={inputClass}
        >
          <option value="binance">Binance</option>
          <option value="bybit">Bybit</option>
          <option value="polymarket">Polymarket</option>
        </select>
      </div>

      {/* Mode Selection (spot/futures) */}
      {exchange !== 'polymarket' && (
        <div>
          <label className="block text-sm text-gray-400 mb-1">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'spot' | 'futures')}
            className={inputClass}
          >
            <option value="spot">Spot</option>
            <option value="futures">Futures</option>
          </select>
        </div>
      )}

      {/* Symbol & Timeframe */}
      <div className="grid grid-cols-2 gap-3">
        {exchange === 'polymarket' ? (
          <div className="col-span-2">
            <PolymarketBrowser
              onSelect={(slug) => setSymbol(`PM:${slug}`)}
              selectedSlug={symbol.startsWith('PM:') ? symbol.slice(3) : undefined}
            />
            {/* Scanner section - only for non-pairs PM strategies */}
            {!isPairsStrategy && strategy && (
              <div className="mt-3 border-t border-gray-700 pt-3">
                <button
                  onClick={() => {
                    const scanSection = document.getElementById('scanner-markets');
                    if (scanSection) scanSection.classList.toggle('hidden');
                  }}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors w-full"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Scan Multiple Markets ({selectedMarkets.length} selected)
                </button>
                <div id="scanner-markets" className="hidden mt-2">
                  <PolymarketBrowser
                    onSelect={() => {}}
                    multiSelect={true}
                    selectedSlugs={selectedMarkets.map(m => m.replace('PM:', ''))}
                    onToggleSelect={(slug) => toggleMarket(`PM:${slug}`)}
                    onSelectAll={(slugs) => setSelectedMarkets(slugs.map(s => `PM:${s}`))}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              {isPairsStrategy ? 'Symbol A' : 'Symbol'}
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder={mode === 'futures' ? 'BTC/USDT:USDT' : 'BTCUSDT'}
              className={inputClass}
              list="symbols"
            />
            <datalist id="symbols">
              {COMMON_SYMBOLS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {mode === 'futures' && (
              <p className="text-xs text-gray-500 mt-1">Use futures format: e.g. BTC/USDT:USDT</p>
            )}
          </div>
        )}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Timeframe</label>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className={inputClass}
          >
            {(exchange === 'polymarket' ? POLYMARKET_TIMEFRAMES : TIMEFRAMES).map((tf) => (
              <option key={tf.value} value={tf.value}>
                {tf.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Symbol B & Leverage (only for pairs strategies) */}
      {isPairsStrategy && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Symbol B</label>
            <input
              type="text"
              value={symbolB}
              onChange={(e) => setSymbolB(e.target.value.toUpperCase())}
              placeholder="ETHUSDT"
              className={inputClass}
              list="symbols"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Leverage (1-20)
            </label>
            <input
              type="number"
              value={leverage}
              onChange={(e) => setLeverage(parseFloat(e.target.value) || 1)}
              min={1}
              max={20}
              step={1}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {/* Date Range (2-column) */}
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

      {/* Action Buttons - Moved up */}
      {isAuthenticated && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={handleRunBacktest}
            disabled={!canRun}
            className={`
              py-2.5 rounded font-medium text-white transition-colors text-sm
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
                Running...
              </span>
            ) : (
              isPairsStrategy ? 'Run Pairs Backtest' : 'Run Backtest'
            )}
          </button>

          {strategy && (
            <button
              onClick={() => setOptimizerModalOpen(true)}
              disabled={isOptimizing}
              className={`
                py-2.5 rounded font-medium text-white transition-colors text-sm
                ${
                  !isOptimizing
                    ? 'bg-purple-600 hover:bg-purple-500'
                    : 'bg-gray-600 cursor-not-allowed'
                }
              `}
            >
              {isOptimizing ? 'Searching...' : 'Grid Search'}
            </button>
          )}
        </div>
      )}

      {/* Scan Markets button - PM non-pairs only */}
      {isAuthenticated && exchange === 'polymarket' && !isPairsStrategy && strategy && selectedMarkets.length > 0 && (
        <button
          onClick={handleScanMarkets}
          disabled={isScanning || isRunning}
          className={`
            w-full py-2 rounded font-medium text-white transition-colors text-sm mt-2
            ${!isScanning && !isRunning
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : 'bg-gray-600 cursor-not-allowed'}
          `}
        >
          {isScanning ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Scanning...
            </span>
          ) : (
            `Scan ${selectedMarkets.length} Markets`
          )}
        </button>
      )}

      {/* Strategy Parameters - Collapsible */}
      {strategyDetails?.params && strategyDetails.params.length > 0 && (
        <div className="pt-2 border-t border-gray-700">
          <button
            onClick={() => setParamsExpanded(!paramsExpanded)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            <span>Strategy Parameters</span>
            <svg
              className={`w-4 h-4 transition-transform ${paramsExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {paramsExpanded && (
            <div className="mt-3 space-y-3 grid grid-cols-2 gap-3">
              {loadingDetails ? (
                <div className="col-span-2 text-sm text-gray-500">Loading parameters...</div>
              ) : (
                strategyDetails.params.map((param) => (
                  <div key={param.name} className={param.type === 'boolean' ? 'col-span-2' : ''}>
                    <ParamInput
                      param={param}
                      value={params[param.name]}
                      onChange={(value) => {
                        updateParam(param.name, value);
                        setUsingOptimizedParams(false);
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Compact Grid Search Params Indicator */}
      {usingOptimizedParams && optimizedParams && optimizedParams.length > 0 && (
        <div className="flex items-center justify-between text-xs bg-green-900/20 border border-green-700/50 rounded px-2 py-1.5">
          <span className="text-green-400 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
            </svg>
            Grid Search Applied (Sharpe: {optimizedParams[0].bestMetrics.sharpeRatio.toFixed(2)})
          </span>
          <button
            onClick={handleResetToDefaults}
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
      <div className="border-t border-gray-700 pt-3 mt-3">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Strategy Runs</h3>
        {isRunning && (
          <div className="flex items-center gap-2 px-2 py-1.5 mb-2 bg-primary-900/30 border border-primary-800/50 rounded text-xs text-primary-300">
            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Running backtest...
          </div>
        )}
        <HistoryExplorerContent
          fixedRunType="strategies"
          compact={true}
          showFilters={false}
          showGroupToggle={false}
          maxHeight="280px"
          selectedId={selectedBacktestId}
          loadingId={loadingRunId}
          onSelectRun={handleSelectHistoryRun}
        />
      </div>
      </>)}

      {activeConfigTab === 'aggregations' && <AggregationsPanel />}
    </div>
  );
}

export default StrategyConfig;
