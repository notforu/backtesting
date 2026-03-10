/**
 * ConfigurationsPage — main page with Strategies and Aggregations tabs.
 * Layout: tab bar at top, sidebar (config list) + detail panel below.
 */

import { useConfigurationStore } from '../../stores/configurationStore.js';
import { StrategyConfigSidebar } from './StrategyConfigSidebar.js';
import { StrategyConfigDetail } from './StrategyConfigDetail.js';
import { AggregationConfigSidebar } from './AggregationConfigSidebar.js';
import { AggregationConfigDetail } from './AggregationConfigDetail.js';

type ConfigTab = 'strategies' | 'aggregations';

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? '#e0e0e0' : '#666',
        background: active ? '#1e3a5f' : 'none',
        border: '1px solid',
        borderColor: active ? '#2563eb' : '#333',
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.color = '#666';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
        }
      }}
    >
      {children}
    </button>
  );
}

export function ConfigurationsPage() {
  const { activeConfigTab, setActiveConfigTab } = useConfigurationStore();

  const handleTabChange = (tab: ConfigTab) => {
    setActiveConfigTab(tab);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 16px',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <TabButton
          active={activeConfigTab === 'strategies'}
          onClick={() => handleTabChange('strategies')}
        >
          Strategies
        </TabButton>
        <TabButton
          active={activeConfigTab === 'aggregations'}
          onClick={() => handleTabChange('aggregations')}
        >
          Aggregations
        </TabButton>
      </div>

      {/* Content: sidebar + detail panel */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {activeConfigTab === 'strategies' ? (
          <>
            <StrategyConfigSidebar />
            <StrategyConfigDetail />
          </>
        ) : (
          <>
            <AggregationConfigSidebar />
            <AggregationConfigDetail />
          </>
        )}
      </div>
    </div>
  );
}
