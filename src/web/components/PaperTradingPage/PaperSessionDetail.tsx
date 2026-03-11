/**
 * PaperSessionDetail — full detail view for a selected paper trading session.
 * Orchestrates all data hooks and renders sub-components for chart, positions, trades, metrics.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { usePaperTradingStore } from '../../stores/paperTradingStore';
import { useAggregationStore } from '../../stores/aggregationStore';
import { useAuthStore } from '../../stores/authStore';
import { useConfigurationStore } from '../../stores/configurationStore';
import {
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
import {
  StatusBadge,
  NextTickCountdown,
  fmtUsd,
  fmtPct,
  fmtDate,
  returnPercent,
  configDisplayName,
} from '../PaperTradingPanel/PaperTradingPanel';
import type { SessionEvent, ActiveLevel } from '../Chart/Chart';
import { Spinner } from '../Spinner/Spinner';
import { mapPaperTrades, computePaperMetrics } from './paperUtils';
import { PaperPositionsTable } from './PaperPositionsTable';
import { PaperTradesTable } from './PaperTradesTable';
import { PaperMetricsDashboard } from './PaperMetricsDashboard';
import {
  PaperChartSection,
  TIMEFRAME_MS,
} from './PaperChartSection';
import type { PortfolioChartTab } from './PaperChartSection';
import { PaperStrategyConfig } from './PaperStrategyConfig';
import type { Timeframe, PaperEquitySnapshot } from '../../types';

// ============================================================================
// Candle range helpers
// ============================================================================

const CANDLE_COUNT: Record<string, number> = {
  '1m': 1000,
  '5m': 2000,
  '15m': 2000,
  '1h': 2000,
  '4h': 2200,
  '1d': 730,
  '1w': 200,
};

function candleStartDate(timeframe: string, referenceTs: number): string {
  const barMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
  const count = CANDLE_COUNT[timeframe] ?? 200;
  const bufferMs = barMs * count;
  const start = new Date(referenceTs - bufferMs);
  return start.toISOString().split('T')[0];
}

// ============================================================================
// Session event computation
// ============================================================================

function computeSessionEvents(
  snapshots: PaperEquitySnapshot[],
  timeframeMs: number,
  sessionCreatedAt: number,
  sessionStatus: string,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  events.push({ timestamp: sessionCreatedAt, type: 'start' });

  if (snapshots.length === 0) return events;

  const gapThreshold = timeframeMs * 3;

  for (let i = 1; i < snapshots.length; i++) {
    const gap = snapshots[i].timestamp - snapshots[i - 1].timestamp;
    if (gap > gapThreshold) {
      events.push({ timestamp: snapshots[i - 1].timestamp, type: 'pause' });
      events.push({ timestamp: snapshots[i].timestamp, type: 'resume' });
    }
  }

  if (sessionStatus === 'paused' || sessionStatus === 'stopped') {
    const lastTs = snapshots[snapshots.length - 1].timestamp;
    const alreadyMarked = events.some(e => e.type === 'pause' && e.timestamp === lastTs);
    if (!alreadyMarked) {
      events.push({ timestamp: lastTs, type: 'pause' });
    }
  }

  return events;
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
// PaperSessionDetail
// ============================================================================

interface PaperSessionDetailProps {
  sessionId: string;
}

export function PaperSessionDetail({ sessionId }: PaperSessionDetailProps) {
  const { data: session, isLoading } = usePaperSession(sessionId);
  const { data: tradesData } = usePaperAllTrades(sessionId);
  const { data: equitySnapshots } = usePaperEquity(sessionId);
  const deleteMutation = useDeletePaperSession();
  const controls = usePaperSessionControl(sessionId);
  const { setSelectedSession, setActivePage } = usePaperTradingStore();
  const { setActiveConfigTab, setSelectedAggregation } = useAggregationStore();
  const { setSelectedConfigId, setActiveConfigTab: setConfigurationTab } = useConfigurationStore();

  usePaperSessionSSE(sessionId);
  const { data: eventsData } = usePaperSessionEvents(sessionId);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserRole = useAuthStore((s) => s.user?.role);

  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1);
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
  const singleAsset = subStrategies.length === 1 ? assets[0] : null;
  const selectedAsset =
    selectedAssetIndex >= 0 && selectedAssetIndex < assets.length
      ? assets[selectedAssetIndex]
      : null;
  const activeAsset = selectedAsset ?? singleAsset;

  const allPaperTrades = tradesData?.trades ?? [];
  const backtestTrades = useMemo(() => mapPaperTrades(allPaperTrades), [allPaperTrades]);

  const FIVE_MIN = 5 * 60_000;
  const [endRounded, setEndRounded] = useState(() =>
    new Date(Math.ceil(Date.now() / FIVE_MIN) * FIVE_MIN).toISOString()
  );
  const endRoundedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => {
      setEndRounded(new Date(Math.ceil(Date.now() / FIVE_MIN) * FIVE_MIN).toISOString());
    };
    const now = Date.now();
    const next = Math.ceil(now / FIVE_MIN) * FIVE_MIN;
    const delay = next - now + 100;
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

  const priceStreamParams = useMemo(
    () =>
      activeAsset
        ? { exchange: activeAsset.exchange, symbol: activeAsset.symbol, timeframe: activeAsset.timeframe }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAsset?.exchange, activeAsset?.symbol, activeAsset?.timeframe],
  );
  const latestStreamCandle = usePriceStream(priceStreamParams);

  const chartCandles = useMemo(() => {
    if (!assetCandles || !latestStreamCandle) return assetCandles;
    const candles = [...assetCandles];
    const lastIdx = candles.length - 1;
    if (lastIdx >= 0 && candles[lastIdx].timestamp === latestStreamCandle.timestamp) {
      candles[lastIdx] = { ...candles[lastIdx], ...latestStreamCandle };
    } else if (lastIdx >= 0 && latestStreamCandle.timestamp > candles[lastIdx].timestamp) {
      candles.push(latestStreamCandle);
    }
    return candles;
  }, [assetCandles, latestStreamCandle]);

  const displayedPaperTrades = activeAsset
    ? allPaperTrades.filter((t) => t.symbol === activeAsset.symbol)
    : allPaperTrades;
  const displayedBacktestTrades = activeAsset
    ? backtestTrades.filter((t) => t.symbol === activeAsset.symbol)
    : backtestTrades;

  useEffect(() => {
    setSelectedAssetIndex(-1);
    setPortfolioChartTab('equity');
    setEquityResolution('All');
  }, [sessionId]);

  const snapshots: PaperEquitySnapshot[] = equitySnapshots ?? [];

  const metrics = useMemo(() => {
    if (!session) return null;
    return computePaperMetrics(displayedPaperTrades, session.initialCapital, session.currentEquity, snapshots);
  }, [session, displayedPaperTrades, snapshots]);

  const sessionEvents = useMemo(() => {
    if (!activeAsset || !session) return undefined;
    const tfMs = TIMEFRAME_MS[activeAsset.timeframe] ?? 3_600_000;
    return computeSessionEvents(snapshots, tfMs, session.createdAt, session.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, snapshots.length, activeAsset?.timeframe, session?.createdAt, session?.status]);

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
        <Spinner size="lg" className="text-gray-400" />
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
  const isAssetView = !!activeAsset && (isMultiAsset ? !!selectedAsset : true);

  const handleDelete = async () => {
    if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync(sessionId);
    setSelectedSession(null);
  };

  const handleViewAggregationConfig = () => {
    if (!session.aggregationConfigId) return;
    setSelectedAggregation(session.aggregationConfigId);
    setActiveConfigTab('aggregations');
    setConfigurationTab('aggregations');
    setActivePage('configurations');
  };

  const handleViewStrategyConfig = () => {
    if (!session.strategyConfigId) return;
    setSelectedConfigId(session.strategyConfigId);
    setConfigurationTab('strategies');
    setActivePage('configurations');
  };

  return (
    <div className="p-4 space-y-4">
      {/* Session header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{session.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{configDisplayName(session)}</p>
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

      {/* Source config link — aggregation */}
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
            onClick={handleViewAggregationConfig}
            className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View Config
          </button>
        </div>
      )}

      {/* Source config link — single strategy */}
      {!session.aggregationConfigId && session.strategyConfigId && (
        <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-gray-400 shrink-0">Based on strategy config:</span>
          <span className="text-gray-300 font-medium truncate">{session.strategyConfigId}</span>
          <button
            onClick={handleViewStrategyConfig}
            className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-medium transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View Strategy Config
          </button>
        </div>
      )}

      {/* Control buttons */}
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

      {/* Strategy Configuration widget */}
      {session.aggregationConfig && session.aggregationConfig.subStrategies.length > 0 && (
        <PaperStrategyConfig aggregationConfig={session.aggregationConfig} />
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
      <PaperChartSection
        isAssetView={isAssetView}
        isMultiAsset={isMultiAsset}
        activeAsset={activeAsset}
        chartCandles={chartCandles}
        displayedBacktestTrades={displayedBacktestTrades}
        snapshots={snapshots}
        portfolioChartTab={portfolioChartTab}
        onPortfolioChartTabChange={setPortfolioChartTab}
        equityResolution={equityResolution}
        onEquityResolutionChange={setEquityResolution}
        isFutures={isFutures}
        sessionCreatedAt={session.createdAt}
        sessionEvents={sessionEvents}
        frThresholds={frThresholds}
        activeLevels={activeLevels}
      />

      {/* Positions & Orders */}
      <PaperPositionsTable
        positions={session.positions ?? []}
        chartCandles={chartCandles}
      />

      {/* Performance metrics + event log */}
      <PaperMetricsDashboard
        metrics={metrics}
        eventsData={eventsData}
      />

      {/* Trades table */}
      <PaperTradesTable
        trades={displayedPaperTrades}
        isMultiAsset={isMultiAsset}
        selectedAssetLabel={selectedAsset?.label ?? null}
        isFutures={isFutures}
      />
    </div>
  );
}
