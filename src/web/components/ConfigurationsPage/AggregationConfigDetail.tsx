/**
 * AggregationConfigDetail — detail panel for the selected aggregation configuration.
 * Uses the existing AggregationStore for selection state.
 */

import { useAggregationStore } from '../../stores/aggregationStore.js';
import { useAggregations } from '../../hooks/useBacktest.js';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';
import { useAggregationPaperSessions } from '../../hooks/useConfigurations.js';

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
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
        />
      </svg>
      <p>Select an aggregation configuration to view details</p>
    </div>
  );
}

export function AggregationConfigDetail() {
  const { selectedAggregationId: selectedAggregation } = useAggregationStore();
  const { data: aggregations } = useAggregations();
  const { setSelectedConfigId, setActiveConfigTab } = useConfigurationStore();
  const { setActivePage } = usePaperTradingStore();
  const setSelectedSession = usePaperTradingStore((s) => s.setSelectedSession);
  const { data: paperSessions } = useAggregationPaperSessions(selectedAggregation);

  if (!selectedAggregation) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <EmptyState />
      </div>
    );
  }

  const agg = aggregations?.find((a) => a.id === selectedAggregation);
  if (!agg) return null;

  const subStrategyConfigIds = agg.subStrategyConfigIds;

  const handleSubStrategyClick = (i: number) => {
    const configId = subStrategyConfigIds?.[i];
    if (!configId) return;
    setSelectedConfigId(configId);
    setActiveConfigTab('strategies');
    setActivePage('configurations');
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e0e0e0' }}>{agg.name}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#888' }}>
          {agg.allocationMode.replace(/_/g, ' ')} · {agg.exchange} · {agg.mode}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#555' }}>
          Max positions: {agg.maxPositions} · Initial capital: ${agg.initialCapital.toLocaleString()}
        </p>
      </div>

      <div
        style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '16px 20px',
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
          Sub-Strategies ({agg.subStrategies.length})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agg.subStrategies.map((ss, i) => {
            const hasConfigId = !!subStrategyConfigIds?.[i];
            const paramEntries = ss.params ? Object.entries(ss.params) : [];

            return (
              <div
                key={i}
                onClick={hasConfigId ? () => handleSubStrategyClick(i) : undefined}
                style={{
                  padding: '12px 14px',
                  background: '#252525',
                  borderRadius: 6,
                  border: '1px solid #333',
                  cursor: hasConfigId ? 'pointer' : 'default',
                  transition: 'background 0.15s, border-color 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
                onMouseEnter={(e) => {
                  if (!hasConfigId) return;
                  (e.currentTarget as HTMLDivElement).style.background = '#2e2e2e';
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#444';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = '#252525';
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#333';
                }}
              >
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 500 }}>{ss.strategyName}</div>
                    <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                      {ss.symbol} · {ss.timeframe}{ss.exchange ? ` · ${ss.exchange}` : ''}
                    </div>
                  </div>
                  {hasConfigId && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: '#555',
                        flexShrink: 0,
                      }}
                    >
                      <span>View config</span>
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Params grid */}
                {paramEntries.length > 0 && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '3px 12px',
                      paddingTop: 6,
                      borderTop: '1px solid #2e2e2e',
                    }}
                  >
                    {paramEntries.map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#555' }}>{k}</span>
                        <span style={{ fontSize: 11, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
                          {String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Paper Trading Sessions */}
      {paperSessions && paperSessions.length > 0 && (
        <div style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '16px 20px',
          marginTop: 16,
        }}>
          <h3 style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Paper Trading Sessions ({paperSessions.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {paperSessions.map((session) => {
              const returnPct = session.initialCapital > 0
                ? ((session.currentEquity - session.initialCapital) / session.initialCapital) * 100
                : 0;
              const returnColor = returnPct >= 0 ? '#4caf50' : '#f44336';
              const statusStyles: Record<string, { color: string; bg: string; label: string }> = {
                running: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', label: 'Running' },
                paused: { color: '#facc15', bg: 'rgba(250,204,21,0.12)', label: 'Paused' },
                stopped: { color: '#888', bg: 'rgba(136,136,136,0.12)', label: 'Stopped' },
                error: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Error' },
              };
              const st = statusStyles[session.status] ?? statusStyles.stopped;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    setSelectedSession(session.id);
                    setActivePage('paper-trading');
                  }}
                  style={{
                    padding: '12px 14px',
                    background: '#252525',
                    borderRadius: 6,
                    border: '1px solid #333',
                    cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = '#2e2e2e';
                    (e.currentTarget as HTMLDivElement).style.borderColor = '#444';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = '#252525';
                    (e.currentTarget as HTMLDivElement).style.borderColor = '#333';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 500 }}>{session.name}</div>
                    <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                      Equity: ${session.currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {' · '}
                      <span style={{ color: returnColor }}>{returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{
                      padding: '3px 9px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      color: st.color,
                      background: st.bg,
                    }}>
                      {st.label}
                    </span>
                    <svg width="12" height="12" fill="none" stroke="#555" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
