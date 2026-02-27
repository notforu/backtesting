/**
 * Full-page Paper Trading view.
 * Layout mirrors the backtesting page: left sidebar (session list) + main area (detail).
 */

import { useState, useEffect, useMemo } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import {
  usePaperSessions,
  usePaperSession,
  usePaperAllTrades,
  usePaperEquity,
  useDeletePaperSession,
  usePaperSessionControl,
  usePaperSessionSSE,
} from '../../hooks/usePaperTrading';
import { useCandles } from '../../hooks/useBacktest';
import { CreatePaperSessionModal } from '../PaperTradingPanel/CreatePaperSessionModal';
import { PaperEquityChart } from '../PaperTradingPanel/PaperEquityChart';
import {
  StatusBadge,
  SessionCard,
  NextTickCountdown,
  fmtUsd,
  fmtPct,
  fmtDate,
  returnPercent,
} from '../PaperTradingPanel/PaperTradingPanel';
import { Chart } from '../Chart';
import { Dashboard } from '../Dashboard';
import { mapPaperTrades, computePaperMetrics } from './paperUtils';
import type { Timeframe } from '../../types';

// ============================================================================
// Candle range helper — compute a start date providing ~200 candles of context
// ============================================================================

const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
};

function candleStartDate(timeframe: string, earliestTs: number): string {
  const barMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
  const bufferMs = barMs * 200; // ~200 candles of context
  const start = new Date(earliestTs - bufferMs);
  return start.toISOString().split('T')[0];
}

// ============================================================================
// Session Detail (full-page version)
// ============================================================================

