/**
 * RunParamsModal — view and edit parameters from a historical backtest run,
 * then rerun the backtest with the (possibly modified) params.
 */

import { useState, useEffect } from 'react';
import type { BacktestSummary } from '../../types';

interface RunParamsModalProps {
  run: BacktestSummary;
  isOpen: boolean;
  onClose: () => void;
  onRerun: (params: Record<string, unknown>) => void;
  isRunning?: boolean;
}

export function RunParamsModal({ run, isOpen, onClose, onRerun, isRunning }: RunParamsModalProps) {
  const [editedParams, setEditedParams] = useState<Record<string, string>>({});

  useEffect(() => {
    if (run.params && isOpen) {
      const initial: Record<string, string> = {};
      for (const [k, v] of Object.entries(run.params)) {
        initial[k] = String(v);
      }
      setEditedParams(initial);
    }
  }, [run, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAggregation = run.symbol === 'MULTI' || !!run.aggregationName;

  const handleParamChange = (key: string, value: string) => {
    setEditedParams(prev => ({ ...prev, [key]: value }));
  };

  const handleRerun = () => {
    const params: Record<string, unknown> = {};
    const originalParams = run.params ?? {};
    for (const [k, v] of Object.entries(editedParams)) {
      const orig = originalParams[k];
      if (typeof orig === 'number') {
        params[k] = parseFloat(v) || 0;
      } else if (typeof orig === 'boolean') {
        params[k] = v === 'true';
      } else {
        params[k] = v;
      }
    }
    onRerun(params);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div>
            <h3 className="text-base font-bold text-white">Run Parameters</h3>
            <div className="text-xs text-gray-400 mt-0.5">
              {run.strategyName} — {run.symbol}{run.timeframe ? ` (${run.timeframe})` : ''}
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

        {/* Params */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {Object.keys(editedParams).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No parameters for this run</p>
          ) : (
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
                        onChange={(e) => handleParamChange(key, e.target.value)}
                        disabled={isAggregation}
                        className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500 disabled:opacity-50"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        type={typeof origValue === 'number' ? 'number' : 'text'}
                        value={value}
                        onChange={(e) => handleParamChange(key, e.target.value)}
                        step={typeof origValue === 'number' ? 'any' : undefined}
                        disabled={isAggregation}
                        className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 font-mono focus:outline-none focus:border-primary-500 disabled:opacity-50"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isAggregation && (
            <p className="text-xs text-gray-500 mt-3 italic">
              Aggregation params are read-only. Edit the aggregation config to change parameters.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            Cancel
          </button>
          {!isAggregation && Object.keys(editedParams).length > 0 && (
            <button
              onClick={handleRerun}
              disabled={isRunning}
              className="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Running...' : 'Load into Config'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
