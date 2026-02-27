/**
 * Drawdown chart for paper trading — visualises underwater equity drawdown
 * as a percentage from the running peak.
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  CrosshairMode,
  AreaSeries,
} from 'lightweight-charts';
import type { PaperEquitySnapshot } from '../../types';

interface PaperDrawdownChartProps {
  snapshots: PaperEquitySnapshot[];
  height?: number;
}

function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

const chartColors = {
  background: '#111827', // gray-900
  textColor: '#9CA3AF',  // gray-400
  gridColor: '#1F2937',  // gray-800
};

/**
 * Compute per-snapshot drawdown percentages from peak equity.
 * Returns negative values (e.g. -15 means -15% drawdown).
 */
function computeDrawdown(snapshots: PaperEquitySnapshot[]): { time: Time; value: number }[] {
  if (snapshots.length === 0) return [];

  let peak = snapshots[0].equity;
  return snapshots.map((s) => {
    if (s.equity > peak) peak = s.equity;
    const dd = peak > 0 ? ((s.equity - peak) / peak) * 100 : 0;
    return { time: toChartTime(s.timestamp), value: dd };
  });
}

export function PaperDrawdownChart({ snapshots, height = 250 }: PaperDrawdownChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

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
        scaleMargins: { top: 0.05, bottom: 0.05 },
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

    const drawdownSeries = chart.addSeries(AreaSeries, {
      lineColor: '#EF4444',      // red-500
      topColor: 'transparent',
      bottomColor: 'rgba(239, 68, 68, 0.3)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => `${price.toFixed(2)}%`,
      },
    });

    chartRef.current = chart;
    seriesRef.current = drawdownSeries;

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

    const data = computeDrawdown(snapshots);
    seriesRef.current.setData(data);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [snapshots]);

  // Compute max drawdown for label
  let maxDd = 0;
  if (snapshots.length > 0) {
    let peak = snapshots[0].equity;
    for (const s of snapshots) {
      if (s.equity > peak) peak = s.equity;
      const dd = peak > 0 ? ((s.equity - peak) / peak) * 100 : 0;
      if (dd < maxDd) maxDd = dd;
    }
  }

  return (
    <div className="relative rounded-lg bg-gray-900 border border-gray-700 overflow-hidden">
      {snapshots.length > 0 && (
        <div className="absolute top-2 left-3 z-10 flex items-center gap-3 pointer-events-none">
          <span className="text-xs text-gray-400">
            Max Drawdown:{' '}
            <span className="text-red-400 font-medium">{maxDd.toFixed(2)}%</span>
          </span>
        </div>
      )}
      <div ref={containerRef} style={{ height }} />
      {snapshots.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-500 text-sm">No equity data yet</p>
        </div>
      )}
    </div>
  );
}

export default PaperDrawdownChart;
