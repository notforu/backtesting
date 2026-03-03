/**
 * RunParamsModal — view and edit parameters from a historical backtest run,
 * then rerun the backtest with the (possibly modified) params.
 *
 * Two modes:
 *   - Strategy run: key-value param editor with "Load & Run" button.
 *   - Aggregation run: full editor for top-level settings plus substrategy
 *     list with add / remove, and "Load & Run" button.
 */

import { useState, useEffect } from 'react';
import type { BacktestSummary, SubStrategyConfig, AllocationMode, Timeframe } from '../../types';
import { useAuthStore } from '../../stores/authStore';

// ============================================================================
// Types
// ============================================================================

interface RunParamsModalProps {
  run: BacktestSummary;
  isOpen: boolean;
  onClose: () => void;
  onRerun: (params: Record<string, unknown>) => void;
  isRunning?: boolean;
}

interface AggTopLevel {
  allocationMode: AllocationMode;
  maxPositions: number;
  initialCapital: number;
  mode: 'spot' | 'futures';
  exchange: string;
}

interface NewSubStrategy {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  paramsRaw: string; // JSON string for optional params
}

// ============================================================================
// Helpers
// ============================================================================

const TIMEFRAME_OPTIONS: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
const ALLOCATION_MODE_OPTIONS: AllocationMode[] = ['single_strongest', 'weighted_multi', 'top_n'];

function coerceParam(orig: unknown, edited: string): unknown {
  if (typeof orig === 'number') return parseFloat(edited) || 0;
  if (typeof orig === 'boolean') return edited === 'true';
  return edited;
}

function parseAggParams(params: Record<string, unknown>): {
  topLevel: AggTopLevel;
  subStrategies: SubStrategyConfig[];
} {
  return {
    topLevel: {
      allocationMode: (params.allocationMode as AllocationMode) ?? 'single_strongest',
      maxPositions: typeof params.maxPositions === 'number' ? params.maxPositions : 5,
      initialCapital: typeof params.initialCapital === 'number' ? params.initialCapital : 10000,
      mode: (params.mode as 'spot' | 'futures') ?? 'futures',
      exchange: typeof params.exchange === 'string' ? params.exchange : 'bybit',
    },
    subStrategies: Array.isArray(params.subStrategies)
      ? (params.subStrategies as SubStrategyConfig[])
      : [],
  };
}

