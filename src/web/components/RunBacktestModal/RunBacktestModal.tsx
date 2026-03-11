/**
 * RunBacktestModal — modal dialog for configuring and running a new backtest.
 * Supports both single-strategy configs and aggregation configs.
 * Uses a searchable card list to select a configuration, then
 * accepts runtime fields (exchange, dates, capital) before running.
 */

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore.js';
import { useRunBacktest, useAggregations, useRunAggregation } from '../../hooks/useBacktest.js';
import { useStrategyConfigs } from '../../hooks/useConfigurations.js';
import { useBacktestStore } from '../../stores/backtestStore.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyConfigListItem, AggregationConfig, Timeframe } from '../../types.js';

// ============================================================================
// Default dates
// ============================================================================

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

// ============================================================================
// Shared style constants
// ============================================================================

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '7px 10px',
  color: '#e0e0e0',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#888',
  marginBottom: 4,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 14,
};

// ============================================================================
// StrategyConfigCard
// ============================================================================

function StrategyConfigCard({
  config,
  selected,
  onClick,
}: {
  config: StrategyConfigListItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: selected ? 'rgba(33,150,243,0.12)' : '#222',
        border: `1px solid ${selected ? '#2196f3' : '#333'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
          {config.name || config.strategyName}
        </span>
        {config.latestRunSharpe != null && (
          <span style={{ fontSize: 11, color: config.latestRunSharpe >= 0 ? '#4caf50' : '#ef5350' }}>
            Sharpe {config.latestRunSharpe.toFixed(2)}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>{config.strategyName}</span>
        <span style={{ fontSize: 11, color: '#666' }}>&bull;</span>
        <span style={{ fontSize: 11, color: '#888' }}>{config.symbol}</span>
        <span style={{ fontSize: 11, color: '#666' }}>&bull;</span>
        <span style={{ fontSize: 11, color: '#888' }}>{config.timeframe}</span>
      </div>
    </div>
  );
}

// ============================================================================
// AggregationCard
// ============================================================================

function AggregationCard({
  config,
  selected,
  onClick,
}: {
  config: AggregationConfig;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: selected ? 'rgba(33,150,243,0.12)' : '#222',
        border: `1px solid ${selected ? '#2196f3' : '#333'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginBottom: 3 }}>
        {config.name}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#888' }}>{config.allocationMode.replace(/_/g, ' ')}</span>
        <span style={{ fontSize: 11, color: '#666' }}>&bull;</span>
        <span style={{ fontSize: 11, color: '#888' }}>
          {config.subStrategies.length} {config.subStrategies.length === 1 ? 'strategy' : 'strategies'}
        </span>
        {config.exchange && (
          <>
            <span style={{ fontSize: 11, color: '#666' }}>&bull;</span>
            <span style={{ fontSize: 11, color: '#888' }}>{config.exchange}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// RunBacktestModal
// ============================================================================

export function RunBacktestModal() {
  const { isOpen, prefillConfig, close } = useRunBacktestModalStore();

  const defaults = getDefaultDates();

  // Tab state: 'strategy' | 'aggregation'
  const [activeTab, setActiveTab] = useState<'strategy' | 'aggregation'>('strategy');

  // Search text for filtering config lists
  const [searchText, setSearchText] = useState('');

  // Selected IDs
  const [selectedStrategyConfigId, setSelectedStrategyConfigId] = useState<string>('');
  const [selectedAggregationId, setSelectedAggregationId] = useState<string>('');

  // Runtime fields
  const [exchange, setExchange] = useState('bybit');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [initialCapital, setInitialCapital] = useState(10000);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: strategyConfigs, isLoading: loadingStrategyConfigs } = useStrategyConfigs();
  const { data: aggregations, isLoading: loadingAggregations } = useAggregations();
  const runBacktestMutation = useRunBacktest();
  const runAggregationMutation = useRunAggregation();
  const { isRunning } = useBacktestStore();

  // Derive selected objects
  const selectedStrategyConfig: StrategyConfigListItem | undefined = strategyConfigs?.find(
    (c) => c.id === selectedStrategyConfigId,
  );
  const selectedAggregation: AggregationConfig | undefined = aggregations?.find(
    (a) => a.id === selectedAggregationId,
  );

  // Filter strategy configs by search text
  const filteredStrategyConfigs = strategyConfigs?.filter((c) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.strategyName.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q) ||
      c.timeframe.toLowerCase().includes(q)
    );
  }) ?? [];

  // Filter aggregations by search text
  const filteredAggregations = aggregations?.filter((a) => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.allocationMode.toLowerCase().includes(q) ||
      a.subStrategies.some((s) => s.strategyName.toLowerCase().includes(q))
    );
  }) ?? [];

  // Apply prefill when modal opens
  useEffect(() => {
    if (isOpen && prefillConfig && strategyConfigs && strategyConfigs.length > 0) {
      const match = strategyConfigs.find(
        (c) =>
          c.strategyName === prefillConfig.strategyName &&
          c.symbol === prefillConfig.symbol &&
          c.timeframe === prefillConfig.timeframe,
      );
      if (match) {
        setActiveTab('strategy');
        setSelectedStrategyConfigId(match.id);
      }
    }
    if (isOpen) {
      setSubmitError(null);
      setSearchText('');
    }
  }, [isOpen, prefillConfig, strategyConfigs]);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    },
    [close],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleKeyDown]);

  // Reset search when switching tabs
  const handleTabChange = (tab: 'strategy' | 'aggregation') => {
    setActiveTab(tab);
    setSearchText('');
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    setSubmitError(null);

    if (!startDate || !endDate) {
      setSubmitError('Start date and end date are required.');
      return;
    }

    if (activeTab === 'strategy') {
      if (!selectedStrategyConfig) {
        setSubmitError('Please select a strategy configuration.');
        return;
      }
      runBacktestMutation.mutate(
        {
          strategyName: selectedStrategyConfig.strategyName,
          symbol: selectedStrategyConfig.symbol,
          timeframe: selectedStrategyConfig.timeframe as Timeframe,
          params: selectedStrategyConfig.params,
          exchange,
          startDate,
          endDate,
          initialCapital,
        },
        {
          onSuccess: () => close(),
          onError: (err) => setSubmitError(err.message),
        },
      );
    } else {
      if (!selectedAggregation) {
        setSubmitError('Please select an aggregation configuration.');
        return;
      }
      runAggregationMutation.mutate(
        {
          id: selectedAggregation.id,
          request: { startDate, endDate, initialCapital },
        },
        {
          onSuccess: () => close(),
          onError: (err) => setSubmitError(err.message),
        },
      );
    }
  };

  if (!isOpen) return null;

  const isSubmitting = isRunning || runBacktestMutation.isPending || runAggregationMutation.isPending;
  const hasSelection = activeTab === 'strategy' ? !!selectedStrategyConfig : !!selectedAggregation;
  const canSubmit = hasSelection && !!startDate && !!endDate && !isSubmitting;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.72)',
        }}
        onClick={close}
      />

      {/* Modal content */}
      <div
        style={{
          position: 'relative',
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 12,
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          overflowY: 'auto',
          margin: '0 16px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 20px 14px',
            borderBottom: '1px solid #2a2a2a',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e0e0e0' }}>
            New Backtest
          </h2>
          <button
            onClick={close}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
              fontSize: 18,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px' }}>

          {/* Strategy / Aggregation tab toggle */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              marginBottom: 16,
              background: '#222',
              border: '1px solid #333',
              borderRadius: 8,
              padding: 3,
            }}
          >
            {(['strategy', 'aggregation'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  border: 'none',
                  borderRadius: 6,
                  background: activeTab === tab ? '#2196f3' : 'transparent',
                  color: activeTab === tab ? '#fff' : '#888',
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div style={sectionStyle}>
            <input
              type="text"
              placeholder={activeTab === 'strategy' ? 'Search by name, symbol, timeframe...' : 'Search by name or strategy...'}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ ...inputStyle, marginBottom: 8 }}
            />

            {/* Scrollable config card list */}
            <div
              style={{
                maxHeight: 250,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 2,
              }}
            >
              {activeTab === 'strategy' ? (
                loadingStrategyConfigs ? (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>
                    Loading configurations...
                  </div>
                ) : filteredStrategyConfigs.length === 0 ? (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>
                    {searchText ? 'No configurations match your search.' : 'No strategy configurations found.'}
                  </div>
                ) : (
                  filteredStrategyConfigs.map((c) => (
                    <StrategyConfigCard
                      key={c.id}
                      config={c}
                      selected={selectedStrategyConfigId === c.id}
                      onClick={() => {
                        setSelectedStrategyConfigId(c.id);
                        setSubmitError(null);
                      }}
                    />
                  ))
                )
              ) : (
                loadingAggregations ? (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>
                    Loading aggregations...
                  </div>
                ) : filteredAggregations.length === 0 ? (
                  <div style={{ padding: '16px 0', textAlign: 'center', color: '#666', fontSize: 13 }}>
                    {searchText ? 'No aggregations match your search.' : 'No aggregation configurations found.'}
                  </div>
                ) : (
                  filteredAggregations.map((a) => (
                    <AggregationCard
                      key={a.id}
                      config={a}
                      selected={selectedAggregationId === a.id}
                      onClick={() => {
                        setSelectedAggregationId(a.id);
                        setSubmitError(null);
                      }}
                    />
                  ))
                )
              )}
            </div>
          </div>

          {/* Exchange */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Exchange</label>
            <select
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              style={inputStyle}
            >
              <option value="bybit">Bybit</option>
              <option value="binance">Binance</option>
            </select>
          </div>

          {/* Date range row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Initial Capital */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Initial Capital ($)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseFloat(e.target.value) || 0)}
              min={0}
              step={1000}
              style={inputStyle}
            />
          </div>

          {/* Error */}
          {submitError && (
            <div
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                color: '#f87171',
                marginBottom: 14,
              }}
            >
              {submitError}
            </div>
          )}

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={close}
              disabled={isSubmitting}
              style={{
                padding: '9px 18px',
                background: 'none',
                border: '1px solid #444',
                borderRadius: 8,
                color: '#aaa',
                fontSize: 14,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: '9px 22px',
                background: canSubmit ? '#2196f3' : '#333',
                border: 'none',
                borderRadius: 8,
                color: canSubmit ? '#fff' : '#666',
                fontSize: 14,
                fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {isSubmitting ? (
                <>
                  <Spinner size="sm" />
                  Running...
                </>
              ) : (
                'Run Backtest'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
