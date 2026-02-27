/**
 * Paper Trading Panel component.
 * Shows session list, session detail (metrics, positions, equity chart, trades),
 * and session lifecycle controls.
 */

import { useState, useEffect } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import {
  usePaperSessions,
  usePaperSession,
  usePaperTrades,
  usePaperEquity,
  useDeletePaperSession,
  usePaperSessionControl,
  usePaperSessionSSE,
} from '../../hooks/usePaperTrading';
import { CreatePaperSessionModal } from './CreatePaperSessionModal';
import { PaperEquityChart } from './PaperEquityChart';
import type { PaperSession, PaperTrade } from '../../types';

// ============================================================================
// Config display name helper
// ============================================================================

export function configDisplayName(session: Pick<PaperSession, 'aggregationConfig' | 'aggregationConfigId'>): string {
  const subs = session.aggregationConfig?.subStrategies;
  if (subs && subs.length > 0) {
    if (subs.length === 1) {
      const s = subs[0];
      const sym = s.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
      return `${s.strategyName} on ${sym} ${s.timeframe}`;
    }
    const mode = session.aggregationConfig?.allocationMode ?? 'multi';
    return `${subs.length} strategies (${mode})`;
  }
  return session.aggregationConfigId ?? 'Manual config';
}

// ============================================================================
// Status Badge
// ============================================================================

export function StatusBadge({ status }: { status: PaperSession['status'] }) {
  const configs: Record<
    PaperSession['status'],
    { dotClass: string; label: string; textClass: string }
  > = {
    running: {
      dotClass: 'bg-green-500 animate-pulse',
      label: 'Running',
      textClass: 'text-green-400',
    },
    paused: {
      dotClass: 'bg-yellow-500',
      label: 'Paused',
      textClass: 'text-yellow-400',
    },
    stopped: {
      dotClass: 'bg-gray-500',
      label: 'Stopped',
      textClass: 'text-gray-400',
    },
    error: {
      dotClass: 'bg-red-500',
      label: 'Error',
      textClass: 'text-red-400',
    },
  };

  const cfg = configs[status];
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
}

// ============================================================================
// Return percentage helper
// ============================================================================

export function returnPercent(currentEquity: number, initialCapital: number): number {
  if (initialCapital === 0) return 0;
  return ((currentEquity - initialCapital) / initialCapital) * 100;
}

// ============================================================================
// Format helpers
// ============================================================================

export function fmtUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

