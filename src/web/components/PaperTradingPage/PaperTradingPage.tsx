/**
 * Full-page Paper Trading view.
 * Layout mirrors the backtesting page: left sidebar (session list) + main area (detail).
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import { useAggregationStore } from '../../stores/aggregationStore';
import { useAuthStore } from '../../stores/authStore';
import {
  usePaperSessions,
  usePaperSession,
  usePaperAllTrades,
  usePaperEquity,
  useDeletePaperSession,
  usePaperSessionControl,
  usePaperSessionSSE,
  usePaperSessionEvents,
} from '../../hooks/usePaperTrading';
import { useCandles } from '../../hooks/useBacktest';
import { usePriceStream } from '../../hooks/usePriceStream';
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
  configDisplayName,
} from '../PaperTradingPanel/PaperTradingPanel';
import { Chart } from '../Chart';
import type { SessionEvent, ActiveLevel } from '../Chart/Chart';
import { Dashboard } from '../Dashboard';
import { PaperDrawdownChart } from './PaperDrawdownChart';
import { mapPaperTrades, computePaperMetrics } from './paperUtils';
import type { Timeframe, PaperEquitySnapshot } from '../../types';

// ============================================================================
// Candle range helper — compute a start date providing timeframe-appropriate
// historical context before a reference point.
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

// Number of historical candles to display per timeframe
const CANDLE_COUNT: Record<string, number> = {
  '1m': 1000,  // ~17 hours
  '5m': 2000,  // ~1 week
  '15m': 2000, // ~3 weeks
  '1h': 2000,  // ~3 months
  '4h': 2200,  // ~1 year
  '1d': 730,   // ~2 years
  '1w': 200,   // ~4 years
};

function candleStartDate(timeframe: string, referenceTs: number): string {
  const barMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
  const count = CANDLE_COUNT[timeframe] ?? 200;
  const bufferMs = barMs * count;
  const start = new Date(referenceTs - bufferMs);
  return start.toISOString().split('T')[0];
}

// ============================================================================
// Session event computation — derive start/pause/resume markers from equity
// snapshots. Gaps between consecutive snapshots larger than 3x the timeframe
// interval indicate paused periods.
// ============================================================================

function computeSessionEvents(
  snapshots: PaperEquitySnapshot[],
  timeframeMs: number,
  sessionCreatedAt: number,
  sessionStatus: string,
): SessionEvent[] {
  const events: SessionEvent[] = [];

  // Always show a "Start" marker at session creation time
  events.push({ timestamp: sessionCreatedAt, type: 'start' });

  if (snapshots.length === 0) return events;

  // Detect gaps — threshold is 3x the timeframe bar duration
  const gapThreshold = timeframeMs * 3;

  for (let i = 1; i < snapshots.length; i++) {
    const gap = snapshots[i].timestamp - snapshots[i - 1].timestamp;
    if (gap > gapThreshold) {
      events.push({ timestamp: snapshots[i - 1].timestamp, type: 'pause' });
      events.push({ timestamp: snapshots[i].timestamp, type: 'resume' });
    }
  }

  // If session is currently paused/stopped, mark the last snapshot as a pause point
  if (sessionStatus === 'paused' || sessionStatus === 'stopped') {
    const lastTs = snapshots[snapshots.length - 1].timestamp;
    // Avoid duplicate if already marked as pause
    const alreadyMarked = events.some(e => e.type === 'pause' && e.timestamp === lastTs);
    if (!alreadyMarked) {
      events.push({ timestamp: lastTs, type: 'pause' });
    }
  }

  return events;
}

// ============================================================================
// Chart tab type definitions
// ============================================================================

type PortfolioChartTab = 'equity' | 'drawdown';

// ============================================================================
// Equity snapshot resampler — thin data to selected time bucket
// ============================================================================

function resampleSnapshots(snapshots: PaperEquitySnapshot[], resolution: string): PaperEquitySnapshot[] {
  if (resolution === 'All') return snapshots;
  const bucketMs = TIMEFRAME_MS[resolution];
  if (!bucketMs || snapshots.length === 0) return snapshots;

  const result: PaperEquitySnapshot[] = [];
  let currentBucket = -1;

  for (const s of snapshots) {
    const bucket = Math.floor(s.timestamp / bucketMs);
    if (bucket !== currentBucket) {
      result.push(s);
      currentBucket = bucket;
    } else {
      result[result.length - 1] = s; // replace with latest in bucket (closing value)
    }
  }
  return result;
}

// ============================================================================
// Chart tab bar — thin horizontal row of tab pills
// ============================================================================

function ChartTabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 mb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors border ${
            active === tab.id
              ? 'bg-gray-700 border-gray-500 text-white'
              : 'bg-transparent border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
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
  const { setSelectedSession, setActivePage } = usePaperTradingStore();
  const { setActiveConfigTab, setSelectedAggregation } = useAggregationStore();

  usePaperSessionSSE(sessionId);
  const { data: eventsData } = usePaperSessionEvents(sessionId);

  // Auth — must be called before any early returns (rules of hooks)
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);

  // Asset tabs for multi-asset sessions
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1);

  // Chart view tabs (asset view always shows price; only portfolio has tab selection)
  const [portfolioChartTab, setPortfolioChartTab] = useState<PortfolioChartTab>('equity');
  const [equityResolution, setEquityResolution] = useState<string>('All');

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

  // Compute candle date range — always show at least 200 candles of history.
  // Use earliest trade timestamp as reference when trades exist, otherwise use now.
  // endDate is current time rounded to 5 minutes for a stable React Query key
  // that still triggers the backend to fetch recent candles.
  //
  // IMPORTANT: endRounded is kept in state and only updated every 5 minutes to
  // prevent React Query key churn on every render from WS ticks. If it were
  // recalculated inline, crossing a 5-min boundary mid-stream would invalidate
  // the cache key, causing a refetch that temporarily replaces assetCandles with
  // stale data, breaks the chartCandles merge, and triggers setData() in Chart
  // (resetting zoom). Using a timer ensures the key only changes once per period.
  const FIVE_MIN = 5 * 60_000;
  const [endRounded, setEndRounded] = useState(() =>
    new Date(Math.ceil(Date.now() / FIVE_MIN) * FIVE_MIN).toISOString()
  );
  const endRoundedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => {
      setEndRounded(new Date(Math.ceil(Date.now() / FIVE_MIN) * FIVE_MIN).toISOString());
    };
    // Fire at the next 5-minute boundary, then every 5 minutes thereafter
    const now = Date.now();
    const next = Math.ceil(now / FIVE_MIN) * FIVE_MIN;
    const delay = next - now + 100; // small buffer to land after the boundary
    const timeout = setTimeout(() => {
      tick();
      endRoundedIntervalRef.current = setInterval(tick, FIVE_MIN);
    }, delay);
    return () => {
      clearTimeout(timeout);
      if (endRoundedIntervalRef.current) {
        clearInterval(endRoundedIntervalRef.current);
        endRoundedIntervalRef.current = null;
      }
    };
  }, []);

  const now = Date.now();
  const earliestTradeTs = allPaperTrades.length > 0
    ? Math.min(...allPaperTrades.map((t) => t.timestamp))
    : now;
  const referenceTs = Math.min(earliestTradeTs, now);
  const candleParams = activeAsset && session ? {
    exchange: activeAsset.exchange,
    symbol: activeAsset.symbol,
    timeframe: activeAsset.timeframe as Timeframe,
    startDate: candleStartDate(activeAsset.timeframe, referenceTs),
    endDate: endRounded,
  } : null;
  const { data: assetCandles } = useCandles(candleParams);

  // Real-time price streaming — always active when an asset is shown (price chart is always displayed).
  // The session does not need to be running; the WS stream shows live market data regardless.
  const priceStreamParams = useMemo(
    () =>
      activeAsset
        ? { exchange: activeAsset.exchange, symbol: activeAsset.symbol, timeframe: activeAsset.timeframe }
        : null,
    // Use stable primitive deps instead of the activeAsset object reference to avoid
    // spurious reconnects when the parent re-renders and produces a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAsset?.exchange, activeAsset?.symbol, activeAsset?.timeframe],
  );
  const latestStreamCandle = usePriceStream(priceStreamParams);

  // Merge real-time streaming candle into the fetched candle array.
  // If the streaming candle has the same timestamp as the last candle, it updates it in place.
  // If the streaming candle is newer, it is appended as a new candle.
  const chartCandles = useMemo(() => {
    if (!assetCandles || !latestStreamCandle) return assetCandles;
    const candles = [...assetCandles];
    const lastIdx = candles.length - 1;
    if (lastIdx >= 0 && candles[lastIdx].timestamp === latestStreamCandle.timestamp) {
      // Update the forming candle in-place
      candles[lastIdx] = { ...candles[lastIdx], ...latestStreamCandle };
    } else if (lastIdx >= 0 && latestStreamCandle.timestamp > candles[lastIdx].timestamp) {
      // New bar — append it
      candles.push(latestStreamCandle);
    }
    return candles;
  }, [assetCandles, latestStreamCandle]);

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

  // Reset asset index on session change; reset chart tabs too
  useEffect(() => {
    setSelectedAssetIndex(-1);
    setPortfolioChartTab('equity');
    setEquityResolution('All');
  }, [sessionId]);

  // Derive session start/pause/resume markers from equity snapshot gaps.
  // Must be before early returns so hooks are always called in the same order.
  const snapshots: PaperEquitySnapshot[] = equitySnapshots ?? [];
  const sessionEvents = useMemo(() => {
    if (!activeAsset || !session) return undefined;
    const tfMs = TIMEFRAME_MS[activeAsset.timeframe] ?? 3_600_000;
    return computeSessionEvents(snapshots, tfMs, session.createdAt, session.status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, snapshots.length, activeAsset?.timeframe, session?.createdAt, session?.status]);

  // Extract FR thresholds from active sub-strategy params directly.
  // The backend always stores full resolved params in subStrategy.params.
  // Must be before early returns so hooks are always called in the same order.
  const frThresholds = useMemo(() => {
    if (!activeAsset) return { short: undefined, long: undefined };
    const activeSub = subStrategies.find(
      (ss) => ss.symbol === activeAsset.symbol && ss.timeframe === activeAsset.timeframe,
    );
    const params = activeSub?.params ?? {};
    const short = typeof params.fundingThresholdShort === 'number' ? params.fundingThresholdShort : undefined;
    const long = typeof params.fundingThresholdLong === 'number' ? params.fundingThresholdLong : undefined;
    return { short, long };
  }, [activeAsset, subStrategies]);

  // Compute SL/TP price levels for open positions on the active asset.
  // These are rendered as horizontal dashed lines on the price chart.
  const activeLevels = useMemo((): ActiveLevel[] => {
    if (!activeAsset || !session) return [];
    const positions = session.positions ?? [];
    const assetPositions = positions.filter((p) => p.symbol === activeAsset.symbol);
    const levels: ActiveLevel[] = [];
    for (const pos of assetPositions) {
      if (pos.stopLoss != null) {
        levels.push({ price: pos.stopLoss, label: 'SL', color: '#EF4444' });
      }
      if (pos.takeProfit != null) {
        levels.push({ price: pos.takeProfit, label: 'TP', color: '#22C55E' });
      }
    }
    return levels;
  }, [session, activeAsset]);

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

  const isOwner = session.userId === currentUserId || currentUserRole === 'admin';

  const handleDelete = async () => {
    if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(sessionId);
    setSelectedSession(null);
  };

  const handleViewConfig = () => {
    if (!session.aggregationConfigId) return;
    setSelectedAggregation(session.aggregationConfigId);
    setActiveConfigTab('aggregations');
    setActivePage('backtesting');
  };

  // Portfolio chart tab definitions
  const portfolioTabs: { id: PortfolioChartTab; label: string }[] = [
    { id: 'equity', label: 'Equity' },
    { id: 'drawdown', label: 'Drawdown' },
  ];

  // Whether we are in the "per-asset" view or the "portfolio/single" view
  // (multi-asset with portfolio selected, or single-asset session)
  const isAssetView = !!activeAsset && (isMultiAsset ? !!selectedAsset : true);

  return (
    <div className="p-4 space-y-4">
      {/* Session header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{session.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {configDisplayName(session)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {!isOwner && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400">
              View Only
            </span>
          )}
        </div>
      </div>

      {/* Source config link — only shown when session was created from a saved aggregation config */}
      {session.aggregationConfigId && (
        <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-gray-400 shrink-0">Based on config:</span>
          <span className="text-gray-300 font-medium truncate">
            {session.aggregationConfig?.name ?? session.aggregationConfigId}
          </span>
          {session.aggregationConfig && (
            <span className="text-gray-500 text-xs shrink-0">
              {session.aggregationConfig.allocationMode.replace(/_/g, ' ')} |{' '}
              {session.aggregationConfig.subStrategies.length} strategies
            </span>
          )}
          <button
            onClick={handleViewConfig}
            className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View Config
          </button>
        </div>
      )}

      {/* Control buttons - only shown to session owner */}
      {isOwner && (
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
      )}

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-3">Direction</th>
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3">Amount</th>
                  <th className="pb-2 pr-3">Entry Price</th>
                  <th className="pb-2 pr-3">Entry Time</th>
                  <th className="pb-2 pr-3">Unrealized P&amp;L</th>
                  <th className="pb-2 pr-3">Stop Loss</th>
                  <th className="pb-2 pr-3">Take Profit</th>
                  <th className="pb-2">Funding</th>
                </tr>
              </thead>
              <tbody>
                {session.positions.map((pos) => (
                  <tr key={pos.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${pos.direction === 'long' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                        {pos.direction === 'long' ? 'Long' : 'Short'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-white font-medium">{pos.symbol}</td>
                    <td className="py-2 pr-3 text-gray-300">{pos.amount.toFixed(6)}</td>
                    <td className="py-2 pr-3 text-gray-300">{fmtUsd(pos.entryPrice)}</td>
                    <td className="py-2 pr-3 text-gray-400 text-xs">{new Date(pos.entryTime).toLocaleString()}</td>
                    <td className={`py-2 pr-3 font-medium ${pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fmtUsd(pos.unrealizedPnl)}
                    </td>
                    <td className="py-2 pr-3 text-red-400 text-xs">
                      {pos.stopLoss != null ? fmtUsd(pos.stopLoss) : <span className="text-gray-600">-</span>}
                    </td>
                    <td className="py-2 pr-3 text-green-400 text-xs">
                      {pos.takeProfit != null ? fmtUsd(pos.takeProfit) : <span className="text-gray-600">-</span>}
                    </td>
                    <td className={`py-2 ${pos.fundingAccumulated >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fmtUsd(pos.fundingAccumulated)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* Chart section with tabs */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-gray-400">
            {isAssetView
              ? `${activeAsset!.label} (${activeAsset!.timeframe})`
              : isMultiAsset
                ? 'Portfolio'
                : 'Equity Curve'}
          </h3>
        </div>

        {isAssetView ? (
          // Asset selected: show price chart only, no tabs
          chartCandles && chartCandles.length > 0 ? (
            <Chart
              candles={chartCandles}
              trades={displayedBacktestTrades}
              height={450}
              isFutures={isFutures}
              backtestTimeframe={activeAsset!.timeframe as Timeframe}
              exchange={activeAsset!.exchange}
              symbol={activeAsset!.symbol}
              startDate={session.createdAt}
              endDate={Date.now()}
              sessionEvents={sessionEvents}
              frShortThreshold={frThresholds.short}
              frLongThreshold={frThresholds.long}
              activeLevels={activeLevels}
            />
          ) : (
            <div className="h-[450px] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
              Loading candles for {activeAsset!.label}...
            </div>
          )
        ) : (
          <>
            <ChartTabBar
              tabs={portfolioTabs}
              active={portfolioChartTab}
              onChange={setPortfolioChartTab}
            />
            {(portfolioChartTab === 'equity' || portfolioChartTab === 'drawdown') && (
              <div className="flex items-center gap-1 mb-2">
                <span className="text-xs text-gray-500 mr-1">Resolution:</span>
                {['All', '1h', '4h', '1d', '1w'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setEquityResolution(r)}
                    className={`px-2 py-0.5 rounded text-xs ${
                      equityResolution === r
                        ? 'bg-gray-600 text-white'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
            {portfolioChartTab === 'equity' && (
              <PaperEquityChart snapshots={resampleSnapshots(snapshots, equityResolution)} height={450} />
            )}
            {portfolioChartTab === 'drawdown' && (
              <PaperDrawdownChart snapshots={resampleSnapshots(snapshots, equityResolution)} height={450} />
            )}
          </>
        )}
      </section>

      {/* Dashboard metrics */}
      <section>
        <Dashboard metrics={metrics} />
      </section>

      {/* Event Log */}
      {eventsData && eventsData.events.length > 0 && (
        <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">
            Event Log ({eventsData.total})
          </h3>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {eventsData.events.map((evt) => (
              <div key={evt.id} className="flex items-start gap-2 text-xs py-1 border-b border-gray-700/30 last:border-0">
                <span className="text-gray-500 shrink-0 w-[140px]">
                  {new Date(evt.createdAt).toLocaleString()}
                </span>
                <EventTypeBadge type={evt.type} />
                <span className="text-gray-300">{evt.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trades table — always visible, even with 0 trades */}
      <section className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-lg font-semibold text-white mb-4">
          Trades ({displayedPaperTrades.length}
          {isMultiAsset && selectedAsset && ` - ${selectedAsset.label}`}
          {isMultiAsset && !selectedAsset && ' - All Assets'})
        </h3>
        {displayedPaperTrades.length > 0 ? (
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
        ) : (
          <p className="text-gray-500 text-sm">
            No trades yet{selectedAsset ? ` for ${selectedAsset.label}` : ''}
          </p>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// EventTypeBadge — color-coded pill for event type
// ============================================================================

function EventTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    trade_opened: 'bg-green-900/50 text-green-400',
    trade_closed: 'bg-blue-900/50 text-blue-400',
    funding_payment: 'bg-purple-900/50 text-purple-400',
    error: 'bg-red-900/50 text-red-400',
    retry: 'bg-yellow-900/50 text-yellow-400',
    status_change: 'bg-indigo-900/50 text-indigo-400',
  };
  const labels: Record<string, string> = {
    trade_opened: 'Open',
    trade_closed: 'Close',
    funding_payment: 'Funding',
    error: 'Error',
    retry: 'Retry',
    status_change: 'Status',
  };

  const style = styles[type] ?? 'bg-gray-700 text-gray-400';
  const label = labels[type] ?? type;

  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${style}`}>
      {label}
    </span>
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

  // Auto-select first session when none is selected
  useEffect(() => {
    if (!selectedSessionId && !isLoading && sessions && sessions.length > 0) {
      setSelectedSession(sessions[0].id);
    }
  }, [selectedSessionId, isLoading, sessions, setSelectedSession]);

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
