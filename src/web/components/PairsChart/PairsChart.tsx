/**
 * Dual TradingView Lightweight Charts component for pairs trading.
 * Displays two synchronized candlestick charts side by side.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type Time,
  type SeriesMarker,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
} from 'lightweight-charts';
import type { Candle, Trade } from '../../types';

interface PairsChartProps {
  candlesA: Candle[];
  candlesB: Candle[];
  trades: Trade[];
  symbolA: string;
  symbolB: string;
  height?: number;
}

// Convert timestamp to TradingView time format
function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

// Convert candles to chart format
function formatCandles(candles: Candle[]): CandlestickData<Time>[] {
  return candles.map((candle) => ({
    time: toChartTime(candle.timestamp),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

// Chart color configuration for dark theme
const chartColors = {
  background: '#111827', // gray-900
  textColor: '#9CA3AF', // gray-400
  gridColor: '#1F2937', // gray-800
  upColor: '#22C55E', // green-500
  downColor: '#EF4444', // red-500
  borderUpColor: '#16A34A', // green-600
  borderDownColor: '#DC2626', // red-600
  wickUpColor: '#22C55E',
  wickDownColor: '#EF4444',
};

type CandlestickSeriesApi = ISeriesApi<'Candlestick'>;

export function PairsChart({
  candlesA,
  candlesB,
  trades,
  symbolA,
  symbolB,
  height = 500,
}: PairsChartProps) {
  const containerARef = useRef<HTMLDivElement>(null);
  const containerBRef = useRef<HTMLDivElement>(null);
  const chartARef = useRef<IChartApi | null>(null);
  const chartBRef = useRef<IChartApi | null>(null);
  const candleSeriesARef = useRef<CandlestickSeriesApi | null>(null);
  const candleSeriesBRef = useRef<CandlestickSeriesApi | null>(null);
  const markersARef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersBRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const isSyncingRef = useRef(false);

  // Create charts on mount
  useEffect(() => {
    if (!containerARef.current || !containerBRef.current) return;

    const chartOptions: any = {
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
    };

    const seriesOptions = {
      upColor: chartColors.upColor,
      downColor: chartColors.downColor,
      borderUpColor: chartColors.borderUpColor,
      borderDownColor: chartColors.borderDownColor,
      wickUpColor: chartColors.wickUpColor,
      wickDownColor: chartColors.wickDownColor,
    };

    // Create chart A
    const chartA = createChart(containerARef.current, chartOptions);
    const candleSeriesA = chartA.addSeries(CandlestickSeries, seriesOptions);
    chartARef.current = chartA;
    candleSeriesARef.current = candleSeriesA;
    markersARef.current = createSeriesMarkers(candleSeriesA, []);

    // Create chart B
    const chartB = createChart(containerBRef.current, chartOptions);
    const candleSeriesB = chartB.addSeries(CandlestickSeries, seriesOptions);
    chartBRef.current = chartB;
    candleSeriesBRef.current = candleSeriesB;
    markersBRef.current = createSeriesMarkers(candleSeriesB, []);

    // Synchronize chart scrolling and zooming
    const syncCharts = (sourceChart: IChartApi, targetChart: IChartApi) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;

      const sourceRange = sourceChart.timeScale().getVisibleLogicalRange();
      if (sourceRange) {
        targetChart.timeScale().setVisibleLogicalRange(sourceRange);
      }

      isSyncingRef.current = false;
    };

    const handleChartASync = () => syncCharts(chartA, chartB);
    const handleChartBSync = () => syncCharts(chartB, chartA);

    chartA.timeScale().subscribeVisibleLogicalRangeChange(handleChartASync);
    chartB.timeScale().subscribeVisibleLogicalRangeChange(handleChartBSync);

    // Handle resize
    const handleResize = () => {
      if (containerARef.current && chartARef.current) {
        chartARef.current.applyOptions({
          width: containerARef.current.clientWidth,
        });
      }
      if (containerBRef.current && chartBRef.current) {
        chartBRef.current.applyOptions({
          width: containerBRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chartA.timeScale().unsubscribeVisibleLogicalRangeChange(handleChartASync);
      chartB.timeScale().unsubscribeVisibleLogicalRangeChange(handleChartBSync);
      chartA.remove();
      chartB.remove();
      chartARef.current = null;
      chartBRef.current = null;
      candleSeriesARef.current = null;
      candleSeriesBRef.current = null;
      markersARef.current = null;
      markersBRef.current = null;
    };
  }, []);

  // Update candle data for chart A
  useEffect(() => {
    if (!candleSeriesARef.current || candlesA.length === 0) return;

    const formattedCandles = formatCandles(candlesA);
    candleSeriesARef.current.setData(formattedCandles);

    // Fit content after data update
    if (chartARef.current) {
      chartARef.current.timeScale().fitContent();
    }
  }, [candlesA]);

  // Update candle data for chart B
  useEffect(() => {
    if (!candleSeriesBRef.current || candlesB.length === 0) return;

    const formattedCandles = formatCandles(candlesB);
    candleSeriesBRef.current.setData(formattedCandles);

    // Fit content after data update
    if (chartBRef.current) {
      chartBRef.current.timeScale().fitContent();
    }
  }, [candlesB]);

  // Update trade markers - split by symbol
  useEffect(() => {
    if (!markersARef.current || !markersBRef.current) return;

    if (trades.length === 0) {
      markersARef.current.setMarkers([]);
      markersBRef.current.setMarkers([]);
      return;
    }

    const markersA: SeriesMarker<Time>[] = [];
    const markersB: SeriesMarker<Time>[] = [];

    trades.forEach((trade) => {
      const isOpen = trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT';
      const isLong = trade.action === 'OPEN_LONG' || trade.action === 'CLOSE_LONG';
      const pnl = trade.pnl ?? 0;
      const pnlPercent = trade.pnlPercent ?? 0;

      const marker: SeriesMarker<Time> = isOpen
        ? {
            time: toChartTime(trade.timestamp),
            position: isLong ? 'belowBar' : 'aboveBar',
            color: isLong ? '#3B82F6' : '#F97316', // blue for long, orange for short
            shape: isLong ? 'arrowUp' : 'arrowDown',
            text: isLong ? 'LONG' : 'SHORT',
          }
        : {
            time: toChartTime(trade.timestamp),
            position: pnl >= 0 ? 'aboveBar' : 'belowBar',
            color: pnl >= 0 ? '#22C55E' : '#EF4444',
            shape: 'circle',
            text: `${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
          };

      // Add marker to the appropriate chart based on symbol
      if (trade.symbol === symbolA) {
        markersA.push(marker);
      } else if (trade.symbol === symbolB) {
        markersB.push(marker);
      }
    });

    // Sort markers by time
    markersA.sort((a, b) => (a.time as number) - (b.time as number));
    markersB.sort((a, b) => (a.time as number) - (b.time as number));

    markersARef.current.setMarkers(markersA);
    markersBRef.current.setMarkers(markersB);
  }, [trades, symbolA, symbolB]);

  // Update chart heights
  useEffect(() => {
    if (chartARef.current) {
      chartARef.current.applyOptions({ height });
    }
    if (chartBRef.current) {
      chartBRef.current.applyOptions({ height });
    }
  }, [height]);

  // Zoom controls (both charts)
  const handleZoomIn = useCallback(() => {
    if (!chartARef.current) return;
    const timeScale = chartARef.current.timeScale();
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
    if (!chartARef.current) return;
    const timeScale = chartARef.current.timeScale();
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
    if (chartARef.current) {
      chartARef.current.timeScale().fitContent();
    }
    if (chartBRef.current) {
      chartBRef.current.timeScale().fitContent();
    }
  }, []);

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      {/* Chart toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
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

      {/* Two-column chart layout */}
      <div className="grid grid-cols-2 gap-px bg-gray-700">
        <div className="bg-gray-900">
          <div className="px-3 py-2 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300">{symbolA}</h3>
          </div>
          <div ref={containerARef} style={{ height }} />
        </div>
        <div className="bg-gray-900">
          <div className="px-3 py-2 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300">{symbolB}</h3>
          </div>
          <div ref={containerBRef} style={{ height }} />
        </div>
      </div>

      {/* Empty state */}
      {candlesA.length === 0 && candlesB.length === 0 && (
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
            <p>Run a pairs backtest to see chart data</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PairsChart;
