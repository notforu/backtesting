/**
 * RunBacktestModal — modal dialog for configuring and running a new backtest.
 * Uses a configuration dropdown to select an existing strategy config, then
 * accepts runtime fields (exchange, mode, dates, capital) before running.
 */

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore.js';
import { useRunBacktest } from '../../hooks/useBacktest.js';
import { useStrategyConfigs } from '../../hooks/useConfigurations.js';
import { useBacktestStore } from '../../stores/backtestStore.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyConfigListItem, Timeframe } from '../../types.js';

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
// RunBacktestModal
// ============================================================================

export function RunBacktestModal() {
  const { isOpen, prefillConfig, close } = useRunBacktestModalStore();

  const defaults = getDefaultDates();
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [exchange, setExchange] = useState('bybit');
  const [mode, setMode] = useState<'spot' | 'futures'>('spot');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [runImmediately, setRunImmediately] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: configs, isLoading: loadingConfigs } = useStrategyConfigs();
  const runBacktestMutation = useRunBacktest();
  const { isRunning } = useBacktestStore();

  // Derive selected config object from the list
  const selectedConfig: StrategyConfigListItem | undefined = configs?.find(
    (c) => c.id === selectedConfigId,
  );

  // Apply prefill when modal opens — auto-select matching config
  useEffect(() => {
    if (isOpen && prefillConfig && configs && configs.length > 0) {
      const match = configs.find(
        (c) =>
          c.strategyName === prefillConfig.strategyName &&
          c.symbol === prefillConfig.symbol &&
          c.timeframe === prefillConfig.timeframe,
      );
      if (match) {
        setSelectedConfigId(match.id);
      }
    }
    if (isOpen) {
      setSubmitError(null);
    }
  }, [isOpen, prefillConfig, configs]);

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

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!selectedConfig) {
      setSubmitError('Please select a configuration.');
      return;
    }
    if (!startDate || !endDate) {
      setSubmitError('Start date and end date are required.');
      return;
    }

    runBacktestMutation.mutate(
      {
        strategyName: selectedConfig.strategyName,
        symbol: selectedConfig.symbol,
        timeframe: selectedConfig.timeframe as Timeframe,
        params: selectedConfig.params,
        exchange,
        mode,
        startDate,
        endDate,
        initialCapital,
      },
      {
        onSuccess: () => close(),
        onError: (err) => setSubmitError(err.message),
      },
    );
  };

  if (!isOpen) return null;

  const isSubmitting = isRunning || runBacktestMutation.isPending;
  const canSubmit = !!selectedConfig && !!startDate && !!endDate && !isSubmitting;

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
          maxHeight: '85vh',
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

          {/* Configuration dropdown */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Configuration</label>
            <select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              disabled={loadingConfigs}
              style={inputStyle}
            >
              <option value="">
                {loadingConfigs ? 'Loading configurations...' : 'Select a configuration...'}
              </option>
              {configs?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.strategyName} / {c.symbol} / {c.timeframe}
                </option>
              ))}
            </select>

            {/* Config summary */}
            {selectedConfig && Object.keys(selectedConfig.params).length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  background: '#222',
                  border: '1px solid #333',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#888',
                  lineHeight: 1.6,
                }}
              >
                {Object.entries(selectedConfig.params).map(([k, v]) => (
                  <span key={k} style={{ marginRight: 12 }}>
                    <span style={{ color: '#666' }}>{k}:</span>{' '}
                    <span style={{ color: '#aaa' }}>{String(v)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Exchange + Mode row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
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
            <div>
              <label style={labelStyle}>Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'spot' | 'futures')}
                style={inputStyle}
              >
                <option value="spot">Spot</option>
                <option value="futures">Futures</option>
              </select>
            </div>
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

          {/* Run immediately checkbox */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 18,
              padding: '10px 12px',
              background: '#1e1e1e',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
            }}
          >
            <input
              id="modal-run-immediately"
              type="checkbox"
              checked={runImmediately}
              onChange={(e) => setRunImmediately(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#3b82f6', cursor: 'pointer' }}
            />
            <label htmlFor="modal-run-immediately" style={{ fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
              Run backtest immediately
            </label>
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
              onClick={runImmediately ? handleSubmit : close}
              disabled={runImmediately ? !canSubmit : false}
              style={{
                padding: '9px 22px',
                background: (runImmediately ? canSubmit : true) ? '#2196f3' : '#333',
                border: 'none',
                borderRadius: 8,
                color: (runImmediately ? canSubmit : true) ? '#fff' : '#666',
                fontSize: 14,
                fontWeight: 600,
                cursor: (runImmediately ? canSubmit : true) ? 'pointer' : 'not-allowed',
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
              ) : runImmediately ? (
                'Run'
              ) : (
                'Close'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
