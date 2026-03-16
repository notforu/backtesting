/**
 * Dashboard component displaying backtest performance metrics.
 * Shows key metrics in a card grid with color-coded values.
 */

import type { PerformanceMetrics } from '../../types';

interface DashboardProps {
  metrics: PerformanceMetrics | null;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  colorize?: 'profit' | 'none';
  isPositive?: boolean;
}

function MetricCard({
  label,
  value,
  subValue,
  colorize = 'none',
  isPositive,
}: MetricCardProps) {
  const getValueColor = () => {
    if (colorize === 'none') return 'text-white';
    if (isPositive === undefined) return 'text-white';
    return isPositive ? 'text-green-400' : 'text-red-400';
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-xl font-semibold ${getValueColor()}`}>{value}</p>
      {subValue && <p className="text-xs text-gray-500 mt-1">{subValue}</p>}
    </div>
  );
}

function formatNumber(value: number | undefined, decimals: number = 2): string {
  if (value === undefined || value === null || isNaN(value)) return 'N/A';
  return value.toFixed(decimals);
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) return 'N/A';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function formatCurrency(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) return 'N/A';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null || isNaN(ms)) return 'N/A';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function Dashboard({ metrics }: DashboardProps) {
  if (!metrics) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 border border-gray-700">
        <div className="text-center text-gray-500">
          <svg
            className="w-12 h-12 mx-auto mb-3 opacity-50"
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
          <p>Run a backtest to see performance metrics</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <h2 className="text-lg font-semibold text-white">Performance Metrics</h2>

      {/* Primary metrics - larger cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Return"
          value={formatPercent(metrics.totalReturnPercent)}
          subValue={formatCurrency(metrics.totalReturn)}
          colorize="profit"
          isPositive={metrics.totalReturn >= 0}
        />
        <MetricCard
          label="Max Drawdown"
          value={formatPercent(-Math.abs(metrics.maxDrawdownPercent))}
          subValue={formatCurrency(-Math.abs(metrics.maxDrawdown))}
          colorize="profit"
          isPositive={false}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={formatNumber(metrics.sharpeRatio)}
          colorize="profit"
          isPositive={metrics.sharpeRatio >= 1}
        />
        <MetricCard
          label="Win Rate"
          value={metrics.winRate !== undefined ? `${metrics.winRate.toFixed(1)}%` : 'N/A'}
          subValue={`${metrics.winningTrades ?? 0}W / ${metrics.losingTrades ?? 0}L`}
          colorize="profit"
          isPositive={(metrics.winRate ?? 0) >= 50}
        />
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Profit Factor"
          value={
            metrics.profitFactor === Infinity
              ? 'Inf'
              : formatNumber(metrics.profitFactor)
          }
          colorize="profit"
          isPositive={metrics.profitFactor >= 1}
        />
        <MetricCard
          label="Total Trades"
          value={metrics.totalTrades.toString()}
        />
        <MetricCard
          label="Avg Win"
          value={formatPercent(metrics.avgWinPercent)}
          subValue={formatCurrency(metrics.avgWin)}
          colorize="profit"
          isPositive={true}
        />
        <MetricCard
          label="Avg Loss"
          value={formatPercent(metrics.avgLossPercent)}
          subValue={formatCurrency(metrics.avgLoss)}
          colorize="profit"
          isPositive={false}
        />
        <MetricCard
          label="Expectancy"
          value={formatPercent(metrics.expectancyPercent)}
          subValue={formatCurrency(metrics.expectancy)}
          colorize="profit"
          isPositive={metrics.expectancy >= 0}
        />
        <MetricCard
          label="Sortino Ratio"
          value={formatNumber(metrics.sortinoRatio)}
          colorize="profit"
          isPositive={metrics.sortinoRatio >= 1}
        />
      </div>

      {/* Trade statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Largest Win"
          value={formatCurrency(metrics.largestWin)}
          colorize="profit"
          isPositive={true}
        />
        <MetricCard
          label="Largest Loss"
          value={formatCurrency(metrics.largestLoss)}
          colorize="profit"
          isPositive={false}
        />
        <MetricCard
          label="Execution Cost"
          value={`$${((metrics.totalFees ?? 0) + (metrics.totalSlippage ?? 0)).toFixed(2)}`}
          subValue={
            (metrics.totalSlippage ?? 0) > 0
              ? `Fees: $${(metrics.totalFees ?? 0).toFixed(2)} | Slippage: $${(metrics.totalSlippage ?? 0).toFixed(2)}`
              : undefined
          }
        />
        <MetricCard
          label="Avg Trade Duration"
          value={formatDuration(metrics.avgTradeDuration)}
        />
        <MetricCard
          label="Exposure Time"
          value={metrics.exposureTime !== undefined ? `${metrics.exposureTime.toFixed(1)}%` : 'N/A'}
        />
      </div>

      {/* Long/Short breakdown - only shown when data is present */}
      {metrics.longTrades !== undefined && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Long / Short Breakdown
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Long PnL"
              value={formatCurrency(metrics.longPnl)}
              subValue={`${metrics.longTrades ?? 0} trade${(metrics.longTrades ?? 0) !== 1 ? 's' : ''}`}
              colorize="profit"
              isPositive={(metrics.longPnl ?? 0) >= 0}
            />
            <MetricCard
              label="Short PnL"
              value={formatCurrency(metrics.shortPnl)}
              subValue={`${metrics.shortTrades ?? 0} trade${(metrics.shortTrades ?? 0) !== 1 ? 's' : ''}`}
              colorize="profit"
              isPositive={(metrics.shortPnl ?? 0) >= 0}
            />
            <MetricCard
              label="Long Win Rate"
              value={
                metrics.longWinRate !== undefined
                  ? `${metrics.longWinRate.toFixed(1)}%`
                  : 'N/A'
              }
              colorize="profit"
              isPositive={(metrics.longWinRate ?? 0) >= 50}
            />
            <MetricCard
              label="Short Win Rate"
              value={
                metrics.shortWinRate !== undefined
                  ? `${metrics.shortWinRate.toFixed(1)}%`
                  : 'N/A'
              }
              colorize="profit"
              isPositive={(metrics.shortWinRate ?? 0) >= 50}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
