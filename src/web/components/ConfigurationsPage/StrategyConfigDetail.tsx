/**
 * StrategyConfigDetail — detail panel for the selected strategy configuration.
 */

import { useState } from 'react';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { useStrategyConfig, useDeleteStrategyConfig, useStrategyConfigRuns } from '../../hooks/useConfigurations.js';
import { useRunBacktestModalStore } from '../../stores/runBacktestModalStore.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';
import { ConfigRunsTab } from './ConfigRunsTab.js';
import { ConfigPaperTab } from './ConfigPaperTab.js';
import { ConfigVersionsTab } from './ConfigVersionsTab.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyConfigEntity } from '../../types.js';

// ============================================================================
// ParametersSection
// ============================================================================

interface ParametersSectionProps {
  params: Record<string, unknown>;
}

function ParametersSection({ params }: ParametersSectionProps) {
  const entries = Object.entries(params);

  if (entries.length === 0) {
    return (
      <p style={{ fontSize: 13, color: '#555', fontStyle: 'italic' }}>No parameters defined.</p>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '10px 20px',
      }}
    >
      {entries.map(([key, value]) => (
        <div key={key}>
          <div
            style={{
              fontSize: 11,
              color: '#666',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 3,
            }}
          >
            {key}
          </div>
          <div style={{ fontSize: 15, color: '#e0e0e0', fontWeight: 500 }}>{String(value)}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// SubTab bar
// ============================================================================

type DetailTab = 'runs' | 'paper' | 'versions';

interface SubTabBarProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}

function SubTabBar({ active, onChange }: SubTabBarProps) {
  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'runs', label: 'Runs' },
    { id: 'paper', label: 'Trading' },
    { id: 'versions', label: 'Versions' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid #333',
        paddingBottom: 0,
        marginBottom: 16,
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '8px 14px',
            background: 'none',
            border: 'none',
            borderBottom: active === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
            color: active === tab.id ? '#e0e0e0' : '#666',
            fontSize: 13,
            fontWeight: active === tab.id ? 600 : 400,
            cursor: 'pointer',
            transition: 'color 0.1s',
            marginBottom: -1,
          }}
          onMouseEnter={(e) => {
            if (active !== tab.id)
              (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
          }}
          onMouseLeave={(e) => {
            if (active !== tab.id)
              (e.currentTarget as HTMLButtonElement).style.color = '#666';
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// EmptyState
// ============================================================================

function EmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#444',
        fontSize: 14,
        gap: 8,
      }}
    >
      <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" opacity={0.4}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
        />
      </svg>
      <p>Select a configuration to view details</p>
    </div>
  );
}

// ============================================================================
// Detail content for a loaded config
// ============================================================================

interface DetailContentProps {
  config: StrategyConfigEntity;
}

function DetailContent({ config }: DetailContentProps) {
  const { activeDetailTab, setActiveDetailTab, setSelectedConfigId } = useConfigurationStore();
  const deleteMutation = useDeleteStrategyConfig();
  const setActivePage = usePaperTradingStore((s) => s.setActivePage);
  const openRunBacktestModal = useRunBacktestModalStore((s) => s.open);
  const { data: runs } = useStrategyConfigRuns(config.id);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleRunBacktest = () => {
    openRunBacktestModal({
      strategyName: config.strategyName,
      symbol: config.symbol,
      timeframe: config.timeframe,
      params: config.params,
    });
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    await deleteMutation.mutateAsync(config.id);
    setShowDeleteConfirm(false);
    setSelectedConfigId(null);
  };

  const handleStartPaperTrading = () => {
    setActivePage('paper-trading');
  };

  return (
    <div style={{ padding: '24px 28px', flex: 1, overflowY: 'auto' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e0e0e0' }}>
            {config.strategyName}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>
            {config.symbol} · {config.timeframe}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#555' }}>
            Created: {new Date(config.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleRunBacktest}
            style={{
              padding: '7px 14px',
              background: 'none',
              border: '1px solid #1e3a5f',
              borderRadius: 6,
              color: '#60a5fa',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.12)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            Run Backtest
          </button>

          <button
            onClick={handleStartPaperTrading}
            style={{
              padding: '7px 14px',
              background: 'none',
              border: '1px solid #1a4d2e',
              borderRadius: 6,
              color: '#4ade80',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(74,222,128,0.10)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            Start Trading
          </button>

          <button
            onClick={handleDeleteClick}
            disabled={deleteMutation.isPending}
            style={{
              padding: '7px 14px',
              background: 'none',
              border: '1px solid #7f1d1d',
              borderRadius: 6,
              color: '#f87171',
              fontSize: 13,
              cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: deleteMutation.isPending ? 0.6 : 1,
              transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.12)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Config'}
          </button>
        </div>

        {/* Delete confirmation overlay */}
        {showDeleteConfirm && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowDeleteConfirm(false)}
          >
            <div
              style={{
                background: '#1e1e1e',
                border: '1px solid #3a3a3a',
                borderRadius: 10,
                padding: '28px 32px',
                maxWidth: 420,
                width: '90%',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <svg width="24" height="24" fill="none" stroke="#f87171" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#e0e0e0' }}>
                  Delete Configuration?
                </h3>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#aaa' }}>
                This will permanently delete:
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#e0e0e0', fontWeight: 500 }}>
                {config.strategyName} / {config.symbol} / {config.timeframe}
              </p>
              <ul style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: 13, color: '#aaa', lineHeight: 1.7 }}>
                <li>{runs?.length ?? 0} backtest run{(runs?.length ?? 0) !== 1 ? 's' : ''}</li>
                <li>All associated trading links will be removed</li>
              </ul>
              <p style={{ margin: '0 0 20px', fontSize: 12, color: '#666', fontStyle: 'italic' }}>
                This action cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    padding: '8px 18px',
                    background: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: 6,
                    color: '#ccc',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleteMutation.isPending}
                  style={{
                    padding: '8px 18px',
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid #7f1d1d',
                    borderRadius: 6,
                    color: '#f87171',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer',
                    opacity: deleteMutation.isPending ? 0.6 : 1,
                  }}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Parameters section */}
      <div
        style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 20,
        }}
      >
        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Parameters
        </h3>
        <ParametersSection params={config.params} />
      </div>

      {/* Sub-tabs */}
      <SubTabBar active={activeDetailTab} onChange={setActiveDetailTab} />

      {activeDetailTab === 'runs' && <ConfigRunsTab configId={config.id} />}
      {activeDetailTab === 'paper' && <ConfigPaperTab configId={config.id} />}
      {activeDetailTab === 'versions' && <ConfigVersionsTab config={config} />}
    </div>
  );
}

// ============================================================================
// StrategyConfigDetail
// ============================================================================

export function StrategyConfigDetail() {
  const { selectedConfigId } = useConfigurationStore();
  const { data: config, isLoading } = useStrategyConfig(selectedConfigId);

  if (!selectedConfigId) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        <EmptyState />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spinner size="lg" className="text-gray-400" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <DetailContent config={config} />
    </div>
  );
}
