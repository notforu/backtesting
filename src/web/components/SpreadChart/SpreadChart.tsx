/**
 * Spread and Z-Score chart component for pairs trading.
 * Displays spread and z-score over time with entry/stop threshold lines.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  ColorType,
  CrosshairMode,
  LineSeries,
} from 'lightweight-charts';
import type { SpreadDataPoint } from '../../types';

interface SpreadChartProps {
  spreadData: SpreadDataPoint[];
  entryZScore?: number;
  stopZScore?: number;
  height?: number;
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
  spreadColor: '#3B82F6', // blue-500
  zScoreColor: '#F97316', // orange-500
  thresholdColor: '#6B7280', // gray-500
};

type LineSeriesApi = ISeriesApi<'Line'>;

export function SpreadChart({
  spreadData,
  entryZScore,
  stopZScore,
  height = 150,
}: SpreadChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const spreadSeriesRef = useRef<LineSeriesApi | null>(null);
  const zScoreSeriesRef = useRef<LineSeriesApi | null>(null);

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
      leftPriceScale: {
        borderColor: chartColors.gridColor,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
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

    // Create spread series (left axis)
    const spreadSeries = chart.addSeries(LineSeries, {
      color: chartColors.spreadColor,
      lineWidth: 2,
      title: 'Spread',
      priceScaleId: 'left',
    });

    // Create z-score series (right axis)
    const zScoreSeries = chart.addSeries(LineSeries, {
      color: chartColors.zScoreColor,
      lineWidth: 2,
      title: 'Z-Score',
      priceScaleId: 'right',
    });

    chartRef.current = chart;
    spreadSeriesRef.current = spreadSeries;
    zScoreSeriesRef.current = zScoreSeries;

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
      spreadSeriesRef.current = null;
      zScoreSeriesRef.current = null;
    };
  }, []);

  // Update spread and z-score data
  useEffect(() => {
    if (
      !spreadSeriesRef.current ||
      !zScoreSeriesRef.current ||
      spreadData.length === 0
    )
      return;

    const spreadLineData: LineData<Time>[] = spreadData.map((point) => ({
      time: toChartTime(point.timestamp),
      value: point.spread,
    }));

    const zScoreLineData: LineData<Time>[] = spreadData.map((point) => ({
      time: toChartTime(point.timestamp),
      value: point.zScore,
    }));

    spreadSeriesRef.current.setData(spreadLineData);
    zScoreSeriesRef.current.setData(zScoreLineData);

    // Add threshold lines on z-score series
    if (entryZScore !== undefined && zScoreSeriesRef.current) {
      // Entry thresholds
      zScoreSeriesRef.current.createPriceLine({
        price: entryZScore,
        color: chartColors.thresholdColor,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: 'Entry',
      });
      zScoreSeriesRef.current.createPriceLine({
        price: -entryZScore,
        color: chartColors.thresholdColor,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    if (stopZScore !== undefined && zScoreSeriesRef.current) {
      // Stop thresholds
      zScoreSeriesRef.current.createPriceLine({
        price: stopZScore,
        color: '#EF4444', // red
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop',
      });
      zScoreSeriesRef.current.createPriceLine({
        price: -stopZScore,
        color: '#EF4444',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop',
      });
    }

    // Fit content after data update
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [spreadData, entryZScore, stopZScore]);

  // Update chart height
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      {/* Chart header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Spread & Z-Score</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-blue-500" />
            <span className="text-gray-400">Spread</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-orange-500" />
            <span className="text-gray-400">Z-Score</span>
          </div>
        </div>
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ height }} />

      {/* Empty state */}
      {spreadData.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <p className="text-sm">No spread data available</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default SpreadChart;