export function fmtDuration(ms: number): string {
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ============================================================================
// Next tick countdown
// ============================================================================

export function NextTickCountdown({ nextTickAt }: { nextTickAt: number | null }) {
  const [remaining, setRemaining] = useState<string>('');

  useEffect(() => {
    if (!nextTickAt) {
      setRemaining('—');
      return;
    }

    const update = () => {
      const ms = nextTickAt - Date.now();
      if (ms <= 0) {
        setRemaining('any moment...');
      } else {
        setRemaining(fmtDuration(ms));
      }
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [nextTickAt]);

  return <span className="text-gray-300">{remaining}</span>;
}

// ============================================================================
// Session card (in the list)
// ============================================================================

export interface SessionCardProps {
  session: PaperSession;
  isSelected: boolean;
  onSelect: () => void;
}

export function SessionCard({ session, isSelected, onSelect }: SessionCardProps) {
  const ret = returnPercent(session.currentEquity, session.initialCapital);
  const isPositive = ret >= 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
        isSelected
          ? 'border-primary-500 bg-primary-900/20'
          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{session.name}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {configDisplayName(session)}
          </p>
        </div>
        <StatusBadge status={session.status} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm text-gray-300">{fmtUsd(session.currentEquity)}</span>
        <span className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {fmtPct(ret)}
        </span>
      </div>
    </button>
  );
}

// ============================================================================
// Trades table row
// ============================================================================

function TradeRow({ trade }: { trade: PaperTrade }) {
  const isOpen = trade.action === 'open_long' || trade.action === 'open_short';
  const actionLabel =
    trade.action === 'open_long'
      ? 'Open Long'
      : trade.action === 'open_short'
        ? 'Open Short'
        : trade.action === 'close_long'
          ? 'Close Long'
          : 'Close Short';

  return (
    <tr className="border-t border-gray-700/50">
      <td className="py-1.5 px-2 text-xs text-gray-400">
        {new Date(trade.timestamp).toLocaleTimeString()}
      </td>
      <td className="py-1.5 px-2 text-xs text-gray-300">{trade.symbol}</td>
      <td className="py-1.5 px-2">
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${
            isOpen ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}
        >
          {actionLabel}
        </span>
      </td>
      <td className="py-1.5 px-2 text-xs text-gray-300 text-right">
        {fmtUsd(trade.price)}
      </td>
      <td className="py-1.5 px-2 text-xs text-gray-300 text-right">
        {trade.amount.toFixed(4)}
      </td>
      <td className="py-1.5 px-2 text-xs text-right">
        {trade.pnl !== null ? (
          <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
            {fmtUsd(trade.pnl)}
          </span>
        ) : (
          <span className="text-gray-500">—</span>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// Session Detail Panel
// ============================================================================

function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading } = usePaperSession(sessionId);
  const { data: tradesData } = usePaperTrades(sessionId, 20);
  const { data: equitySnapshots } = usePaperEquity(sessionId);
  const deleteMutation = useDeletePaperSession();
  const controls = usePaperSessionControl(sessionId);

  // Subscribe to live SSE updates for this session
  usePaperSessionSSE(sessionId);

  const { setSelectedSession } = usePaperTradingStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  if (!session) return null;

  const ret = returnPercent(session.currentEquity, session.initialCapital);
  const isPositive = ret >= 0;
  const status = session.status;
  const isPending =
    controls.start.isPending ||
    controls.pause.isPending ||
    controls.resume.isPending ||
    controls.stop.isPending;

  const handleDelete = async () => {
    if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(sessionId);
    setSelectedSession(null);
  };

  return (
    <div className="space-y-4">
      {/* Session header with controls */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{session.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {configDisplayName(session)}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Control buttons */}
      <div className="flex flex-wrap gap-2">
        {status === 'stopped' || status === 'error' ? (
          <button
            onClick={() => controls.start.mutate()}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Start
          </button>
        ) : null}
        {status === 'running' ? (
          <button
            onClick={() => controls.pause.mutate()}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Pause
          </button>
        ) : null}
        {status === 'paused' ? (
          <button
            onClick={() => controls.resume.mutate()}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Resume
          </button>
        ) : null}
        {status === 'running' || status === 'paused' ? (
          <button
            onClick={() => controls.stop.mutate()}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            Stop
          </button>
        ) : null}
        {/* Force tick (dev only) */}
        {status === 'running' && (
          <button
            onClick={() => controls.tick.mutate()}
            disabled={controls.tick.isPending}
            className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-gray-300 font-medium transition-colors"
            title="Force tick (dev)"
          >
            Tick
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="ml-auto px-3 py-1.5 text-xs rounded border border-red-800 hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 font-medium transition-colors"
        >
          Delete
        </button>
      </div>

      {/* Error banner */}
      {session.errorMessage && (
        <div className="bg-red-900/40 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
          {session.errorMessage}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Equity</p>
          <p className="text-sm font-semibold text-white mt-0.5">{fmtUsd(session.currentEquity)}</p>
        </div>
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Return</p>
          <p className={`text-sm font-semibold mt-0.5 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {fmtPct(ret)}
          </p>
        </div>
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Cash</p>
          <p className="text-sm font-semibold text-white mt-0.5">{fmtUsd(session.currentCash)}</p>
        </div>
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Positions Value</p>
          <p className="text-sm font-semibold text-white mt-0.5">
            {fmtUsd(session.currentEquity - session.currentCash)}
          </p>
        </div>
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Ticks</p>
          <p className="text-sm font-semibold text-white mt-0.5">{session.tickCount.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900/50 rounded px-3 py-2 border border-gray-700">
          <p className="text-xs text-gray-500">Next Tick</p>
          <p className="text-sm font-semibold mt-0.5">
            <NextTickCountdown nextTickAt={session.nextTickAt} />
          </p>
        </div>
      </div>

      {/* Last tick */}
      <p className="text-xs text-gray-500">
        Last tick: <span className="text-gray-400">{fmtDate(session.lastTickAt)}</span>
      </p>

      {/* Open positions */}
      <div>
        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Open Positions ({session.positions?.length ?? 0})
        </h4>
        {session.positions && session.positions.length > 0 ? (
          <div className="space-y-1.5">
            {session.positions.map((pos) => (
              <div
                key={pos.id}
                className="bg-gray-900/50 border border-gray-700 rounded px-3 py-2 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      pos.direction === 'long'
                        ? 'bg-green-900/50 text-green-400'
                        : 'bg-red-900/50 text-red-400'
                    }`}
                  >
                    {pos.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                  <span className="text-xs text-white font-medium truncate">{pos.symbol}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">
                    Entry: {fmtUsd(pos.entryPrice)}
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    PnL: {fmtUsd(pos.unrealizedPnl)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic">No open positions</p>
        )}
      </div>

      {/* Equity chart */}
      <div>
        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Equity Curve
        </h4>
        <PaperEquityChart snapshots={equitySnapshots ?? []} height={220} />
      </div>

      {/* Recent trades */}
      <div>
        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Recent Trades ({tradesData?.total ?? 0} total)
        </h4>
        {tradesData && tradesData.trades.length > 0 ? (
          <div className="overflow-x-auto rounded border border-gray-700">
            <table className="w-full text-left min-w-[420px]">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500">Time</th>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500">Symbol</th>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500">Action</th>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500 text-right">Price</th>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500 text-right">Amount</th>
                  <th className="py-1.5 px-2 text-xs font-medium text-gray-500 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {tradesData.trades.map((trade) => (
                  <TradeRow key={trade.id} trade={trade} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic">No trades yet</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

export function PaperTradingPanel() {
  const { selectedSessionId, isCreateModalOpen, setSelectedSession, setCreateModalOpen } =
    usePaperTradingStore();
  const { data: sessions, isLoading, error } = usePaperSessions();

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Paper Trading Sessions</h3>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary-600 hover:bg-primary-500 text-white font-medium transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </div>

      {/* Session list */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
          Failed to load sessions
        </div>
      )}

      {!isLoading && sessions && sessions.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          <svg
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          No sessions yet. Create one to start paper trading.
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isSelected={session.id === selectedSessionId}
              onSelect={() =>
                setSelectedSession(session.id === selectedSessionId ? null : session.id)
              }
            />
          ))}
        </div>
      )}

      {/* Divider before detail */}
      {selectedSessionId && (
        <div className="border-t border-gray-700 pt-4">
          <button
            onClick={() => setSelectedSession(null)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-4"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to list
          </button>
          <SessionDetail sessionId={selectedSessionId} />
        </div>
      )}

      {/* Create modal */}
      {isCreateModalOpen && (
        <CreatePaperSessionModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={(id) => {
            setSelectedSession(id);
            setCreateModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

export default PaperTradingPanel;
