/**
 * ConfigVersionsTab — shows other saved configs with the same strategy+symbol+timeframe.
 */

import { useStrategyConfigVersions } from '../../hooks/useConfigurations.js';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { StrategyConfigEntity } from '../../types.js';

interface ConfigVersionsTabProps {
  config: StrategyConfigEntity;
}

interface ParametersSectionProps {
  params: Record<string, unknown>;
  compact?: boolean;
}

function ParametersSection({ params, compact }: ParametersSectionProps) {
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return <span style={{ color: '#555', fontSize: 12 }}>No parameters</span>;
  }

  if (compact) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 }}>
        {entries.map(([key, value]) => (
          <span key={key} style={{ fontSize: 12, color: '#888' }}>
            <span style={{ color: '#666' }}>{key}:</span>{' '}
            <span style={{ color: '#bbb' }}>{String(value)}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '6px 16px',
        marginTop: 8,
      }}
    >
      {entries.map(([key, value]) => (
        <div key={key}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {key}
          </span>
          <div style={{ fontSize: 14, color: '#e0e0e0', fontWeight: 500 }}>{String(value)}</div>
        </div>
      ))}
    </div>
  );
}

export function ConfigVersionsTab({ config }: ConfigVersionsTabProps) {
  const { data: versions, isLoading } = useStrategyConfigVersions(
    config.strategyName,
    config.symbol,
    config.timeframe,
  );
  const { setSelectedConfigId } = useConfigurationStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <Spinner size="lg" className="text-gray-400" />
      </div>
    );
  }

  const others = versions?.filter((v) => v.id !== config.id) ?? [];

  if (others.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>
        No other parameter versions for {config.strategyName} on {config.symbol} {config.timeframe}.
      </div>
    );
  }

  return (
    <div>
      {others.map((version) => (
        <div
          key={version.id}
          onClick={() => setSelectedConfigId(version.id)}
          style={{
            border: '1px solid #333',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 10,
            cursor: 'pointer',
            background: '#1e1e1e',
            transition: 'border-color 0.1s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = '#4a7aa8')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = '#333')}
        >
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
            Created: {new Date(version.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
          <ParametersSection params={version.params} compact />
        </div>
      ))}
    </div>
  );
}
