/**
 * TradingView Lightweight Charts wrapper component.
 * Displays candlestick chart with trade markers.
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

interface ChartProps {
  candles: Candle[];
  trades: Trade[];
  height?: number;
  isPolymarket?: boolean;
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

export function Chart({ candles, trades, height = 500, isPolymarket = false }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<CandlestickSeriesApi | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

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

    // Create candlestick series using v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartColors.upColor,
      downColor: chartColors.downColor,
      borderUpColor: chartColors.borderUpColor,
      borderDownColor: chartColors.borderDownColor,
      wickUpColor: chartColors.wickUpColor,
      wickDownColor: chartColors.wickDownColor,
      priceFormat: isPolymarket ? {
        type: 'custom',
        formatter: (price: number) => `${(price * 100).toFixed(1)}%`,
      } : undefined,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    // Create markers plugin
    const seriesMarkers = createSeriesMarkers(candleSeries, []);
    markersRef.current = seriesMarkers;

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
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const formattedCandles = formatCandles(candles);
    candleSeriesRef.current.setData(formattedCandles);

    // Fit content after data update
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  // Update trade markers
  useEffect(() => {
    if (!markersRef.current) return;

    if (trades.length === 0) {
      markersRef.current.setMarkers([]);
      return;
    }

    const markers: SeriesMarker<Time>[] = trades.map((trade) => {
      const isOpen = trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT';
      const isLong = trade.action === 'OPEN_LONG' || trade.action === 'CLOSE_LONG';
      const pnl = trade.pnl ?? 0;
      const pnlPercent = trade.pnlPercent ?? 0;

      if (isOpen) {
        // Open trade marker
        return {
          time: toChartTime(trade.timestamp),
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? '#3B82F6' : '#F97316', // blue for long, orange for short
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: isLong ? 'LONG' : 'SHORT',
        } as SeriesMarker<Time>;
      } else {
        // Close trade marker with PnL
        return {
          time: toChartTime(trade.timestamp),
          position: pnl >= 0 ? 'aboveBar' : 'belowBar',
          color: pnl >= 0 ? '#22C55E' : '#EF4444',
          shape: 'circle',
          text: `${pnl >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
        } as SeriesMarker<Time>;
      }
    });

    // Sort markers by time
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    markersRef.current.setMarkers(markers);
  }, [trades]);

  // Update chart height
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

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

      {/* Chart container */}
      <div ref={containerRef} style={{ height }} />

      {/* Empty state */}
      {candles.length === 0 && (
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
            <p>Run a backtest to see chart data</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chart;