/** Render strategy params as compact `key=value` tokens */
function ParamTokens({ params }: { params: Record<string, unknown> | undefined }) {
  if (!params || Object.keys(params).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {Object.entries(params).map(([k, v]) => (
        <span
          key={k}
          className="text-[10px] font-mono bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded"
        >
          {k}={String(v)}
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// SubStrategy Card
// ============================================================================

function SubStrategyCard({
  sub,
  index,
  onRemove,
}: {
  sub: SubStrategyConfig;
  index: number;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="flex items-start gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono font-semibold text-white truncate">
            {sub.strategyName}
          </span>
          <span className="text-xs text-gray-400 font-mono">{sub.symbol}</span>
          <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono">
            {sub.timeframe}
          </span>
        </div>
        <ParamTokens params={sub.params} />
      </div>
      <button
        onClick={() => onRemove(index)}
        className="flex-shrink-0 p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
        aria-label="Remove substrategy"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ============================================================================
// AddSubStrategy inline form
// ============================================================================

function AddSubStrategyForm({
  defaultStrategy,
  onAdd,
  onCancel,
}: {
  defaultStrategy: string;
  onAdd: (sub: SubStrategyConfig) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<NewSubStrategy>({
    strategyName: defaultStrategy,
    symbol: '',
    timeframe: '4h',
    paramsRaw: '',
  });
  const [paramsError, setParamsError] = useState('');

  const handleAdd = () => {
    let params: Record<string, unknown> | undefined;
    if (form.paramsRaw.trim()) {
      try {
        params = JSON.parse(form.paramsRaw);
      } catch {
        setParamsError('Invalid JSON');
        return;
      }
    }
    if (!form.strategyName.trim() || !form.symbol.trim()) return;
    onAdd({
      strategyName: form.strategyName.trim(),
      symbol: form.symbol.trim(),
      timeframe: form.timeframe,
      ...(params ? { params } : {}),
    });
  };

  const inputClass =
    'px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 placeholder-gray-500';

  return (
    <div className="bg-gray-800 border border-primary-700/50 rounded-lg px-3 py-3 space-y-2.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">New Sub-strategy</p>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase">Strategy name</label>
          <input
            type="text"
            value={form.strategyName}
            onChange={e => setForm(f => ({ ...f, strategyName: e.target.value }))}
            placeholder="e.g. funding-rate-spike-v2"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase">Symbol</label>
          <input
            type="text"
            value={form.symbol}
            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
            placeholder="e.g. ATOM/USDT:USDT"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-500 uppercase">TF</label>
          <select
            value={form.timeframe}
            onChange={e => setForm(f => ({ ...f, timeframe: e.target.value as Timeframe }))}
            className="px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500"
          >
            {TIMEFRAME_OPTIONS.map(tf => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-gray-500 uppercase">Params (optional JSON)</label>
        <input
          type="text"
          value={form.paramsRaw}
          onChange={e => { setForm(f => ({ ...f, paramsRaw: e.target.value })); setParamsError(''); }}
          placeholder='{"absThreshold": 0.005, "holdBars": 3}'
          className={`${inputClass} ${paramsError ? 'border-red-500' : ''}`}
        />
        {paramsError && <p className="text-[10px] text-red-400">{paramsError}</p>}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={!form.strategyName.trim() || !form.symbol.trim()}
          className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Aggregation Editor
// ============================================================================

function AggregationEditor({
  params,
  onRerun,
  onClose,
  isRunning,
}: {
  params: Record<string, unknown>;
  onRerun: (params: Record<string, unknown>) => void;
  onClose: () => void;
  isRunning?: boolean;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const parsed = parseAggParams(params);
  const [topLevel, setTopLevel] = useState<AggTopLevel>(parsed.topLevel);
  const [subStrategies, setSubStrategies] = useState<SubStrategyConfig[]>(parsed.subStrategies);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleRemoveSub = (index: number) => {
    setSubStrategies(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddSub = (sub: SubStrategyConfig) => {
    setSubStrategies(prev => [...prev, sub]);
    setShowAddForm(false);
  };

  const handleRerun = () => {
    onRerun({
      ...params,
      ...topLevel,
      subStrategies,
    });
  };

  const inputClass =
    'flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500';
  const labelClass = 'text-xs text-gray-400 font-mono w-[140px] flex-shrink-0';

  return (
    <>
      {/* Top-level settings */}
      <div className="space-y-2.5">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-700/60">
          Aggregation Settings
        </p>

        {/* Allocation Mode */}
        <div className="flex items-center gap-3">
          <label className={labelClass}>allocationMode</label>
          <select
            value={topLevel.allocationMode}
            onChange={e => setTopLevel(t => ({ ...t, allocationMode: e.target.value as AllocationMode }))}
            className={inputClass}
          >
            {ALLOCATION_MODE_OPTIONS.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Max Positions */}
        <div className="flex items-center gap-3">
          <label className={labelClass}>maxPositions</label>
          <input
            type="number"
            min={1}
            value={topLevel.maxPositions}
            onChange={e => setTopLevel(t => ({ ...t, maxPositions: parseInt(e.target.value) || 1 }))}
            className={inputClass}
          />
        </div>

        {/* Initial Capital */}
        <div className="flex items-center gap-3">
          <label className={labelClass}>initialCapital</label>
          <input
            type="number"
            min={0}
            step="any"
            value={topLevel.initialCapital}
            onChange={e => setTopLevel(t => ({ ...t, initialCapital: parseFloat(e.target.value) || 0 }))}
            className={`${inputClass} font-mono`}
          />
        </div>

        {/* Mode */}
        <div className="flex items-center gap-3">
          <label className={labelClass}>mode</label>
          <select
            value={topLevel.mode}
            onChange={e => setTopLevel(t => ({ ...t, mode: e.target.value as 'spot' | 'futures' }))}
            className={inputClass}
          >
            <option value="spot">spot</option>
            <option value="futures">futures</option>
          </select>
        </div>

        {/* Exchange */}
        <div className="flex items-center gap-3">
          <label className={labelClass}>exchange</label>
          <input
            type="text"
            value={topLevel.exchange}
            onChange={e => setTopLevel(t => ({ ...t, exchange: e.target.value }))}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {/* Sub-strategies */}
      <div className="space-y-2 mt-4">
        <div className="flex items-center justify-between pb-1 border-b border-gray-700/60">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            Sub-strategies ({subStrategies.length})
          </p>
        </div>

        {subStrategies.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-2">No sub-strategies</p>
        )}

        <div className="space-y-2">
          {subStrategies.map((sub, i) => (
            <SubStrategyCard key={i} sub={sub} index={i} onRemove={handleRemoveSub} />
          ))}
        </div>

        {showAddForm ? (
          <AddSubStrategyForm
            defaultStrategy={subStrategies[0]?.strategyName ?? ''}
            onAdd={handleAddSub}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-600 hover:border-primary-500 text-gray-500 hover:text-primary-400 rounded-lg text-xs font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Sub-strategy
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-700 mt-4 -mx-5 -mb-3">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Close
        </button>
        {isAuthenticated && (
          <button
            onClick={handleRerun}
            disabled={isRunning || subStrategies.length === 0}
            className="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? 'Running...' : 'Load & Run'}
          </button>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Strategy Editor
// ============================================================================

function StrategyEditor({
  run,
  onRerun,
  onClose,
  isRunning,
}: {
  run: BacktestSummary;
  onRerun: (params: Record<string, unknown>) => void;
  onClose: () => void;
  isRunning?: boolean;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [editedParams, setEditedParams] = useState<Record<string, string>>({});

  useEffect(() => {
    if (run.params) {
      const initial: Record<string, string> = {};
      for (const [k, v] of Object.entries(run.params)) {
        // Skip object-valued fields (e.g. nested config) — show them read-only
        if (typeof v !== 'object' || v === null) {
          initial[k] = String(v);
        }
      }
      setEditedParams(initial);
    }
  }, [run]);

  const handleParamChange = (key: string, value: string) => {
    setEditedParams(prev => ({ ...prev, [key]: value }));
  };

  const handleRerun = () => {
    const params: Record<string, unknown> = {};
    const originalParams = run.params ?? {};
    for (const [k, v] of Object.entries(editedParams)) {
      params[k] = coerceParam(originalParams[k], v);
    }
    // Re-include any object-typed params unchanged
    for (const [k, v] of Object.entries(originalParams)) {
      if (typeof v === 'object' && v !== null && !(k in params)) {
        params[k] = v;
      }
    }
    onRerun(params);
  };

  const hasParams = Object.keys(editedParams).length > 0;

  if (!hasParams) {
    return (
      <>
        <p className="text-sm text-gray-500 text-center py-4">No parameters for this run</p>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-700 -mx-5 -mb-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-2.5">
        {Object.entries(editedParams).map(([key, value]) => {
          const origValue = run.params?.[key];
          const isBool = typeof origValue === 'boolean';
          return (
            <div key={key} className="flex items-center gap-3">
              <label
                className="text-xs text-gray-400 font-mono w-[180px] flex-shrink-0 truncate"
                title={key}
              >
                {key}
              </label>
              {isBool ? (
                <select
                  value={value}
                  onChange={e => handleParamChange(key, e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={typeof origValue === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={e => handleParamChange(key, e.target.value)}
                  step={typeof origValue === 'number' ? 'any' : undefined}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-700 mt-4 -mx-5 -mb-3">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Close
        </button>
        {isAuthenticated && (
          <button
            onClick={handleRerun}
            disabled={isRunning}
            className="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? 'Running...' : 'Load & Run'}
          </button>
        )}
      </div>
    </>
  );
}

// ============================================================================
// RunParamsModal — root component
// ============================================================================

export function RunParamsModal({ run, isOpen, onClose, onRerun, isRunning }: RunParamsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAggregation = run.symbol === 'MULTI' || !!run.aggregationName;
  const params = run.params ?? {};

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {isAggregation && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/50 text-purple-400">
                  AGG
                </span>
              )}
              <h3 className="text-base font-bold text-white">Run Parameters</h3>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {isAggregation
                ? (run.aggregationName ?? run.strategyName)
                : `${run.strategyName} — ${run.symbol}${run.timeframe ? ` (${run.timeframe})` : ''}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isAggregation ? (
            <AggregationEditor
              params={params}
              onRerun={onRerun}
              onClose={onClose}
              isRunning={isRunning}
            />
          ) : (
            <StrategyEditor
              run={run}
              onRerun={onRerun}
              onClose={onClose}
              isRunning={isRunning}
            />
          )}
        </div>
      </div>
    </div>
  );
}
