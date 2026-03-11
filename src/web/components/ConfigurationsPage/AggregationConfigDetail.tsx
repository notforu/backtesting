/**
 * AggregationConfigDetail — detail panel for the selected aggregation configuration.
 * Uses the existing AggregationStore for selection state.
 */

import { useAggregationStore } from '../../stores/aggregationStore.js';
import { useAggregations } from '../../hooks/useBacktest.js';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';

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

  if (!selectedAggregation) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <EmptyState />
      </div>
    );
  }

  const agg = aggregations?.find((a) => a.id === selectedAggregation);
  if (!agg) return null;

  const subStrategyConfigIds = (agg as any).subStrategyConfigIds as string[] | undefined;

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
    </div>
  );
}
