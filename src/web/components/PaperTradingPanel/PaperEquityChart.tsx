/**
 * Small TradingView lightweight chart for paper trading equity curve.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  CrosshairMode,
  LineSeries,
} from 'lightweight-charts';
import type { PaperEquitySnapshot } from '../../types';

interface PaperEquityChartProps {
  snapshots: PaperEquitySnapshot[];
  height?: number;
}

// Convert millisecond timestamp to TradingView time format
function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

const chartColors = {
  background: '#111827', // gray-900
  textColor: '#9CA3AF',  // gray-400
  gridColor: '#1F2937',  // gray-800
};

export function PaperEquityChart({ snapshots, height = 250 }: PaperEquityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: chartColors.gridColor,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
    });

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
    seriesRef.current = equitySeries;

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
      seriesRef.current = null;
    };
  }, []);

  // Update chart height
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  // Update data when snapshots change
  useEffect(() => {
    if (!seriesRef.current || snapshots.length === 0) return;

    const data = snapshots.map((s) => ({
      time: toChartTime(s.timestamp),
      value: s.equity,
    }));
    seriesRef.current.setData(data);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [snapshots]);

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      <div ref={containerRef} style={{ height }} />
      {snapshots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-500 text-sm">No equity data yet</p>
        </div>
      )}
    </div>
  );
}

export default PaperEquityChart;
