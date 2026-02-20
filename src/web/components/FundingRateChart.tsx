/**
 * Dedicated Funding Rate chart component.
 * Displays funding rates as a histogram in a separate sub-chart below the main price chart.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  CrosshairMode,
  HistogramSeries,
} from 'lightweight-charts';

interface FundingRate {
  timestamp: number;
  fundingRate: number;
}

interface FundingRateChartProps {
  fundingRates: FundingRate[];
  height?: number;
  onChartReady?: (chart: IChartApi | null) => void;
}

// Convert timestamp to TradingView time format
function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

// Chart color configuration for dark theme
const chartColors = {
  background: '#111827', // gray-900
  textColor: '#9CA3AF', // gray-400
  gridColor: '#1F2937', // gray-800
  positiveColor: '#22C55E', // green-500 (positive FR = shorts earn)
  negativeColor: '#EF4444', // red-500 (negative FR = longs earn)
};

export function FundingRateChart({
  fundingRates,
  height = 120,
  onChartReady,
}: FundingRateChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

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
        visible: true,
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

    // Create histogram series for funding rates
    const histogramSeries = chart.addSeries(HistogramSeries, {
      color: chartColors.positiveColor,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${(price * 100).toFixed(4)}%`,
      },
    });

    chartRef.current = chart;
    seriesRef.current = histogramSeries;

    // Notify parent that chart is ready for imperative sync
    onChartReady?.(chart);

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
      onChartReady?.(null);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Update funding rate data
  useEffect(() => {
    if (!seriesRef.current || fundingRates.length === 0) return;

    // Convert funding rates to histogram data with color based on sign
    const histogramData = fundingRates.map((fr) => ({
      time: toChartTime(fr.timestamp),
      value: fr.fundingRate,
      color: fr.fundingRate >= 0 ? chartColors.positiveColor : chartColors.negativeColor,
    }));

    seriesRef.current.setData(histogramData);

    // Fit content after data update
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [fundingRates]);

  // Update chart height
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      {/* Chart label */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-gray-800/90 rounded px-2 py-1">
        <span className="text-xs font-medium text-gray-300">Funding Rate</span>
        <span className="text-xs text-gray-500">
          (Green = Shorts Earn, Red = Longs Earn)
        </span>
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ height }} />

      {/* Empty state */}
      {fundingRates.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <p className="text-xs">No funding rate data available</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default FundingRateChart;
