/**
 * StrategyConfigSidebar — sidebar listing all strategy configurations with search.
 */

import { useConfigurationStore } from '../../stores/configurationStore.js';
import { useStrategyConfigs } from '../../hooks/useConfigurations.js';
import { ConfigCard } from './ConfigCard.js';
import { Spinner } from '../Spinner/Spinner.js';

export function StrategyConfigSidebar() {
  const {
    searchQuery,
    setSearchQuery,
    selectedConfigId,
    setSelectedConfigId,
  } = useConfigurationStore();

  const { data: configs, isLoading, error } = useStrategyConfigs();

  const filtered = configs?.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.strategyName.toLowerCase().includes(q) ||
      c.symbol.toLowerCase().includes(q) ||
      c.timeframe.toLowerCase().includes(q)
    );
  });

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
      {/* Search */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #2a2a2a' }}>
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
