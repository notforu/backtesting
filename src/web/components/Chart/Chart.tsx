/**
 * TradingView Lightweight Charts wrapper component.
 * Displays candlestick chart with trade markers.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useResolutionCandles, useFundingRates } from '../../hooks/useBacktest';
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
  HistogramSeries,
} from 'lightweight-charts';
import type { Candle, Trade } from '../../types';

interface ChartProps {
  candles: Candle[];
  trades: Trade[];
  height?: number;
  isPolymarket?: boolean;
  isFutures?: boolean;
  backtestTimeframe?: string;
  exchange?: string;
  symbol?: string;
  startDate?: number;
  endDate?: number;
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

function estimateCandles(start: number, end: number, timeframe: string): number {
  const diffMs = end - start;
  const tfMs: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000,
  };
  return Math.ceil(diffMs / (tfMs[timeframe] ?? 3600000));
}

export function Chart({ candles, trades, height = 500, isPolymarket = false, isFutures = false, backtestTimeframe, exchange, symbol, startDate, endDate }: ChartProps) {
  const [displayTimeframe, setDisplayTimeframe] = useState<string | null>(null);
  const [showFundingRate, setShowFundingRate] = useState(false);
  const [chartWindowStart, setChartWindowStart] = useState<number | null>(null);
  const [chartWindowEnd, setChartWindowEnd] = useState<number | null>(null);
  const [showDateRangeSelector, setShowDateRangeSelector] = useState(false);

  const needsDateLimiter = displayTimeframe === '1m' || displayTimeframe === '5m';
  const effectiveStart = needsDateLimiter && chartWindowStart ? chartWindowStart : startDate;
  const effectiveEnd = needsDateLimiter && chartWindowEnd ? chartWindowEnd : endDate;

  // Fetch candles at selected resolution
  const resolutionParams = displayTimeframe && exchange && symbol && effectiveStart && effectiveEnd ? {
    exchange,
    symbol,
    timeframe: displayTimeframe,
    startDate: new Date(effectiveStart).toISOString(),
    endDate: new Date(effectiveEnd).toISOString(),
  } : null;

  const { data: resolutionCandles, isLoading: isLoadingResolution } = useResolutionCandles(resolutionParams);

  // Fetch funding rates when in futures mode
  const fundingRateParams = isFutures && exchange && symbol && startDate && endDate ? {
    exchange,
    symbol,
    start: startDate,
    end: endDate,
  } : null;
  const { data: fundingRates } = useFundingRates(fundingRateParams);

  // Use resolution candles if available, otherwise use backtest candles
  const displayCandles = displayTimeframe && resolutionCandles ? resolutionCandles : candles;

  // Available timeframes
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<CandlestickSeriesApi | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const frSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

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
      frSeriesRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || displayCandles.length === 0) return;

    const formattedCandles = formatCandles(displayCandles);
    candleSeriesRef.current.setData(formattedCandles);

    // Fit content after data update
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [displayCandles]);

  // Reset resolution when backtest changes
  useEffect(() => {
    setDisplayTimeframe(null);
    setShowDateRangeSelector(false);
    setChartWindowStart(null);
    setChartWindowEnd(null);
  }, [backtestTimeframe, symbol]);

  // Auto-show funding rate histogram in futures mode
  useEffect(() => {
    if (isFutures) {
      setShowFundingRate(true);
    } else {
      setShowFundingRate(false);
    }
  }, [isFutures]);

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

  // Funding rate histogram toggle
  useEffect(() => {
    if (!chartRef.current) return;

    if (showFundingRate && fundingRates && fundingRates.length > 0) {
      if (!frSeriesRef.current) {
        const frSeries = chartRef.current.addSeries(HistogramSeries, {
          priceScaleId: 'funding-rate',
          priceFormat: {
            type: 'custom',
            formatter: (price: number) => `${(price * 100).toFixed(4)}%`,
          },
        });

        chartRef.current.priceScale('funding-rate').applyOptions({
          scaleMargins: { top: 0.75, bottom: 0.02 },
          borderVisible: false,
        });

        // Push candles up to make room for FR histogram at bottom
        chartRef.current.priceScale('right').applyOptions({
          scaleMargins: { top: 0.05, bottom: 0.28 },
        });

        frSeriesRef.current = frSeries;
      }

      // Set FR data with per-bar green/red coloring
      const frData = fundingRates.map((fr) => ({
        time: (fr.timestamp / 1000) as Time,
        value: fr.fundingRate,
        color: fr.fundingRate >= 0 ? '#22C55E' : '#EF4444',
      }));
      frSeriesRef.current.setData(frData);
    } else {
      if (frSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(frSeriesRef.current);
        frSeriesRef.current = null;
      }
      // Restore candle price scale
      if (chartRef.current) {
        chartRef.current.priceScale('right').applyOptions({
          scaleMargins: { top: 0.1, bottom: 0.1 },
        });
      }
    }
  }, [showFundingRate, fundingRates]);

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
      {/* Resolution selector */}
      {backtestTimeframe && candles.length > 0 && (
        <div className="absolute top-2 left-2 z-10 flex gap-0.5 bg-gray-800/90 rounded p-0.5">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => {
                const newTf = tf === backtestTimeframe && !displayTimeframe ? null :
                  tf === displayTimeframe ? null : tf;
                setDisplayTimeframe(newTf);

                if (newTf === '1m' && endDate && startDate) {
                  const sevenDays = 7 * 24 * 60 * 60 * 1000;
                  setChartWindowStart(Math.max(startDate, endDate - sevenDays));
                  setChartWindowEnd(endDate);
                  setShowDateRangeSelector(true);
                } else if (newTf === '5m' && endDate && startDate) {
                  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                  setChartWindowStart(Math.max(startDate, endDate - thirtyDays));
                  setChartWindowEnd(endDate);
                  setShowDateRangeSelector(true);
                } else {
                  setShowDateRangeSelector(false);
                  setChartWindowStart(null);
                  setChartWindowEnd(null);
                }
              }}
              className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                (displayTimeframe === tf || (!displayTimeframe && tf === backtestTimeframe))
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              } ${tf === backtestTimeframe ? 'font-bold' : ''}`}
            >
              {tf}
            </button>
          ))}
          {isLoadingResolution && (
            <div className="flex items-center px-1">
              <svg className="animate-spin h-3 w-3 text-primary-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Date range selector for high-resolution timeframes */}
      {showDateRangeSelector && startDate && endDate && (
        <div className="absolute top-10 left-2 z-10 flex items-center gap-2 bg-gray-800/95 rounded p-2 text-xs">
          <span className="text-gray-400">Window:</span>
          <input
            type="date"
            value={chartWindowStart ? new Date(chartWindowStart).toISOString().split('T')[0] : ''}
            min={new Date(startDate).toISOString().split('T')[0]}
            max={chartWindowEnd ? new Date(chartWindowEnd).toISOString().split('T')[0] : new Date(endDate).toISOString().split('T')[0]}
            onChange={(e) => setChartWindowStart(new Date(e.target.value).getTime())}
            className="bg-gray-700 text-white rounded px-1.5 py-0.5 text-xs border border-gray-600"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={chartWindowEnd ? new Date(chartWindowEnd).toISOString().split('T')[0] : ''}
            min={chartWindowStart ? new Date(chartWindowStart).toISOString().split('T')[0] : new Date(startDate).toISOString().split('T')[0]}
            max={new Date(endDate).toISOString().split('T')[0]}
            onChange={(e) => setChartWindowEnd(new Date(e.target.value).getTime())}
            className="bg-gray-700 text-white rounded px-1.5 py-0.5 text-xs border border-gray-600"
          />
          {/* Quick presets */}
          <div className="flex gap-0.5 ml-1">
            {['7d', '30d', '90d'].map((preset) => {
              const days = parseInt(preset);
              const presetStart = Math.max(startDate, endDate - days * 24 * 60 * 60 * 1000);
              const isActive = chartWindowStart === presetStart && chartWindowEnd === endDate;
              return (
                <button
                  key={preset}
                  onClick={() => {
                    setChartWindowStart(presetStart);
                    setChartWindowEnd(endDate);
                  }}
                  className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                    isActive ? 'bg-primary-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
          {/* Candle count estimate */}
          {chartWindowStart && chartWindowEnd && (
            <span className={`text-xs ml-1 ${
              estimateCandles(chartWindowStart, chartWindowEnd, displayTimeframe ?? '1m') > 50000
                ? 'text-amber-400' : 'text-gray-500'
            }`}>
              ~{estimateCandles(chartWindowStart, chartWindowEnd, displayTimeframe ?? '1m').toLocaleString()} candles
            </span>
          )}
        </div>
      )}

      {/* Chart toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {isFutures && (
          <button
            onClick={() => setShowFundingRate(!showFundingRate)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              showFundingRate
                ? 'bg-amber-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title="Toggle Funding Rate overlay"
          >
            FR
          </button>
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
