import { useState } from 'react';
import { useCreateAggregation, useStrategies } from '../../hooks/useBacktest';
import type { SubStrategyConfig, AllocationMode, Timeframe, BacktestSummary } from '../../types';
import { HistoryExplorer } from '../HistoryExplorer/HistoryExplorer';

interface Props {
  onClose: () => void;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export function CreateAggregationModal({ onClose }: Props) {
  const { data: strategies } = useStrategies();
  const createMutation = useCreateAggregation();

  const [name, setName] = useState('');
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('single_strongest');
  const [maxPositions, setMaxPositions] = useState(3);
  const [exchange, setExchange] = useState('bybit');
  const [mode, setMode] = useState<'spot' | 'futures'>('futures');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [subStrategies, setSubStrategies] = useState<SubStrategyConfig[]>([]);

  // New sub-strategy form
  const [newStrategyName, setNewStrategyName] = useState('funding-rate-spike');
  const [newSymbol, setNewSymbol] = useState('');
  const [newTimeframe, setNewTimeframe] = useState<Timeframe>('4h');

  // History picker
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);

  const handlePickFromHistory = (run: BacktestSummary) => {
    if (subStrategies.some(s => s.symbol === run.symbol)) return; // duplicate check
    setSubStrategies([...subStrategies, {
      strategyName: run.strategyName,
      symbol: run.symbol,
      timeframe: run.timeframe,
      params: run.params ?? {},
      exchange: run.exchange ?? exchange,
    }]);
    setShowHistoryPicker(false);
  };

  const handleAddSubStrategy = () => {
    if (!newSymbol.trim()) return;
    // Check for duplicate symbols
    if (subStrategies.some(s => s.symbol === newSymbol.trim())) {
      alert('Duplicate symbol - each symbol can only appear once');
      return;
    }
    setSubStrategies([...subStrategies, {
      strategyName: newStrategyName,
      symbol: newSymbol.trim(),
      timeframe: newTimeframe,
      params: {},
      exchange,
    }]);
    setNewSymbol('');
  };

  const handleRemoveSubStrategy = (index: number) => {
    setSubStrategies(subStrategies.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!name.trim() || subStrategies.length === 0) return;
    createMutation.mutate({
      name: name.trim(),
      allocationMode,
      maxPositions,
      subStrategies,
      initialCapital,
      exchange,
      mode,
    }, {
      onSuccess: () => onClose(),
    });
  };

  const inputClass = 'w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';

  const availableStrategies = strategies ?? [];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Create Aggregation</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., FR Spike Conservative"
              className={inputClass}
            />
          </div>

          {/* Allocation Mode + Max Positions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Allocation Mode</label>
              <select
                value={allocationMode}
                onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
                className={inputClass}
              >
                <option value="single_strongest">Single Strongest</option>
                <option value="weighted_multi">Weighted Multi</option>
                <option value="top_n">Top N</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Positions</label>
              <input
                type="number"
                value={maxPositions}
                onChange={(e) => setMaxPositions(parseInt(e.target.value) || 1)}
                min={1}
                max={20}
                className={inputClass}
              />
            </div>
          </div>

          {/* Exchange + Mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Exchange</label>
              <select value={exchange} onChange={(e) => setExchange(e.target.value)} className={inputClass}>
                <option value="bybit">Bybit</option>
                <option value="binance">Binance</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'spot' | 'futures')} className={inputClass}>
                <option value="spot">Spot</option>
                <option value="futures">Futures</option>
              </select>
            </div>
          </div>

          {/* Initial Capital */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Default Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              min={0}
              step={1000}
              className={inputClass}
            />
          </div>

          {/* Sub-Strategies */}
          <div className="border-t border-gray-700 pt-3">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Sub-Strategies ({subStrategies.length})
            </label>

            {/* Existing sub-strategies */}
            {subStrategies.length > 0 && (
              <div className="space-y-1 mb-3">
                {subStrategies.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-700/50 rounded px-2.5 py-1.5 text-xs">
                    <span className="text-gray-300">
                      <span className="text-white">{s.strategyName}</span>
                      {' '}&mdash;{' '}
                      {s.symbol.replace('/USDT:USDT', '')} ({s.timeframe})
                    </span>
                    <button
                      onClick={() => handleRemoveSubStrategy(i)}
                      className="text-gray-500 hover:text-red-400"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new sub-strategy */}
            <div className="space-y-2 bg-gray-900/50 rounded p-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Strategy</label>
                  <select
                    value={newStrategyName}
                    onChange={(e) => setNewStrategyName(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
                  >
                    {availableStrategies.length === 0 && (
                      <option value="funding-rate-spike">funding-rate-spike</option>
                    )}
                    {availableStrategies.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Symbol</label>
                  <input
                    type="text"
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                    placeholder="BTC/USDT:USDT"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Timeframe</label>
                  <select
                    value={newTimeframe}
                    onChange={(e) => setNewTimeframe(e.target.value as Timeframe)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs"
                  >
                    {TIMEFRAMES.map(tf => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={handleAddSubStrategy}
                disabled={!newSymbol.trim()}
                className="w-full py-1.5 rounded text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Add Sub-Strategy
              </button>
            </div>
            <button
              onClick={() => setShowHistoryPicker(true)}
              className="w-full py-1.5 rounded text-xs font-medium text-primary-400 bg-gray-800 hover:bg-gray-700 border border-gray-600 transition-colors mt-1"
            >
              + Add from History
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || subStrategies.length === 0 || createMutation.isPending}
            className={`flex-1 py-2 rounded font-medium text-white transition-colors text-sm ${
              name.trim() && subStrategies.length > 0 && !createMutation.isPending
                ? 'bg-primary-600 hover:bg-primary-500'
                : 'bg-gray-600 cursor-not-allowed'
            }`}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {showHistoryPicker && (
        <HistoryExplorer
          isOpen={showHistoryPicker}
          onClose={() => setShowHistoryPicker(false)}
          onSelectRun={() => {}}
          title="Select Run to Add as Sub-Strategy"
          fixedRunType="strategies"
          onPickRun={handlePickFromHistory}
        />
      )}
    </div>
  );
}
