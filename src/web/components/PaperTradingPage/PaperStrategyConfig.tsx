/**
 * PaperStrategyConfig — collapsible widget showing sub-strategy configuration details.
 */

import { useState } from 'react';

// ============================================================================
// Types
// ============================================================================

export type WidgetSubStrategy = {
  strategyName: string;
  symbol: string;
  timeframe: string;
  exchange?: string;
  params?: Record<string, unknown>;
};

export type WidgetAggregationConfig = {
  name?: string;
  allocationMode: string;
  maxPositions?: number;
  exchange?: string;
  subStrategies: WidgetSubStrategy[];
};

// ============================================================================
// Helpers
// ============================================================================

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return parseFloat(value.toPrecision(4)).toString();
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function camelToDisplay(key: string): string {
  return key
    .replace(/Percent$/, '%')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase();
}

function ParamGrid({ params, compact = false }: { params: Record<string, unknown>; compact?: boolean }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <div className={`grid gap-x-4 gap-y-1 ${compact ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1 min-w-0">
          <span className="text-[11px] text-gray-500 shrink-0" title={key}>
            {camelToDisplay(key)}:
          </span>
          <span className="text-[11px] text-gray-300 font-mono truncate" title={String(value)}>
            {formatParamValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SingleStrategyDetail({
  sub,
  fallbackExchange,
}: {
  sub: WidgetSubStrategy;
  fallbackExchange?: string;
}) {
  const exchange = sub.exchange ?? fallbackExchange ?? 'bybit';
  const params = sub.params ?? {};
  const paramEntries = Object.entries(params);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Strategy</p>
          <p className="text-sm font-medium text-white">{sub.strategyName}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Symbol</p>
          <p className="text-sm font-medium text-gray-200">{sub.symbol.replace(':USDT', '')}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Timeframe</p>
          <p className="text-sm font-medium text-gray-200">{sub.timeframe}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Exchange</p>
          <p className="text-sm font-medium text-gray-200 capitalize">{exchange}</p>
        </div>
      </div>
      {paramEntries.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Parameters</p>
          <ParamGrid params={params} />
        </div>
      )}
    </div>
  );
}

function SubStrategyCard({
  sub,
  index,
  fallbackExchange,
}: {
  sub: WidgetSubStrategy;
  index: number;
  fallbackExchange?: string;
}) {
  const exchange = sub.exchange ?? fallbackExchange ?? 'bybit';
  const params = sub.params ?? {};
  return (
    <div className="bg-gray-900/60 border border-gray-700/60 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-semibold text-gray-500 bg-gray-700 rounded px-1.5 py-0.5 shrink-0">
          #{index}
        </span>
        <span className="text-sm font-semibold text-white truncate">{sub.strategyName}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 font-medium">
          {sub.symbol.replace('/USDT:USDT', '').replace('/USDT', '')}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-300">
          {sub.timeframe}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-gray-700 text-gray-400 capitalize">
          {exchange}
        </span>
      </div>
      {Object.keys(params).length > 0 && (
        <div className="pt-1 border-t border-gray-700/50">
          <ParamGrid params={params} compact />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PaperStrategyConfig — main export
// ============================================================================

interface PaperStrategyConfigProps {
  aggregationConfig: WidgetAggregationConfig;
}

export function PaperStrategyConfig({ aggregationConfig }: PaperStrategyConfigProps) {
  const [expanded, setExpanded] = useState(false);
  const subs = aggregationConfig.subStrategies;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700/40 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-semibold text-white">Strategy Configuration</span>
          <span className="text-xs text-gray-500 ml-1">
            {subs.length === 1 ? '1 strategy' : `${subs.length} strategies`}
            {' · '}
            {aggregationConfig.allocationMode.replace(/_/g, ' ')}
            {aggregationConfig.maxPositions != null && ` · max ${aggregationConfig.maxPositions} pos`}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-3">
          {subs.length === 0 ? (
            <p className="text-sm text-gray-500">No sub-strategies found.</p>
          ) : subs.length === 1 ? (
            <SingleStrategyDetail sub={subs[0]} fallbackExchange={aggregationConfig.exchange} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {subs.map((sub, idx) => (
                <SubStrategyCard
                  key={idx}
                  sub={sub}
                  index={idx + 1}
                  fallbackExchange={aggregationConfig.exchange}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
