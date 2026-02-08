/**
 * Performance Evolution Charts
 * Tabbed chart panel showing how key metrics evolve over time
 */

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  type IChartApi,
  type Time,
  ColorType,
  CrosshairMode,
  LineSeries,
  AreaSeries,
} from 'lightweight-charts';
import type { EquityPoint, RollingMetrics } from '../../types';

interface PerformanceChartsProps {
  equity: EquityPoint[];
  rollingMetrics?: RollingMetrics;
}

type TabId = 'equity' | 'roi' | 'drawdown' | 'sharpe' | 'winrate';

const tabs: { id: TabId; label: string }[] = [
  { id: 'equity', label: 'Equity Curve' },
  { id: 'roi', label: 'ROI %' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'sharpe', label: 'Rolling Sharpe' },
  { id: 'winrate', label: 'Win Rate' },
];

const chartColors = {
  background: '#111827',
  textColor: '#9CA3AF',
  gridColor: '#1F2937',
};

function toChartTime(timestamp: number): Time {
  return (timestamp / 1000) as Time;
}

export function PerformanceCharts({ equity, rollingMetrics }: PerformanceChartsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('equity');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || equity.length === 0) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

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
        vertLine: { color: '#4B5563', width: 1, style: 2, labelBackgroundColor: '#374151' },
        horzLine: { color: '#4B5563', width: 1, style: 2, labelBackgroundColor: '#374151' },
      },
      rightPriceScale: {
        borderColor: chartColors.gridColor,
      },
      timeScale: {
        borderColor: chartColors.gridColor,
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 200,
    });

    chartRef.current = chart;

    // Render appropriate series based on active tab
    switch (activeTab) {
      case 'equity': {
        const series = chart.addSeries(LineSeries, {
          color: '#22C55E',
          lineWidth: 2,
          title: 'Equity ($)',
        });
        series.setData(equity.map(p => ({
          time: toChartTime(p.timestamp),
          value: p.equity,
        })));
        break;
      }

      case 'roi': {
        if (rollingMetrics) {
          const series = chart.addSeries(LineSeries, {
            color: '#3B82F6',
            lineWidth: 2,
            title: 'ROI %',
          });
          series.setData(rollingMetrics.timestamps.map((t, i) => ({
            time: toChartTime(t),
            value: rollingMetrics.cumulativeReturn[i],
          })));
        }
        break;
      }

      case 'drawdown': {
        if (rollingMetrics) {
          const series = chart.addSeries(AreaSeries, {
            topColor: 'rgba(239, 68, 68, 0.4)',
            bottomColor: 'rgba(239, 68, 68, 0.0)',
            lineColor: '#EF4444',
            lineWidth: 2,
            title: 'Drawdown %',
            invertFilledArea: true,
          });
          // Negate values so drawdown shows below zero
          series.setData(rollingMetrics.timestamps.map((t, i) => ({
            time: toChartTime(t),
            value: -Math.abs(rollingMetrics.drawdown[i]),
          })));
        }
        break;
      }

      case 'sharpe': {
        if (rollingMetrics) {
          const series = chart.addSeries(LineSeries, {
            color: '#8B5CF6',
            lineWidth: 2,
            title: 'Sharpe Ratio',
          });
          series.setData(rollingMetrics.timestamps.map((t, i) => ({
            time: toChartTime(t),
            value: rollingMetrics.rollingSharpe[i],
          })));
        }
        break;
      }

      case 'winrate': {
        if (rollingMetrics) {
          const series = chart.addSeries(LineSeries, {
            color: '#F59E0B',
            lineWidth: 2,
            title: 'Win Rate %',
          });
          series.setData(rollingMetrics.timestamps.map((t, i) => ({
            time: toChartTime(t),
            value: rollingMetrics.cumulativeWinRate[i],
          })));
        }
        break;
      }
    }

    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [activeTab, equity, rollingMetrics]);

  if (equity.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Performance Evolution</h2>
        <div className="h-48 flex items-center justify-center text-gray-500">
          Run a backtest to see performance data
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">Performance Evolution</h2>
      </div>

      {/* Tab Pills */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-lg overflow-hidden border border-gray-700">
        <div ref={containerRef} />
      </div>
    </div>
  );
}

export default PerformanceCharts;
