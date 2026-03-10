/**
 * PaperChartSection — equity/drawdown chart section for portfolio view,
 * and price chart for per-asset view.
 */

import { PaperEquityChart } from '../PaperTradingPanel/PaperEquityChart';
import { Chart } from '../Chart';
import { PaperDrawdownChart } from './PaperDrawdownChart';
import type { SessionEvent, ActiveLevel } from '../Chart/Chart';
import type { Timeframe, PaperEquitySnapshot, Candle, Trade } from '../../types';

// ============================================================================
// TIMEFRAME_MS — milliseconds per timeframe bar
// ============================================================================

export const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
};

// ============================================================================
// Equity snapshot resampler — thin data to selected time bucket
// ============================================================================

export function resampleSnapshots(
  snapshots: PaperEquitySnapshot[],
  resolution: string,
): PaperEquitySnapshot[] {
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
// Chart tab types and tab bar component
// ============================================================================

export type PortfolioChartTab = 'equity' | 'drawdown';

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
// Asset info shape (subset used by the chart section)
// ============================================================================

interface AssetInfo {
  symbol: string;
  timeframe: string;
  label: string;
  exchange: string;
}

// ============================================================================
// PaperChartSection props
// ============================================================================

interface PaperChartSectionProps {
  /** Whether we show per-asset price chart (true) or portfolio equity/drawdown chart (false) */
  isAssetView: boolean;
  isMultiAsset: boolean;
  activeAsset: AssetInfo | null;
  chartCandles: Candle[] | null | undefined;
  displayedBacktestTrades: Trade[];
  snapshots: PaperEquitySnapshot[];
  portfolioChartTab: PortfolioChartTab;
  onPortfolioChartTabChange: (tab: PortfolioChartTab) => void;
  equityResolution: string;
  onEquityResolutionChange: (resolution: string) => void;
  isFutures: boolean;
  sessionCreatedAt: number;
  sessionEvents: SessionEvent[] | undefined;
  frThresholds: { short: number | undefined; long: number | undefined };
  activeLevels: ActiveLevel[];
}

const PORTFOLIO_TABS: { id: PortfolioChartTab; label: string }[] = [
  { id: 'equity', label: 'Equity' },
  { id: 'drawdown', label: 'Drawdown' },
];

const RESOLUTION_OPTIONS = ['All', '1h', '4h', '1d', '1w'];

export function PaperChartSection({
  isAssetView,
  isMultiAsset,
  activeAsset,
  chartCandles,
  displayedBacktestTrades,
  snapshots,
  portfolioChartTab,
  onPortfolioChartTabChange,
  equityResolution,
  onEquityResolutionChange,
  isFutures,
  sessionCreatedAt,
  sessionEvents,
  frThresholds,
  activeLevels,
}: PaperChartSectionProps) {
  const sectionTitle = isAssetView
    ? `${activeAsset!.label} (${activeAsset!.timeframe})`
    : isMultiAsset
      ? 'Portfolio'
      : 'Equity Curve';

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-gray-400">{sectionTitle}</h3>
      </div>

      {isAssetView ? (
        // Asset selected: show price chart only
        chartCandles && chartCandles.length > 0 ? (
          <Chart
            candles={chartCandles}
            trades={displayedBacktestTrades}
            height={450}
            isFutures={isFutures}
            backtestTimeframe={activeAsset!.timeframe as Timeframe}
            exchange={activeAsset!.exchange}
            symbol={activeAsset!.symbol}
            startDate={sessionCreatedAt}
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
        // Portfolio view: equity or drawdown chart with tabs
        <>
          <ChartTabBar
            tabs={PORTFOLIO_TABS}
            active={portfolioChartTab}
            onChange={onPortfolioChartTabChange}
          />
          {(portfolioChartTab === 'equity' || portfolioChartTab === 'drawdown') && (
            <div className="flex items-center gap-1 mb-2">
              <span className="text-xs text-gray-500 mr-1">Resolution:</span>
              {RESOLUTION_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => onEquityResolutionChange(r)}
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
            <PaperEquityChart
              snapshots={resampleSnapshots(snapshots, equityResolution)}
              height={450}
            />
          )}
          {portfolioChartTab === 'drawdown' && (
            <PaperDrawdownChart
              snapshots={resampleSnapshots(snapshots, equityResolution)}
              height={450}
            />
          )}
        </>
      )}
    </section>
  );
}
