/**
 * ConfigRunsTab — shows backtest runs for the selected strategy configuration.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useStrategyConfigRuns } from '../../hooks/useConfigurations.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';
import { useBacktestStore } from '../../stores/backtestStore.js';
import { deleteBacktest } from '../../api/client.js';
import { Spinner } from '../Spinner/Spinner.js';
import type { BacktestSummary } from '../../types.js';

interface ConfigRunsTabProps {
  configId: string;
}

function formatDateRange(startDate?: number, endDate?: number): string {
  if (!startDate || !endDate) return '';
  const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

interface MetricBadgeProps {
  label: string;
  value: string | number | undefined;
  positive?: boolean;
  neutral?: boolean;
}

function MetricBadge({ label, value, positive, neutral }: MetricBadgeProps) {
  const color = neutral || positive === undefined
    ? '#aaa'
    : positive
    ? '#4caf50'
    : '#f44336';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

interface RunCardProps {
  run: BacktestSummary;
  onNavigate: (id: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function RunCard({ run, onNavigate, onDelete, isDeleting }: RunCardProps) {
  const returnPct = run.totalReturnPercent;
  const sharpe = run.sharpeRatio;
  const maxDD = run.maxDrawdownPercent;

  return (
    <div
      style={{
        border: '1px solid #333',
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 10,
        background: '#1e1e1e',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: '#e0e0e0' }}>
            {new Date(run.runAt).toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            {run.exchange && `${run.exchange} · `}
            {formatDateRange(run.startDate, run.endDate)}
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm('Delete this run?')) onDelete(run.id);
          }}
          disabled={isDeleting}
          title="Delete run"
          style={{
            background: 'none',
            border: 'none',
            cursor: isDeleting ? 'not-allowed' : 'pointer',
            color: '#666',
            padding: '2px 4px',
            borderRadius: 4,
            fontSize: 14,
            opacity: isDeleting ? 0.5 : 1,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#f44336')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#666')}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
        <MetricBadge
          label="Return"
          value={returnPct != null ? `${returnPct > 0 ? '+' : ''}${returnPct.toFixed(1)}%` : undefined}
          positive={returnPct != null ? returnPct > 0 : undefined}
        />
        <MetricBadge
          label="Sharpe"
          value={sharpe != null ? sharpe.toFixed(2) : undefined}
          positive={sharpe != null ? sharpe > 0 : undefined}
        />
        <MetricBadge
          label="Max DD"
          value={maxDD != null ? `${maxDD.toFixed(1)}%` : undefined}
          positive={false}
        />
        <MetricBadge
          label="Trades"
          value={run.totalTrades}
          neutral
        />
      </div>

      <button
        onClick={() => onNavigate(run.id)}
        style={{
          marginTop: 10,
          padding: '6px 12px',
          background: '#252525',
          border: '1px solid #444',
          borderRadius: 6,
          color: '#aaa',
          fontSize: 12,
          cursor: 'pointer',
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#2e3a4e';
          (e.currentTarget as HTMLButtonElement).style.color = '#e0e0e0';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#4a7aa8';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = '#252525';
          (e.currentTarget as HTMLButtonElement).style.color = '#aaa';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
        }}
      >
        Open in Backtesting
      </button>
    </div>
  );
}

export function ConfigRunsTab({ configId }: ConfigRunsTabProps) {
  const { data: runs, isLoading } = useStrategyConfigRuns(configId);
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBacktest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-config-runs', configId] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
    },
  });
  const setActivePage = usePaperTradingStore((s) => s.setActivePage);
  const setSelectedBacktestId = useBacktestStore((s) => s.setSelectedBacktestId);

  const handleNavigate = (runId: string) => {
    setSelectedBacktestId(runId);
    setActivePage('backtesting');
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <Spinner size="lg" className="text-gray-400" />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#555', fontSize: 13 }}>
        No backtest runs for this configuration yet.
      </div>
    );
  }

  return (
    <div>
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          onNavigate={handleNavigate}
          onDelete={(id) => deleteMutation.mutate(id)}
          isDeleting={deleteMutation.isPending && deleteMutation.variables === run.id}
        />
      ))}
    </div>
  );
}
