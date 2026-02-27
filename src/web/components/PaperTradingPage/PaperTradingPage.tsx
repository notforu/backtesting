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
  configDisplayName,
} from '../PaperTradingPanel/PaperTradingPanel';
import { Chart } from '../Chart';
import { Dashboard } from '../Dashboard';
import { PaperDrawdownChart } from './PaperDrawdownChart';
import { mapPaperTrades, computePaperMetrics } from './paperUtils';
import type { Timeframe, PerformanceMetrics, PaperEquitySnapshot } from '../../types';

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

function candleStartDate(timeframe: string, referenceTs: number): string {
  const barMs = TIMEFRAME_MS[timeframe] ?? 3_600_000;
  const bufferMs = barMs * 200; // ~200 candles of context before reference point
  const start = new Date(referenceTs - bufferMs);
  return start.toISOString().split('T')[0];
}

// ============================================================================
// Chart tab type definitions
// ============================================================================

type AssetChartTab = 'price' | 'equity' | 'drawdown' | 'stats';
type PortfolioChartTab = 'equity' | 'drawdown' | 'stats';

// ============================================================================
// StatsTab — performance statistics grid
// ============================================================================

function StatCard({
  label,
  value,
  valueClass,
  subValue,
}: {
  label: string;
  value: string;
  valueClass?: string;
  subValue?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 px-4 py-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueClass ?? 'text-white'}`}>{value}</p>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </div>
  );
}

function StatsTab({
  metrics,
  isFutures,
}: {
  metrics: PerformanceMetrics | null;
  isFutures: boolean;
}) {
  if (!metrics) {
    return (
      <div className="h-[450px] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
        No data yet
      </div>
    );
  }

  const pfDisplay =
    metrics.profitFactor === Infinity
      ? 'Perfect'
      : metrics.profitFactor === 0
        ? '0.00'
        : metrics.profitFactor.toFixed(2);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          valueClass={metrics.winRate >= 50 ? 'text-green-400' : 'text-red-400'}
          subValue={`${metrics.winningTrades}W / ${metrics.losingTrades}L`}
        />
        <StatCard
          label="Profit Factor"
          value={pfDisplay}
          valueClass={metrics.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Total Trades"
          value={metrics.totalTrades.toString()}
          subValue="closed trades"
        />
        <StatCard
          label="Expectancy"
          value={fmtUsd(metrics.expectancy)}
          valueClass={metrics.expectancy >= 0 ? 'text-green-400' : 'text-red-400'}
          subValue={`${metrics.expectancyPercent >= 0 ? '+' : ''}${metrics.expectancyPercent.toFixed(2)}% per trade`}
        />
        <StatCard
          label="Avg Win"
          value={fmtUsd(metrics.avgWin)}
          valueClass="text-green-400"
          subValue={`${metrics.avgWinPercent >= 0 ? '+' : ''}${metrics.avgWinPercent.toFixed(2)}%`}
        />
        <StatCard
          label="Avg Loss"
          value={fmtUsd(metrics.avgLoss)}
          valueClass="text-red-400"
          subValue={`${metrics.avgLossPercent.toFixed(2)}%`}
        />
        <StatCard
          label="Best Trade"
          value={fmtUsd(metrics.largestWin)}
          valueClass="text-green-400"
        />
        <StatCard
          label="Worst Trade"
          value={fmtUsd(metrics.largestLoss)}
          valueClass="text-red-400"
        />
        <StatCard
          label="Total Fees"
          value={fmtUsd(metrics.totalFees)}
          valueClass="text-yellow-400"
        />
        {isFutures && metrics.totalFundingIncome !== undefined && (
          <StatCard
            label="Total Funding Income"
            value={fmtUsd(metrics.totalFundingIncome)}
            valueClass={metrics.totalFundingIncome >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        )}
        {isFutures && metrics.tradingPnl !== undefined && (
          <StatCard
            label="Trading PnL"
            value={fmtUsd(metrics.tradingPnl)}
            valueClass={metrics.tradingPnl >= 0 ? 'text-green-400' : 'text-red-400'}
            subValue="excl. funding"
          />
        )}
      </div>
    </div>
  );
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
  const { setSelectedSession } = usePaperTradingStore();

  usePaperSessionSSE(sessionId);

  // Asset tabs for multi-asset sessions
  const [selectedAssetIndex, setSelectedAssetIndex] = useState<number>(-1);

  // Chart view tabs
  const [assetChartTab, setAssetChartTab] = useState<AssetChartTab>('price');
  const [portfolioChartTab, setPortfolioChartTab] = useState<PortfolioChartTab>('equity');

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
  // endDate is tomorrow to ensure the current (forming) candle is included.
  const now = Date.now();
  const earliestTradeTs = allPaperTrades.length > 0
    ? Math.min(...allPaperTrades.map((t) => t.timestamp))
    : now;
  const referenceTs = Math.min(earliestTradeTs, now);
  const tomorrowDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();
  const candleParams = activeAsset && session ? {
    exchange: activeAsset.exchange,
    symbol: activeAsset.symbol,
    timeframe: activeAsset.timeframe as Timeframe,
    startDate: candleStartDate(activeAsset.timeframe, referenceTs),
    endDate: tomorrowDate,
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

  // Reset asset index on session change; reset chart tabs too
  useEffect(() => {
    setSelectedAssetIndex(-1);
    setAssetChartTab('price');
    setPortfolioChartTab('equity');
  }, [sessionId]);

  // When switching from multi-asset portfolio view to an asset view, default to Price tab
  useEffect(() => {
    if (selectedAsset) {
      setAssetChartTab('price');
    }
  }, [selectedAsset?.symbol]);

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

  // Determine which snapshot set to use for equity/drawdown charts in asset view.
  // For a specific selected asset we still use the overall session equity snapshots
  // (we don't have per-asset snapshots in paper trading).
  const snapshots: PaperEquitySnapshot[] = equitySnapshots ?? [];

  // Asset chart tab definitions
  const assetTabs: { id: AssetChartTab; label: string }[] = [
    { id: 'price', label: 'Price' },
    { id: 'equity', label: 'Equity' },
    { id: 'drawdown', label: 'Drawdown' },
    { id: 'stats', label: 'Stats' },
  ];

  // Portfolio chart tab definitions
  const portfolioTabs: { id: PortfolioChartTab; label: string }[] = [
    { id: 'equity', label: 'Equity' },
    { id: 'drawdown', label: 'Drawdown' },
    { id: 'stats', label: 'Stats' },
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
          <>
            <ChartTabBar
              tabs={assetTabs}
              active={assetChartTab}
              onChange={setAssetChartTab}
            />
            {assetChartTab === 'price' && (
              assetCandles && assetCandles.length > 0 ? (
                <Chart
                  candles={assetCandles}
                  trades={displayedBacktestTrades}
                  height={450}
                  isFutures={isFutures}
                  backtestTimeframe={activeAsset!.timeframe as Timeframe}
                  exchange={activeAsset!.exchange}
                  symbol={activeAsset!.symbol}
                />
              ) : (
                <div className="h-[450px] bg-gray-800 rounded-lg flex items-center justify-center text-gray-500">
                  Loading candles for {activeAsset!.label}...
                </div>
              )
            )}
            {assetChartTab === 'equity' && (
              <PaperEquityChart snapshots={snapshots} height={450} />
            )}
            {assetChartTab === 'drawdown' && (
              <PaperDrawdownChart snapshots={snapshots} height={450} />
            )}
            {assetChartTab === 'stats' && (
              <StatsTab metrics={metrics} isFutures={isFutures} />
            )}
          </>
        ) : (
          <>
            <ChartTabBar
              tabs={portfolioTabs}
              active={portfolioChartTab}
              onChange={setPortfolioChartTab}
            />
            {portfolioChartTab === 'equity' && (
              <PaperEquityChart snapshots={snapshots} height={450} />
            )}
            {portfolioChartTab === 'drawdown' && (
              <PaperDrawdownChart snapshots={snapshots} height={450} />
            )}
            {portfolioChartTab === 'stats' && (
              <StatsTab metrics={metrics} isFutures={isFutures} />
            )}
          </>
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
