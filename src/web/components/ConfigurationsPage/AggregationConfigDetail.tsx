/**
 * AggregationConfigDetail — detail panel for the selected aggregation configuration.
 * Uses the existing AggregationStore for selection state.
 */

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useAggregationStore } from '../../stores/aggregationStore.js';
import { useAggregations } from '../../hooks/useBacktest.js';
import { useConfigurationStore } from '../../stores/configurationStore.js';
import { usePaperTradingStore } from '../../stores/paperTradingStore.js';
import { useAggregationPaperSessions, useStrategyConfigBestRuns, useAggregationRuns } from '../../hooks/useConfigurations.js';
import { useBacktestStore } from '../../stores/backtestStore.js';
import { deleteBacktest } from '../../api/client.js';
import type { BacktestSummary } from '../../types.js';

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

function formatDateRange(startDate?: number | null, endDate?: number | null): string {
  if (!startDate || !endDate) return '';
  const fmt = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

interface AggRunCardProps {
  run: BacktestSummary;
  onNavigate: (id: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

function AggRunCard({ run, onNavigate, onDelete, isDeleting }: AggRunCardProps) {
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
        background: '#252525',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: '#e0e0e0' }}>
            {new Date(run.runAt).toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
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

      <div style={{ display: 'flex', gap: 20, marginTop: 4, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Return</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: returnPct != null ? (returnPct > 0 ? '#4caf50' : '#f44336') : '#aaa' }}>
            {returnPct != null ? `${returnPct > 0 ? '+' : ''}${returnPct.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sharpe</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: sharpe != null ? (sharpe > 0 ? '#4caf50' : '#f44336') : '#aaa' }}>
            {sharpe != null ? sharpe.toFixed(2) : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max DD</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f44336' }}>
            {maxDD != null ? `${maxDD.toFixed(1)}%` : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trades</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#aaa' }}>
            {run.totalTrades ?? '—'}
          </span>
        </div>
      </div>

      <button
        onClick={() => onNavigate(run.id)}
        style={{
          marginTop: 10,
          padding: '6px 12px',
          background: '#1e1e1e',
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
          (e.currentTarget as HTMLButtonElement).style.background = '#1e1e1e';
          (e.currentTarget as HTMLButtonElement).style.color = '#aaa';
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
        }}
      >
        Open in Backtesting
      </button>
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
  const { data: aggRuns } = useAggregationRuns(selectedAggregation);
  const setSelectedBacktestId = useBacktestStore((s) => s.setSelectedBacktestId);
  const queryClient = useQueryClient();
  const deleteRunMutation = useMutation({
    mutationFn: (id: string) => deleteBacktest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aggregation-runs', selectedAggregation] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });
  const agg = aggregations?.find((a) => a.id === selectedAggregation);
  const subStrategyConfigIds = agg?.subStrategyConfigIds;
  const { data: bestRuns } = useStrategyConfigBestRuns(subStrategyConfigIds ?? undefined);

  if (!selectedAggregation) {
    return (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <EmptyState />
      </div>
    );
  }

  if (!agg) return null;

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

      {/* Paper Trading Sessions */}
      {paperSessions && paperSessions.length > 0 && (
        <div style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 16,
        }}>
          <h3 style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Trading Sessions ({paperSessions.length})
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

      {/* Backtest Runs */}
      {aggRuns && aggRuns.length > 0 && (
        <div style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 16,
        }}>
          <h3 style={{
            margin: '0 0 12px',
            fontSize: 12,
            fontWeight: 600,
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Backtest Runs ({aggRuns.length})
          </h3>
          {aggRuns.map((run) => (
            <AggRunCard
              key={run.id}
              run={run}
              onNavigate={(id) => {
                setSelectedBacktestId(id);
                setActivePage('backtesting');
              }}
              onDelete={(id) => deleteRunMutation.mutate(id)}
              isDeleting={deleteRunMutation.isPending && deleteRunMutation.variables === run.id}
            />
          ))}
        </div>
      )}

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
            const configId = subStrategyConfigIds?.[i];
            const bestRun = configId && bestRuns ? bestRuns[configId] : null;

            const sharpeColor = bestRun ? (bestRun.sharpeRatio >= 1 ? '#4ade80' : bestRun.sharpeRatio >= 0 ? '#facc15' : '#f87171') : '#888';
            const returnColor = bestRun ? (bestRun.totalReturnPercent >= 0 ? '#4caf50' : '#f44336') : '#888';
            const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

            return (
              <div
                key={i}
                onClick={hasConfigId ? () => handleSubStrategyClick(i) : undefined}
                style={{
                  padding: '8px 12px',
                  background: '#252525',
                  borderRadius: 6,
                  border: '1px solid #333',
                  cursor: hasConfigId ? 'pointer' : 'default',
                  transition: 'background 0.15s, border-color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
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
                {/* Name + symbol */}
                <div style={{ minWidth: 0, flex: '0 0 auto', maxWidth: 200 }}>
                  <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ss.strategyName}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>
                    {ss.symbol} · {ss.timeframe}
                  </div>
                </div>

                {/* Best run stats — inline */}
                {bestRun ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: sharpeColor, fontWeight: 600 }} title="Sharpe">{bestRun.sharpeRatio.toFixed(2)}</span>
                    <span style={{ color: returnColor, fontWeight: 600 }} title="Return">{bestRun.totalReturnPercent >= 0 ? '+' : ''}{bestRun.totalReturnPercent.toFixed(1)}%</span>
                    <span style={{ color: '#999' }} title="Max Drawdown">DD {bestRun.maxDrawdownPercent.toFixed(1)}%</span>
                    <span style={{ color: '#999' }} title="Win Rate">WR {bestRun.winRate.toFixed(0)}%</span>
                    <span style={{ color: '#999' }} title="Trades">{bestRun.totalTrades}t</span>
                    {bestRun.startDate && bestRun.endDate && (
                      <span style={{ color: '#666' }} title="Period">{fmtDate(bestRun.startDate)}–{fmtDate(bestRun.endDate)}</span>
                    )}
                    <span style={{ color: '#555' }}>({bestRun.totalRuns})</span>
                  </div>
                ) : (
                  <div style={{ flex: 1, fontSize: 11, color: '#555' }}>No runs</div>
                )}

                {/* Arrow */}
                {hasConfigId && (
                  <svg width="12" height="12" fill="none" stroke="#555" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
