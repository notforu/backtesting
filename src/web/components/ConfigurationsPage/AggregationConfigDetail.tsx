/**
 * AggregationConfigDetail — detail panel for the selected aggregation configuration.
 * Uses the existing AggregationStore for selection state.
 */

import { useAggregationStore } from '../../stores/aggregationStore.js';
import { useAggregations } from '../../hooks/useBacktest.js';

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

  if (!selectedAggregation) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <EmptyState />
      </div>
    );
  }

  const agg = aggregations?.find((a) => a.id === selectedAggregation);
  if (!agg) return null;

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
          {agg.subStrategies.map((ss, i) => (
            <div
              key={i}
              style={{
                padding: '10px 14px',
                background: '#252525',
                borderRadius: 6,
                border: '1px solid #333',
              }}
            >
              <div style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 500 }}>{ss.strategyName}</div>
              <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                {ss.symbol} · {ss.timeframe}{ss.exchange ? ` · ${ss.exchange}` : ''}
              </div>
              {ss.params && Object.keys(ss.params).length > 0 && (
                <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                  {Object.entries(ss.params)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
