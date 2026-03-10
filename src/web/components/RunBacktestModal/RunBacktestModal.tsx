/**
 * RunBacktestModal — modal dialog for configuring and running a new backtest.
 * Can be opened from the app header (blank form) or from a config detail (prefilled).
 */

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore.js';
import { useStrategies, useStrategy, useRunBacktest } from '../../hooks/useBacktest.js';
import { useCreateStrategyConfig } from '../../hooks/useConfigurations.js';
import { useBacktestStore } from '../../stores/backtestStore.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyParam, Timeframe } from '../../types.js';

// ============================================================================
// Constants
// ============================================================================

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

const COMMON_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
];

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
// ParamInput (same logic as StrategyConfig sidebar)
// ============================================================================

interface ParamInputProps {
  param: StrategyParam;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ParamInput({ param, value, onChange }: ParamInputProps) {
  const inputId = `modal-param-${param.name}`;
  const currentValue = value ?? param.default;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 6,
    padding: '7px 10px',
    color: '#e0e0e0',
    fontSize: 13,
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  };

  switch (param.type) {
    case 'number':
      return (
        <div>
          <label htmlFor={inputId} style={labelStyle}>{param.label}</label>
          <input
            id={inputId}
            type="number"
            value={currentValue as number}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            style={inputStyle}
          />
          {param.description && (
            <p style={{ fontSize: 11, color: '#555', marginTop: 3 }}>{param.description}</p>
          )}
        </div>
      );

    case 'boolean':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id={inputId}
            type="checkbox"
            checked={currentValue as boolean}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
          <label htmlFor={inputId} style={{ fontSize: 13, color: '#ccc', cursor: 'pointer' }}>
            {param.label}
          </label>
        </div>
      );

    case 'select':
      return (
        <div>
          <label htmlFor={inputId} style={labelStyle}>{param.label}</label>
          <select
            id={inputId}
            value={currentValue as string}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle}
          >
            {param.options?.map((opt) => {
              const optValue = typeof opt === 'string' ? opt : opt.value;
              const optLabel = typeof opt === 'string' ? opt : opt.label;
              return (
                <option key={String(optValue)} value={String(optValue)}>
                  {optLabel}
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
          <label htmlFor={inputId} style={labelStyle}>{param.label}</label>
          <input
            id={inputId}
            type="text"
            value={currentValue as string}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle}
          />
        </div>
      );
  }
}

// ============================================================================
// RunBacktestModal
// ============================================================================

export function RunBacktestModal() {
  const { isOpen, prefillConfig, close } = useRunBacktestModalStore();

  const defaults = getDefaultDates();
  const [strategyName, setStrategyName] = useState('');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('4h');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [exchange, setExchange] = useState('bybit');
  const [mode, setMode] = useState<'spot' | 'futures'>('spot');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [runImmediately, setRunImmediately] = useState(true);
  const [paramsExpanded, setParamsExpanded] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: strategies, isLoading: loadingStrategies } = useStrategies();
  const { data: strategyDetails, isLoading: loadingDetails } = useStrategy(strategyName);
  const runBacktestMutation = useRunBacktest();
  const createConfigMutation = useCreateStrategyConfig();
  const { isRunning } = useBacktestStore();

  // Apply prefill values when the modal opens
  useEffect(() => {
    if (isOpen && prefillConfig) {
      setStrategyName(prefillConfig.strategyName);
      setSymbol(prefillConfig.symbol);
      setTimeframe(prefillConfig.timeframe as Timeframe);
      setParams(prefillConfig.params);
    }
    if (isOpen) {
      setSubmitError(null);
    }
  }, [isOpen, prefillConfig]);

  // When strategy changes (user picks a different one), reset params to defaults
  useEffect(() => {
    if (!strategyName) return;
    // Only reset if the prefill strategy matches — otherwise keep prefill params
    if (prefillConfig && prefillConfig.strategyName === strategyName) return;
    if (strategyDetails?.params) {
      const defaultParams: Record<string, unknown> = {};
      strategyDetails.params.forEach((p) => {
        defaultParams[p.name] = p.default;
      });
      setParams(defaultParams);
      setParamsExpanded((strategyDetails.params.length || 0) < 4);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyDetails]);

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
    if (!strategyName || !symbol || !startDate || !endDate) {
      setSubmitError('Strategy, symbol, start date and end date are required.');
      return;
    }

    try {
      if (runImmediately) {
        runBacktestMutation.mutate(
          {
            strategyName,
            symbol,
            timeframe,
            params,
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
      } else {
        await createConfigMutation.mutateAsync({
          strategyName,
          symbol,
          timeframe,
          params,
        });
        close();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  if (!isOpen) return null;

  const isSubmitting = runImmediately ? isRunning || runBacktestMutation.isPending : createConfigMutation.isPending;
  const canSubmit = !!strategyName && !!symbol && !!startDate && !!endDate && !isSubmitting;

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

          {/* Strategy */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Strategy</label>
            <select
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              disabled={loadingStrategies}
              style={inputStyle}
            >
              <option value="">Select a strategy...</option>
              {strategies?.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            {strategyDetails && (
              <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                {strategyDetails.description}
              </p>
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

          {/* Symbol + Timeframe row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder={mode === 'futures' ? 'BTC/USDT:USDT' : 'BTCUSDT'}
                list="modal-symbols"
                style={inputStyle}
              />
              <datalist id="modal-symbols">
                {COMMON_SYMBOLS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {mode === 'futures' && (
                <p style={{ fontSize: 11, color: '#555', marginTop: 3 }}>
                  Format: BTC/USDT:USDT
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                style={inputStyle}
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>
                    {tf.label}
                  </option>
                ))}
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

          {/* Strategy Parameters — collapsible */}
          {strategyDetails?.params && strategyDetails.params.length > 0 && (
            <div
              style={{
                borderTop: '1px solid #2a2a2a',
                paddingTop: 14,
                marginBottom: 14,
              }}
            >
              <button
                onClick={() => setParamsExpanded(!paramsExpanded)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#aaa',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: 0,
                  marginBottom: paramsExpanded ? 12 : 0,
                }}
              >
                <span>Strategy Parameters</span>
                <svg
                  style={{
                    width: 14,
                    height: 14,
                    transform: paramsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                  }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {paramsExpanded && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  {loadingDetails ? (
                    <div style={{ gridColumn: 'span 2', fontSize: 13, color: '#555' }}>
                      Loading parameters...
                    </div>
                  ) : (
                    strategyDetails.params.map((param) => (
                      <div
                        key={param.name}
                        style={param.type === 'boolean' ? { gridColumn: 'span 2' } : {}}
                      >
                        <ParamInput
                          param={param}
                          value={params[param.name]}
                          onChange={(v) =>
                            setParams((prev) => ({ ...prev, [param.name]: v }))
                          }
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

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
                  {runImmediately ? 'Running...' : 'Creating...'}
                </>
              ) : runImmediately ? (
                'Create & Run'
              ) : (
                'Create'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
