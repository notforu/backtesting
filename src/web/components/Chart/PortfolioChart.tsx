/**
 * Portfolio equity curve chart for multi-asset backtests.
 * Displays portfolio equity as a line series with overlay metrics.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  CrosshairMode,
  LineSeries,
  AreaSeries,
} from 'lightweight-charts';
import type { EquityPoint, RollingMetrics, Trade } from '../../types';

interface PortfolioChartProps {
  equity: EquityPoint[];
  rollingMetrics?: RollingMetrics;
  trades: Trade[];
  height?: number;
}

// Convert millisecond timestamp to TradingView time format
function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

// Downsample equity points by picking the last point in each time bucket
function downsampleEquity(equity: EquityPoint[], resolution: string): EquityPoint[] {
  if (equity.length === 0) return equity;

  const bucketMs: Record<string, number> = {
    '1h': 3600000,
    '4h': 14400000,
    '1d': 86400000,
    '1w': 604800000,
  };

  const bucket = bucketMs[resolution];
  if (!bucket) return equity;

  const result: EquityPoint[] = [];
  let currentBucket = -1;

  for (const point of equity) {
    const b = Math.floor(point.timestamp / bucket);
    if (b !== currentBucket) {
      result.push(point);
      currentBucket = b;
    } else {
      result[result.length - 1] = point;
    }
  }

  return result;
}

// Chart color configuration - matches Chart.tsx dark theme
const chartColors = {
  background: '#111827', // gray-900
  textColor: '#9CA3AF',  // gray-400
  gridColor: '#1F2937',  // gray-800
};

export function PortfolioChart({ equity, rollingMetrics, height = 450 }: PortfolioChartProps) {
  const [resolution, setResolution] = useState<'1h' | '4h' | '1d' | '1w'>('4h');
  const [showROI, setShowROI] = useState(false);
  const [showDrawdown, setShowDrawdown] = useState(false);
  const [showSharpe, setShowSharpe] = useState(false);
  const [showWinRate, setShowWinRate] = useState(false);
  const [tooltipData, setTooltipData] = useState<{
    visible: boolean;
    x: number;
    y: number;
    time: string;
    equity?: number;
    roi?: number;
    drawdown?: number;
    sharpe?: number;
    winRate?: number;
  } | null>(null);

  const displayEquity = useMemo(() => downsampleEquity(equity, resolution), [equity, resolution]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const equitySeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const roiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ddSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const sharpeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const winRateSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Whether any overlay is active (for price scale margin adjustments)
  const hasAnyOverlay = showROI || showDrawdown || showSharpe || showWinRate;

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: chartColors.background },
        textColor: chartColors.textColor,
      },
      grid: {
        vertLines: { color: chartColors.gridColor },
        horzLines: { color: chartColors.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#4B5563',
          width: 1,
          style: 2,
          labelBackgroundColor: '#374151',
        },
        horzLine: {
          color: '#4B5563',
          width: 1,
          style: 2,
          labelBackgroundColor: '#374151',
        },
      },
      rightPriceScale: {
        borderColor: chartColors.gridColor,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: chartColors.gridColor,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Create equity line series using v5 API
    const equitySeries = chart.addSeries(LineSeries, {
      color: '#10B981', // emerald-500
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) =>
          `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      },
    });

    chartRef.current = chart;
    equitySeriesRef.current = equitySeries;

    // Subscribe to crosshair move for tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setTooltipData(null);
        return;
      }

      const equityData = param.seriesData.get(equitySeries);
      const roiData = roiSeriesRef.current ? param.seriesData.get(roiSeriesRef.current) : undefined;
      const ddData = ddSeriesRef.current ? param.seriesData.get(ddSeriesRef.current) : undefined;
      const sharpeData = sharpeSeriesRef.current ? param.seriesData.get(sharpeSeriesRef.current) : undefined;
      const wrData = winRateSeriesRef.current ? param.seriesData.get(winRateSeriesRef.current) : undefined;

      const timestamp = (param.time as number) * 1000;
      const date = new Date(timestamp);
      const timeStr = date.toLocaleString();

      setTooltipData({
        visible: true,
        x: param.point.x,
        y: param.point.y,
        time: timeStr,
        equity: equityData && 'value' in equityData ? (equityData as { value: number }).value : undefined,
        roi: roiData && 'value' in roiData ? (roiData as { value: number }).value : undefined,
        drawdown: ddData && 'value' in ddData ? (ddData as { value: number }).value : undefined,
        sharpe: sharpeData && 'value' in sharpeData ? (sharpeData as { value: number }).value : undefined,
        winRate: wrData && 'value' in wrData ? (wrData as { value: number }).value : undefined,
      });
    });

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      roiSeriesRef.current = null;
      ddSeriesRef.current = null;
      sharpeSeriesRef.current = null;
      winRateSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
      equitySeriesRef.current = null;
    };
  }, []);

  // Update equity data (use downsampled data)
  useEffect(() => {
    if (!equitySeriesRef.current || displayEquity.length === 0) return;

    const data = displayEquity.map((pt) => ({
      time: toChartTime(pt.timestamp),
      value: pt.equity,
    }));
    equitySeriesRef.current.setData(data);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [displayEquity]);

  // Update chart height
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  // Adjust equity price scale margins when overlays are active
  useEffect(() => {
    if (!chartRef.current) return;
    if (hasAnyOverlay) {
      chartRef.current.priceScale('right').applyOptions({
        scaleMargins: { top: 0.05, bottom: 0.28 },
      });
    } else {
      chartRef.current.priceScale('right').applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });
    }
  }, [hasAnyOverlay]);

  // ROI overlay
  useEffect(() => {
    if (!chartRef.current || !rollingMetrics) return;

    if (showROI && rollingMetrics.timestamps.length > 0) {
      if (!roiSeriesRef.current) {
        roiSeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: '#3B82F6',
          lineWidth: 1,
          priceScaleId: 'overlay-roi',
          priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
          lastValueVisible: false,
        });
        chartRef.current.priceScale('overlay-roi').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.02 },
          borderVisible: false,
        });
      }
      roiSeriesRef.current.setData(
        rollingMetrics.timestamps.map((t, i) => ({
          time: (t / 1000) as Time,
          value: rollingMetrics.cumulativeReturn[i],
        }))
      );
    } else {
      if (roiSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(roiSeriesRef.current);
        roiSeriesRef.current = null;
      }
    }
  }, [showROI, rollingMetrics]);

  // Drawdown overlay
  useEffect(() => {
    if (!chartRef.current || !rollingMetrics) return;

    if (showDrawdown && rollingMetrics.timestamps.length > 0) {
      if (!ddSeriesRef.current) {
        ddSeriesRef.current = chartRef.current.addSeries(AreaSeries, {
          topColor: 'rgba(239, 68, 68, 0.0)',
          bottomColor: 'rgba(239, 68, 68, 0.3)',
          lineColor: '#EF4444',
          lineWidth: 1,
          priceScaleId: 'overlay-dd',
          priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
          lastValueVisible: false,
          invertFilledArea: true,
        });
        chartRef.current.priceScale('overlay-dd').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.02 },
          borderVisible: false,
        });
      }
      ddSeriesRef.current.setData(
        rollingMetrics.timestamps.map((t, i) => ({
          time: (t / 1000) as Time,
          value: -Math.abs(rollingMetrics.drawdown[i]),
        }))
      );
    } else {
      if (ddSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(ddSeriesRef.current);
        ddSeriesRef.current = null;
      }
    }
  }, [showDrawdown, rollingMetrics]);

  // Sharpe overlay
  useEffect(() => {
    if (!chartRef.current || !rollingMetrics) return;

    if (showSharpe && rollingMetrics.timestamps.length > 0) {
      if (!sharpeSeriesRef.current) {
        sharpeSeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: '#8B5CF6',
          lineWidth: 1,
          priceScaleId: 'overlay-sharpe',
          priceFormat: { type: 'custom', formatter: (p: number) => p.toFixed(2) },
          lastValueVisible: false,
        });
        chartRef.current.priceScale('overlay-sharpe').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.02 },
          borderVisible: false,
        });
      }
      sharpeSeriesRef.current.setData(
        rollingMetrics.timestamps.map((t, i) => ({
          time: (t / 1000) as Time,
          value: rollingMetrics.rollingSharpe[i],
        }))
      );
    } else {
      if (sharpeSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(sharpeSeriesRef.current);
        sharpeSeriesRef.current = null;
      }
    }
  }, [showSharpe, rollingMetrics]);

  // Win rate overlay
  useEffect(() => {
    if (!chartRef.current || !rollingMetrics) return;

    if (showWinRate && rollingMetrics.timestamps.length > 0) {
      if (!winRateSeriesRef.current) {
        winRateSeriesRef.current = chartRef.current.addSeries(LineSeries, {
          color: '#F59E0B',
          lineWidth: 1,
          priceScaleId: 'overlay-wr',
          priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
          lastValueVisible: false,
        });
        chartRef.current.priceScale('overlay-wr').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.02 },
          borderVisible: false,
        });
      }
      winRateSeriesRef.current.setData(
        rollingMetrics.timestamps.map((t, i) => ({
          time: (t / 1000) as Time,
          value: rollingMetrics.cumulativeWinRate[i],
        }))
      );
    } else {
      if (winRateSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(winRateSeriesRef.current);
        winRateSeriesRef.current = null;
      }
    }
  }, [showWinRate, rollingMetrics]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (visibleRange) {
      const center = (visibleRange.from + visibleRange.to) / 2;
      const newRange = (visibleRange.to - visibleRange.from) * 0.5;
      timeScale.setVisibleLogicalRange({
        from: center - newRange / 2,
        to: center + newRange / 2,
      });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (visibleRange) {
      const center = (visibleRange.from + visibleRange.to) / 2;
      const newRange = (visibleRange.to - visibleRange.from) * 2;
      timeScale.setVisibleLogicalRange({
        from: center - newRange / 2,
        to: center + newRange / 2,
      });
    }
  }, []);

  const handleFitContent = useCallback(() => {
    if (!chartRef.current) return;
    chartRef.current.timeScale().fitContent();
  }, []);

  const hasRollingMetrics = rollingMetrics && rollingMetrics.timestamps.length > 0;

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      {/* Chart toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 items-center">
        {/* Resolution picker */}
        <span className="text-xs text-gray-500 mr-0.5">Res:</span>
        {(['1h', '4h', '1d', '1w'] as const).map(res => (
          <button
            key={res}
            onClick={() => setResolution(res)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              resolution === res ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title={`Set resolution to ${res}`}
          >
            {res}
          </button>
        ))}
        <div className="w-px h-4 bg-gray-700 mx-0.5" />
        {hasRollingMetrics && (
          <>
            <button
              onClick={() => setShowROI(!showROI)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showROI ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Toggle ROI overlay"
            >
              ROI
            </button>
            <button
              onClick={() => setShowDrawdown(!showDrawdown)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showDrawdown ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Toggle Drawdown overlay"
            >
              DD
            </button>
            <button
              onClick={() => setShowSharpe(!showSharpe)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showSharpe ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Toggle Rolling Sharpe overlay"
            >
              SR
            </button>
            <button
              onClick={() => setShowWinRate(!showWinRate)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showWinRate ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              title="Toggle Win Rate overlay"
            >
              WR
            </button>
          </>
        )}
        <button
          onClick={handleZoomIn}
          className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
          </svg>
        </button>
        <button
          onClick={handleFitContent}
          className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          title="Fit Content"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ height }} />

      {/* Crosshair Tooltip */}
      {tooltipData && tooltipData.visible && (
        <div
          className="absolute z-20 pointer-events-none bg-gray-800/95 border border-gray-600 rounded px-2.5 py-1.5 text-xs"
          style={{
            left: Math.min(tooltipData.x + 16, (containerRef.current?.clientWidth ?? 800) - 200),
            top: 8,
          }}
        >
          <div className="text-gray-400 mb-1">{tooltipData.time}</div>
          {tooltipData.equity !== undefined && (
            <div className="text-emerald-400 font-medium">
              Portfolio:{' '}
              <span className="text-white">
                ${tooltipData.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {(tooltipData.roi !== undefined || tooltipData.drawdown !== undefined || tooltipData.sharpe !== undefined || tooltipData.winRate !== undefined) && (
            <div className="mt-1 border-t border-gray-700 pt-1 flex flex-wrap gap-x-3">
              {tooltipData.roi !== undefined && (
                <span><span className="text-gray-400">ROI </span><span className="text-blue-400">{tooltipData.roi.toFixed(1)}%</span></span>
              )}
              {tooltipData.drawdown !== undefined && (
                <span><span className="text-gray-400">DD </span><span className="text-red-400">{tooltipData.drawdown.toFixed(1)}%</span></span>
              )}
              {tooltipData.sharpe !== undefined && (
                <span><span className="text-gray-400">SR </span><span className="text-purple-400">{tooltipData.sharpe.toFixed(2)}</span></span>
              )}
              {tooltipData.winRate !== undefined && (
                <span><span className="text-gray-400">WR </span><span className="text-amber-400">{tooltipData.winRate.toFixed(1)}%</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {equity.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <svg
              className="w-16 h-16 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
              />
            </svg>
            <p>No equity data available</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PortfolioChart;
