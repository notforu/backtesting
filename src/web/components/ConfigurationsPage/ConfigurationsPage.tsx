/**
 * ConfigurationsPage — main page with Strategies and Aggregations tabs.
 * Layout: tab bar at top, sidebar (config list) + detail panel below.
 *
 * Mobile (<md): master-detail pattern — show sidebar OR detail, never both.
 * Desktop (>=md): side-by-side layout unchanged.
 */

import { useEffect, useState } from 'react';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { useAggregationStore } from '../../stores/aggregationStore.js';
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
      className={[
        'px-3.5 py-1.5 text-[13px] rounded-md border transition-colors duration-100 whitespace-nowrap',
        active
          ? 'font-semibold text-gray-200 bg-blue-950 border-blue-600'
          : 'font-normal text-gray-500 bg-transparent border-gray-700 hover:text-gray-300 hover:border-gray-500',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function ConfigurationsPage() {
  const { activeConfigTab, setActiveConfigTab, selectedConfigId } = useConfigurationStore();
  const { selectedAggregationId } = useAggregationStore();

  // Mobile master-detail: true = show sidebar list, false = show detail panel
  const [showSidebar, setShowSidebar] = useState(true);

  // When a strategy config is selected, navigate to detail on mobile
  useEffect(() => {
    if (selectedConfigId !== null) {
      setShowSidebar(false);
    }
  }, [selectedConfigId]);

  // When an aggregation is selected, navigate to detail on mobile
  useEffect(() => {
    if (selectedAggregationId !== null) {
      setShowSidebar(false);
    }
  }, [selectedAggregationId]);

  // When tab changes, go back to sidebar on mobile so user sees the list
  const handleTabChange = (tab: ConfigTab) => {
    setActiveConfigTab(tab);
    setShowSidebar(true);
  };

  const handleBackToList = () => {
    setShowSidebar(true);
  };

  // Determine the back button label based on the active tab
  const backLabel = activeConfigTab === 'strategies' ? 'Strategies' : 'Aggregations';

  // Render the correct sidebar / detail based on the active tab
  const sidebar =
    activeConfigTab === 'strategies' ? <StrategyConfigSidebar /> : <AggregationConfigSidebar />;

  const detail =
    activeConfigTab === 'strategies' ? <StrategyConfigDetail /> : <AggregationConfigDetail />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-700 shrink-0 overflow-x-auto">
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

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile: show sidebar OR detail (master-detail pattern) */}
        <div className="flex md:hidden flex-1 flex-col overflow-hidden">
          {showSidebar ? (
            /* Mobile: sidebar list (full width) */
            <div className="flex-1 overflow-y-auto">
              {sidebar}
            </div>
          ) : (
            /* Mobile: detail panel with back button */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
                <button
                  onClick={handleBackToList}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  {backLabel}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col">
                {detail}
              </div>
            </div>
          )}
        </div>

        {/* Desktop: sidebar + detail side by side */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          {/* Sidebar — fixed width */}
          <div className="flex-shrink-0 overflow-hidden flex flex-col">
            {sidebar}
          </div>
          {/* Detail — takes remaining space */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {detail}
          </div>
        </div>
      </div>
    </div>
  );
}
