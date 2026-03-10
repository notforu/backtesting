/**
 * ConfigCard — sidebar card for a single strategy configuration.
 */

import type { StrategyConfigListItem } from '../../types.js';

interface ConfigCardProps {
  config: StrategyConfigListItem;
  isSelected: boolean;
  onClick: () => void;
}

export function ConfigCard({ config, isSelected, onClick }: ConfigCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid #2a2a2a',
        backgroundColor: isSelected ? '#1e3a5f' : 'transparent',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#1f2a38';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
      }}
    >
      <div style={{ fontWeight: 600, color: '#e0e0e0', fontSize: 14 }}>{config.strategyName}</div>
      <div style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
        {config.symbol} · {config.timeframe}
      </div>
      <div style={{ fontSize: 12, color: '#777', marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span>{config.runCount} {config.runCount === 1 ? 'run' : 'runs'}</span>
        {config.latestRunSharpe != null && (
          <span style={{ color: config.latestRunSharpe > 0 ? '#4caf50' : '#f44336' }}>
            Sharpe {config.latestRunSharpe.toFixed(2)}
          </span>
        )}
        {config.latestRunReturn != null && (
          <span style={{ color: config.latestRunReturn > 0 ? '#4caf50' : '#f44336' }}>
            {config.latestRunReturn > 0 ? '+' : ''}{config.latestRunReturn.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
