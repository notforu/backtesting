/**
 * AggregationConfigSidebar — placeholder sidebar for aggregation configurations.
 * Will be expanded in a future task.
 */

import { useAggregations } from '../../hooks/useBacktest.js';
import { useAggregationStore } from '../../stores/aggregationStore.js';
import { Spinner } from '../Spinner/Spinner.js';

export function AggregationConfigSidebar() {
  const { data: aggregations, isLoading, error } = useAggregations();
  const { selectedAggregationId: selectedAggregation, setSelectedAggregation } = useAggregationStore();

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
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #2a2a2a',
          fontSize: 12,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        Aggregation Configs
      </div>

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
            Failed to load aggregations
          </div>
        )}

        {!isLoading && aggregations && aggregations.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#555', fontSize: 13 }}>
            No aggregation configurations yet.
          </div>
        )}

        {aggregations && aggregations.map((agg) => {
          const isSelected = agg.id === selectedAggregation;
          return (
            <div
              key={agg.id}
              onClick={() => setSelectedAggregation(isSelected ? null : agg.id)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #2a2a2a',
                backgroundColor: isSelected ? '#1e3a5f' : 'transparent',
                transition: 'background-color 0.1s',
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = '#1f2a38';
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
              }}
            >
              <div style={{ fontWeight: 600, color: '#e0e0e0', fontSize: 14 }}>{agg.name}</div>
              <div style={{ fontSize: 12, color: '#777', marginTop: 3 }}>
                {agg.subStrategies.length} strategies · {agg.allocationMode.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {agg.exchange} · {agg.mode}
              </div>
            </div>
          );
        })}
      </div>

      {aggregations && aggregations.length > 0 && (
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid #2a2a2a',
            fontSize: 12,
            color: '#666',
          }}
        >
          {aggregations.length} aggregation{aggregations.length !== 1 ? 's' : ''}
        </div>
      )}
    </aside>
  );
}
