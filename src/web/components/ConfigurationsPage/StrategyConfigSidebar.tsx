/**
 * StrategyConfigSidebar — sidebar listing all strategy configurations with search.
 */

import { useState, useEffect } from 'react';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { useStrategyConfigs, useCreateStrategyConfig } from '../../hooks/useConfigurations.js';
import { useStrategies, useStrategy } from '../../hooks/useBacktest.js';
import { ConfigCard } from './ConfigCard.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyParam } from '../../types.js';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

// ============================================================================
// Inline create form
// ============================================================================

interface CreateConfigFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function CreateConfigForm({ onSuccess, onCancel }: CreateConfigFormProps) {
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();

  const [strategyName, setStrategyName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('1h');
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load strategy details when a strategy is selected
  const { data: strategyDetails, isLoading: strategyLoading } = useStrategy(strategyName);

  // When strategy details load, populate default params
  useEffect(() => {
    if (strategyDetails?.params) {
      const defaults: Record<string, unknown> = {};
      for (const p of strategyDetails.params) {
        defaults[p.name] = p.default;
      }
      setParamValues(defaults);
    } else {
      setParamValues({});
    }
  }, [strategyDetails]);

  const createMutation = useCreateStrategyConfig();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!strategyName) {
      setSubmitError('Please select a strategy.');
      return;
    }
    if (!symbol.trim()) {
      setSubmitError('Please enter a symbol.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        strategyName,
        symbol: symbol.trim().toUpperCase(),
        timeframe,
        params: paramValues,
      });
      onSuccess();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create configuration.');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: '#1a1a1a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#e0e0e0',
    fontSize: 12,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: '#888',
    marginBottom: 3,
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: 8,
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: '10px 12px', borderBottom: '1px solid #2a2a2a' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#bbb', marginBottom: 10 }}>
        New Configuration
      </div>

      {/* Strategy */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Strategy</label>
        {strategiesLoading ? (
          <div style={{ color: '#666', fontSize: 12 }}>Loading strategies...</div>
        ) : (
          <select
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            style={inputStyle}
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

      {/* Symbol */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="e.g. BTC/USDT"
          style={inputStyle}
        />
      </div>

      {/* Timeframe */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Timeframe</label>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          style={inputStyle}
        >
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      {/* Strategy params */}
      {strategyLoading && strategyName && (
        <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>Loading params...</div>
      )}

      {strategyDetails?.params && strategyDetails.params.length > 0 && (
        <div
          style={{
            borderTop: '1px solid #2a2a2a',
            paddingTop: 8,
            marginTop: 4,
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>Strategy Parameters</div>
          {strategyDetails.params.map((param: StrategyParam) => (
            <div key={param.name} style={fieldStyle}>
              <label style={labelStyle} title={param.description}>
                {param.label}
              </label>
              {param.type === 'boolean' ? (
                <select
                  value={String(paramValues[param.name] ?? param.default)}
                  onChange={(e) =>
                    setParamValues((prev) => ({
                      ...prev,
                      [param.name]: e.target.value === 'true',
                    }))
                  }
                  style={inputStyle}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : param.type === 'select' && param.options ? (
                <select
                  value={String(paramValues[param.name] ?? param.default)}
                  onChange={(e) =>
                    setParamValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                  }
                  style={inputStyle}
                >
                  {param.options.map((opt) => {
                    const value = typeof opt === 'object' ? opt.value : opt;
                    const label = typeof opt === 'object' ? opt.label : opt;
                    return (
                      <option key={String(value)} value={String(value)}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  type={param.type === 'number' ? 'number' : 'text'}
                  value={String(paramValues[param.name] ?? param.default)}
                  onChange={(e) =>
                    setParamValues((prev) => ({
                      ...prev,
                      [param.name]:
                        param.type === 'number' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  style={inputStyle}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {submitError && (
        <div
          style={{
            marginBottom: 8,
            padding: '6px 8px',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid #7f1d1d',
            borderRadius: 4,
            color: '#fca5a5',
            fontSize: 11,
          }}
        >
          {submitError}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="submit"
          disabled={createMutation.isPending}
          style={{
            flex: 1,
            padding: '6px 0',
            background: '#1e3a5f',
            border: '1px solid #2563eb',
            borderRadius: 4,
            color: '#e0e0e0',
            fontSize: 12,
            fontWeight: 600,
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
            opacity: createMutation.isPending ? 0.6 : 1,
          }}
        >
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={createMutation.isPending}
          style={{
            flex: 1,
            padding: '6px 0',
            background: 'none',
            border: '1px solid #444',
            borderRadius: 4,
            color: '#999',
            fontSize: 12,
            cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Sidebar
// ============================================================================

export function StrategyConfigSidebar() {
  const {
    searchQuery,
    setSearchQuery,
    selectedConfigId,
    setSelectedConfigId,
  } = useConfigurationStore();

  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: configs, isLoading, error } = useStrategyConfigs();

  const filtered = configs?.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.strategyName.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q) ||
      c.timeframe.toLowerCase().includes(q)
    );
  });

  const handleCreateSuccess = () => {
    setShowCreateForm(false);
  };

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* New Configuration button */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          style={{
            width: '100%',
            padding: '7px 10px',
            background: showCreateForm ? '#1a1a1a' : '#1e3a5f',
            border: '1px solid',
            borderColor: showCreateForm ? '#444' : '#2563eb',
            borderRadius: 6,
            color: showCreateForm ? '#888' : '#e0e0e0',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.1s',
          }}
        >
          {showCreateForm ? 'Cancel' : '+ New Configuration'}
        </button>
      </div>

      {/* Inline create form */}
      {showCreateForm && (
        <div style={{ flexShrink: 0, overflowY: 'auto', maxHeight: '60%' }}>
          <CreateConfigForm
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="Search strategies, symbols..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 10px',
            background: '#252525',
            border: '1px solid #444',
            borderRadius: 6,
            color: '#e0e0e0',
            fontSize: 13,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <Spinner size="lg" className="text-gray-400" />
          </div>
        )}

        {error && (
          <div
            style={{
              margin: 12,
              padding: '10px 12px',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid #7f1d1d',
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            Failed to load configurations
          </div>
        )}

        {!isLoading && filtered && filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
            {searchQuery ? 'No configs match your search.' : 'No strategy configurations yet.'}
          </div>
        )}

        {filtered && filtered.length > 0 && filtered.map((config) => (
          <ConfigCard
            key={config.id}
            config={config}
            isSelected={config.id === selectedConfigId}
            onClick={() =>
              setSelectedConfigId(config.id === selectedConfigId ? null : config.id)
            }
          />
        ))}
      </div>

      {/* Footer stats */}
      {filtered && filtered.length > 0 && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid #2a2a2a',
            fontSize: 12,
            color: '#666',
          }}
        >
          {filtered.length} configuration{filtered.length !== 1 ? 's' : ''}
          {searchQuery && configs && ` (${configs.length} total)`}
        </div>
      )}
    </aside>
  );
}