function FullSessionDetail({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading } = usePaperSession(sessionId);
  const { data: tradesData } = usePaperAllTrades(sessionId);
  const { data: equitySnapshots } = usePaperEquity(sessionId);
  const deleteMutation = useDeletePaperSession();
  const controls = usePaperSessionControl(sessionId);
  const { setSelectedSession } = usePaperTradingStore();

  usePaperSessionSSE(sessionId);

  // Asset tabs for multi-asset sessions
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1);

  const subStrategies = session?.aggregationConfig?.subStrategies ?? [];
  const isMultiAsset = subStrategies.length > 1;
  const assets = subStrategies.map((ss) => ({
    symbol: ss.symbol,
    timeframe: ss.timeframe,
    label: ss.symbol.replace('/USDT:USDT', '').replace('/USDT', ''),
    exchange: ss.exchange ?? session?.aggregationConfig?.exchange ?? 'bybit',
  }));
  // For single-strategy sessions, still build asset from the single sub
  const singleAsset = subStrategies.length === 1 ? assets[0] : null;
  const selectedAsset =
    selectedAssetIndex >= 0 && selectedAssetIndex < assets.length
      ? assets[selectedAssetIndex]
      : null;
  const activeAsset = selectedAsset ?? singleAsset;

  // Map paper trades to backtest Trade format
  const allPaperTrades = tradesData?.trades ?? [];
  const backtestTrades = useMemo(() => mapPaperTrades(allPaperTrades), [allPaperTrades]);

  // Compute candle date range — go back ~200 candles from the earliest trade for context
  const earliestTradeTs = allPaperTrades.length > 0
    ? Math.min(...allPaperTrades.map((t) => t.timestamp))
    : session?.createdAt ?? Date.now();
  const candleParams = activeAsset && session ? {
    exchange: activeAsset.exchange,
    symbol: activeAsset.symbol,
    timeframe: activeAsset.timeframe as Timeframe,
    startDate: candleStartDate(activeAsset.timeframe, earliestTradeTs),
    endDate: new Date().toISOString().split('T')[0],
  } : null;
  const { data: assetCandles } = useCandles(candleParams);

  // Filter trades for selected asset
  const displayedPaperTrades = activeAsset
    ? allPaperTrades.filter((t) => t.symbol === activeAsset.symbol)
    : allPaperTrades;
  const displayedBacktestTrades = activeAsset
    ? backtestTrades.filter((t) => t.symbol === activeAsset.symbol)
    : backtestTrades;

  // Compute metrics
  const metrics = useMemo(() => {
    if (!session) return null;
    return computePaperMetrics(displayedPaperTrades, session.initialCapital, session.currentEquity);
  }, [session, displayedPaperTrades]);

  // Reset asset index on session change
  useEffect(() => { setSelectedAssetIndex(-1); }, [sessionId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <svg className="animate-spin h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
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
  const isFutures = session.aggregationConfig?.mode === 'futures';

  const handleDelete = async () => {
    if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(sessionId);
    setSelectedSession(null);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Session header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{session.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {session.aggregationConfig?.name ?? session.aggregationConfigId ?? 'Unknown config'}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Control buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {(status === 'stopped' || status === 'error') && (
          <button onClick={() => controls.start.mutate()} disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors">
            Start
          </button>
        )}
        {status === 'running' && (
          <button onClick={() => controls.pause.mutate()} disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors">
            Pause
          </button>
        )}
        {status === 'paused' && (
          <button onClick={() => controls.resume.mutate()} disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors">
            Resume
          </button>
        )}
        {(status === 'running' || status === 'paused') && (
          <button onClick={() => controls.stop.mutate()} disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium transition-colors">
            Stop
          </button>
        )}
        {status === 'running' && (
          <button onClick={() => controls.tick.mutate()} disabled={controls.tick.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-gray-300 font-medium transition-colors"
            title="Force tick (dev)">
            Tick
          </button>
        )}
        <button onClick={handleDelete} disabled={deleteMutation.isPending}
          className="ml-auto px-4 py-2 text-sm rounded-lg border border-red-800 hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed text-red-400 font-medium transition-colors">
          Delete
        </button>
      </div>

      {/* Error banner */}
      {session.errorMessage && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {session.errorMessage}
        </div>
      )}

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <MetricBox label="Equity" value={fmtUsd(session.currentEquity)} />
        <MetricBox label="Return" value={fmtPct(ret)} className={isPositive ? 'text-green-400' : 'text-red-400'} />
        <MetricBox label="Cash" value={fmtUsd(session.currentCash)} />
        <MetricBox label="Positions Value" value={fmtUsd(session.currentEquity - session.currentCash)} />
        <MetricBox label="Ticks" value={session.tickCount.toLocaleString()} />
        <MetricBox label="Next Tick">
          <NextTickCountdown nextTickAt={session.nextTickAt} />
        </MetricBox>
      </div>

      {/* Last tick info */}
      <p className="text-xs text-gray-500">
        Last tick: <span className="text-gray-400">{fmtDate(session.lastTickAt)}</span>
        {' | '}
        Created: <span className="text-gray-400">{fmtDate(session.createdAt)}</span>
      </p>

      {/* Open positions */}
      {session.positions && session.positions.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">
            Open Positions ({session.positions.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {session.positions.map((pos) => (
              <div key={pos.id} className="bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs px-2 py-0.5 rounded ${pos.direction === 'long' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                    {pos.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                  <span className="text-sm text-white font-medium truncate">{pos.symbol}</span>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">Entry: {fmtUsd(pos.entryPrice)}</p>
                  <p className={`text-sm font-medium ${pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {fmtUsd(pos.unrealizedPnl)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Asset tab selector */}
      {isMultiAsset && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setSelectedAssetIndex(-1)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedAssetIndex === -1
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
            }`}
          >
            Portfolio
          </button>
          {assets.map((asset, idx) => (
            <button
              key={asset.symbol}
              onClick={() => setSelectedAssetIndex(idx)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedAssetIndex === idx
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
            >
              {asset.label} ({asset.timeframe})
            </button>
          ))}
        </div>
      )}

      {/* Chart section */}
      <section>
        <h3 className="text-lg font-semibold text-white mb-2">
          {isMultiAsset && !selectedAsset ? 'Portfolio Equity' : activeAsset ? `${activeAsset.label} Chart` : 'Equity Curve'}
        </h3>
        {isMultiAsset && !selectedAsset ? (
          /* Portfolio equity curve */
          <PaperEquityChart snapshots={equitySnapshots ?? []} height={450} />
        ) : activeAsset && assetCandles && assetCandles.length > 0 ? (
          /* Per-asset candlestick chart with trade markers */
          <Chart
            candles={assetCandles}
            trades={displayedBacktestTrades}
            height={450}
            isFutures={isFutures}
            backtestTimeframe={activeAsset.timeframe as Timeframe}
            exchange={activeAsset.exchange}
            symbol={activeAsset.symbol}
          />
        ) : activeAsset ? (
          <div className="h-[450px] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
            Loading candles for {activeAsset.label}...
          </div>
        ) : (
          /* Single-asset or no asset — show equity curve */
          <PaperEquityChart snapshots={equitySnapshots ?? []} height={450} />
        )}
      </section>

      {/* Dashboard metrics */}
      <section>
        <Dashboard metrics={metrics} />
      </section>

      {/* Trades table */}
      {displayedPaperTrades.length > 0 && (
        <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-lg font-semibold text-white mb-4">
            Trades ({displayedPaperTrades.length}
            {isMultiAsset && selectedAsset && ` - ${selectedAsset.label}`}
            {isMultiAsset && !selectedAsset && ' - All Assets'})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">#</th>
                  {isMultiAsset && !selectedAsset && <th className="pb-2 pr-4">Asset</th>}
                  <th className="pb-2 pr-4">Action</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">P&amp;L</th>
                  <th className="pb-2 pr-4">P&amp;L %</th>
                  <th className="pb-2 pr-4">Fee</th>
                  {isFutures && <th className="pb-2 pr-4">Funding</th>}
                  <th className="pb-2 pr-4">Balance</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {displayedPaperTrades.slice(0, 200).map((trade, index) => {
                  const isClose = trade.action === 'close_long' || trade.action === 'close_short';
                  const actionLabel = trade.action === 'open_long' ? 'Open Long'
                    : trade.action === 'open_short' ? 'Open Short'
                    : trade.action === 'close_long' ? 'Close Long' : 'Close Short';
                  const actionColor = trade.action.startsWith('open')
                    ? 'bg-green-900/50 text-green-400'
                    : 'bg-red-900/50 text-red-400';

                  return (
                    <tr key={trade.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 pr-4 text-gray-500">{index + 1}</td>
                      {isMultiAsset && !selectedAsset && (
                        <td className="py-2 pr-4 text-gray-400 text-xs">{trade.symbol?.replace('/USDT:USDT', '') ?? '-'}</td>
                      )}
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor}`}>{actionLabel}</span>
                      </td>
                      <td className="py-2 pr-4 text-white">{fmtUsd(trade.price)}</td>
                      <td className="py-2 pr-4 text-gray-300">{trade.amount.toFixed(6)}</td>
                      <td className={`py-2 pr-4 ${isClose ? ((trade.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>
                        {isClose ? `${(trade.pnl ?? 0) >= 0 ? '+' : ''}${fmtUsd(trade.pnl ?? 0)}` : '-'}
                      </td>
                      <td className={`py-2 pr-4 ${isClose ? ((trade.pnlPercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>
                        {isClose ? `${(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${(trade.pnlPercent ?? 0).toFixed(2)}%` : '-'}
                      </td>
                      <td className="py-2 pr-4 text-gray-400">{trade.fee ? fmtUsd(trade.fee) : '-'}</td>
                      {isFutures && (
                        <td className={`py-2 pr-4 ${trade.fundingIncome ? (trade.fundingIncome >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}`}>
                          {trade.fundingIncome ? `${trade.fundingIncome >= 0 ? '+' : ''}${fmtUsd(trade.fundingIncome)}` : '-'}
                        </td>
                      )}
                      <td className="py-2 pr-4 text-gray-300">{fmtUsd(trade.balanceAfter)}</td>
                      <td className="py-2 text-gray-400">{new Date(trade.timestamp).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {displayedPaperTrades.length > 200 && (
              <p className="text-sm text-gray-500 mt-3 text-center">
                Showing first 200 of {displayedPaperTrades.length} trades
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// MetricBox — small stat display
// ============================================================================

function MetricBox({ label, value, className, children }: {
  label: string;
  value?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${className ?? 'text-white'}`}>
        {children ?? value}
      </p>
    </div>
  );
}

// ============================================================================
// PaperTradingPage — main export
// ============================================================================

export function PaperTradingPage() {
  const { selectedSessionId, isCreateModalOpen, setSelectedSession, setCreateModalOpen } =
    usePaperTradingStore();
  const { data: sessions, isLoading, error } = usePaperSessions();

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar — session list */}
      <aside className="w-80 flex-shrink-0 border-r border-gray-700 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Sessions</h2>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Session
            </button>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
              Failed to load sessions
            </div>
          )}

          {/* Empty state */}
          {!isLoading && sessions && sessions.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              No sessions yet. Create one to start paper trading.
            </div>
          )}

          {/* Session cards */}
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
        </div>
      </aside>

      {/* Main area */}
      <main className="flex-1 overflow-y-auto">
        {selectedSessionId ? (
          <FullSessionDetail sessionId={selectedSessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-lg">Select a session to view details</p>
              <p className="text-sm mt-1">Or create a new paper trading session</p>
            </div>
          </div>
        )}
      </main>

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
