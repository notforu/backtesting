/**
 * History Runs Explorer Modal
 * Filtering, sorting, infinite scroll, and server-side group-by-asset.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHistory, getHistoryGroups, exportConfigs, type HistoryParams, type BacktestGroup } from '../../api/client';
import type { BacktestSummary } from '../../types';
import { ImportConfigModal } from '../ImportConfigModal/ImportConfigModal';
import { useAuthStore } from '../../stores/authStore';
import { Spinner } from '../Spinner/Spinner';

// ============================================================================
// Types
// ============================================================================

interface HistoryExplorerContentProps {
  onSelectRun: (run: BacktestSummary) => void;
  selectedId?: string | null;
  loadingId?: string | null;
  fixedRunType?: 'strategies' | 'aggregations';
  compact?: boolean;
  showFilters?: boolean;
  showGroupToggle?: boolean;
  defaultGroupByAsset?: boolean;
  maxHeight?: string;
  className?: string;
}

interface HistoryExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRun: (id: string) => void;
  selectedId?: string | null;
  title?: string;
  fixedRunType?: 'strategies' | 'aggregations';
  onPickRun?: (run: BacktestSummary) => void;
}

type SortColumn = 'runAt' | 'sharpeRatio' | 'totalReturnPercent' | 'maxDrawdownPercent' | 'winRate' | 'totalTrades';

type RunTypeFilter = 'all' | 'strategies' | 'aggregations';

interface FilterState {
  strategy: string;
  symbol: string;
  timeframe: string;
  mode: string;
  minSharpe: string;
  runType: RunTypeFilter;
  sortBy: SortColumn;
  sortDir: 'asc' | 'desc';
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffDay > 7) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHr > 0) return `${diffHr}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

function formatReturn(val: number | null | undefined): string {
  if (val == null) return '-';
  const prefix = val >= 0 ? '+' : '';
  return `${prefix}${val.toFixed(2)}%`;
}

/** winRate is stored as 0-100 in the DB (already a percentage) */
function formatWinRate(val: number | null | undefined): string {
  if (val == null) return '-';
  return `${val.toFixed(1)}%`;
}

function formatNum(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '-';
  return val.toFixed(decimals);
}

// ============================================================================
// Sort Header
// ============================================================================

function SortHeader({ label, column, currentSort, currentDir, onSort, className = '' }: {
  label: string;
  column: SortColumn;
  currentSort: SortColumn;
  currentDir: 'asc' | 'desc';
  onSort: (col: SortColumn) => void;
  className?: string;
}) {
  const isActive = currentSort === column;
  return (
    <th
      className={`py-2 pr-3 text-left cursor-pointer select-none group whitespace-nowrap ${className}`}
      onClick={() => onSort(column)}
    >
      <span className={`inline-flex items-center gap-1 ${isActive ? 'text-primary-400' : 'text-gray-400 group-hover:text-gray-200'}`}>
        {label}
        <span className="text-xs">
          {isActive ? (currentDir === 'asc' ? '↑' : '↓') : <span className="opacity-0 group-hover:opacity-40">↓</span>}
        </span>
      </span>
    </th>
  );
}

// ============================================================================
// Run Row — params shown as expandable sub-row
// ============================================================================

function RunRow({ run, isSelected, isHighlighted, isLoading, onSelect, isSelectedForExport, onToggleExport }: {
  run: BacktestSummary;
  isSelected: boolean;
  isHighlighted?: boolean;
  isLoading?: boolean;
  onSelect: (run: BacktestSummary) => void;
  isSelectedForExport?: boolean;
  onToggleExport?: (id: string, e: React.MouseEvent) => void;
}) {
  const hasParams = run.params && Object.keys(run.params).length > 0;
  const isAgg = run.aggregationName || run.symbol === 'MULTI';

  return (
    <tr
      className={`border-b border-gray-700/50 cursor-pointer transition-colors ${isLoading ? 'opacity-70' : ''} ${
        isSelected
          ? 'bg-primary-900/40'
          : isHighlighted
          ? 'bg-green-900/10 hover:bg-green-900/20'
          : 'hover:bg-gray-700/30'
      }`}
      onClick={() => onSelect(run)}
    >
      {onToggleExport && (
        <td className="py-2 pr-1 w-8 pl-1">
          <input
            type="checkbox"
            checked={isSelectedForExport || false}
            onClick={(e) => { e.stopPropagation(); onToggleExport(run.id, e as unknown as React.MouseEvent); }}
            onChange={() => {}}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-0 cursor-pointer"
          />
        </td>
      )}
      <td className={`py-2 pr-3 ${isSelected ? 'shadow-[inset_3px_0_0_0_rgb(96,165,250)]' : ''}`}>
        <div className="font-medium text-white text-sm truncate max-w-[160px]" title={run.aggregationName ?? run.strategyName}>
          {isAgg ? (
            <span className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/50 text-purple-400 flex-shrink-0">AGG</span>
              <span className="truncate">{run.aggregationName || run.strategyName}</span>
            </span>
          ) : (
            run.strategyName
          )}
        </div>
      </td>
      <td className="py-2 pr-3">
        <span className="text-gray-300 text-sm font-mono">
          {run.symbol === 'MULTI' ? (
            <span className="text-gray-500">—</span>
          ) : (
            run.symbol
          )}
        </span>
      </td>
      <td className="py-2 pr-3 text-gray-400 text-xs">{run.timeframe}</td>
      <td className="py-2 pr-3">
        {run.mode ? (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            run.mode === 'futures' ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-700 text-gray-400'
          }`}>{run.mode}</span>
        ) : <span className="text-xs text-gray-600">-</span>}
      </td>
      <td className="py-2 pr-3">
        {isLoading ? (
          <Spinner size="sm" className="text-primary-400" />
        ) : (
          <span className={`font-medium text-sm ${(run.totalReturnPercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatReturn(run.totalReturnPercent)}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">
        <span className={`text-sm ${(run.sharpeRatio ?? 0) >= 1 ? 'text-green-400' : (run.sharpeRatio ?? 0) >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
          {formatNum(run.sharpeRatio)}
        </span>
      </td>
      <td className="py-2 pr-3 text-sm text-gray-300">{formatNum(run.maxDrawdownPercent, 1)}{run.maxDrawdownPercent != null ? '%' : ''}</td>
      <td className="py-2 pr-3 text-sm text-gray-300">{formatWinRate(run.winRate)}</td>
      <td className="py-2 pr-3 text-sm text-gray-300">{formatNum(run.profitFactor)}</td>
      <td className="py-2 pr-3 text-sm text-gray-300">{run.totalTrades ?? '-'}</td>
      <td className="py-2 pr-3">
        {hasParams && (
          <div className="relative group/params">
            <span className="text-xs text-primary-400 cursor-default">params</span>
            <div className="absolute right-0 bottom-full mb-1 hidden group-hover/params:block z-50 w-72 max-h-48 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3">
              {Object.entries(run.params!).map(([key, value]) => {
                if (key === 'subStrategies' && Array.isArray(value)) {
                  return (
                    <div key={key} className="flex justify-between gap-2 text-xs py-0.5">
                      <span className="text-gray-400 font-mono truncate">{key}</span>
                      <span className="text-gray-200 font-mono text-right">{value.length} sub-strategies</span>
                    </div>
                  );
                }
                const displayValue = typeof value === 'object' && value !== null
                  ? JSON.stringify(value).slice(0, 60) + (JSON.stringify(value).length > 60 ? '...' : '')
                  : String(value);
                return (
                  <div key={key} className="flex justify-between gap-2 text-xs py-0.5">
                    <span className="text-gray-400 font-mono truncate">{key}</span>
                    <span className="text-gray-200 font-mono text-right truncate">{displayValue}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </td>
      <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{formatRelativeTime(run.runAt)}</td>
    </tr>
  );
}

// ============================================================================
// Compact Run Row — minimal columns for inline use
// ============================================================================

function CompactRunRow({ run, isSelected, isLoading, onSelect }: {
  run: BacktestSummary;
  isSelected: boolean;
  isLoading?: boolean;
  onSelect: (run: BacktestSummary) => void;
}) {
  return (
    <tr
      className={`border-b border-gray-700/50 cursor-pointer transition-colors ${isLoading ? 'opacity-70' : ''} ${
        isSelected ? 'bg-primary-900/40' : 'hover:bg-gray-700/30'
      }`}
      onClick={() => onSelect(run)}
    >
      <td className={`py-1.5 pr-2 ${isSelected ? 'shadow-[inset_3px_0_0_0_rgb(96,165,250)]' : ''}`}>
        <div className="text-xs text-white truncate max-w-[120px]" title={run.aggregationName ?? run.strategyName}>
          {(run.aggregationName || run.symbol === 'MULTI') ? (
            <span className="flex items-center gap-1">
              <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-purple-900/50 text-purple-400">AGG</span>
              <span className="truncate">{run.aggregationName || run.strategyName}</span>
            </span>
          ) : run.strategyName}
        </div>
        <div className="text-[10px] text-gray-500 truncate">{run.symbol !== 'MULTI' ? run.symbol : ''}</div>
      </td>
      <td className="py-1.5 pr-2">
        {isLoading ? (
          <Spinner size="sm" className="text-primary-400" />
        ) : (
          <span className={`text-xs font-medium ${(run.totalReturnPercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatReturn(run.totalReturnPercent)}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <span className={`text-xs ${(run.sharpeRatio ?? 0) >= 1 ? 'text-green-400' : (run.sharpeRatio ?? 0) >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
          {formatNum(run.sharpeRatio)}
        </span>
      </td>
      <td className="py-1.5 text-[10px] text-gray-500 whitespace-nowrap">
        {formatRelativeTime(run.runAt)}
      </td>
    </tr>
  );
}

// ============================================================================
// Table header
// ============================================================================

function TableHead({ sortBy, sortDir, onSort, showCheckbox, allSelected, onSelectAll }: {
  sortBy: SortColumn;
  sortDir: 'asc' | 'desc';
  onSort: (c: SortColumn) => void;
  showCheckbox?: boolean;
  allSelected?: boolean;
  onSelectAll?: () => void;
}) {
  return (
    <thead className="sticky top-0 bg-gray-900 z-10">
      <tr className="text-left border-b border-gray-700 text-xs">
        {showCheckbox && (
          <th className="py-2 pr-1 w-8 pl-1">
            <input
              type="checkbox"
              checked={allSelected || false}
              onChange={() => onSelectAll?.()}
              className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-primary-500 focus:ring-0 cursor-pointer"
              title="Select all"
            />
          </th>
        )}
        <th className="py-2 pr-3 text-gray-400">Strategy</th>
        <th className="py-2 pr-3 text-gray-400">Symbol</th>
        <th className="py-2 pr-3 text-gray-400">TF</th>
        <th className="py-2 pr-3 text-gray-400">Mode</th>
        <SortHeader label="Return %" column="totalReturnPercent" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
        <SortHeader label="Sharpe" column="sharpeRatio" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
        <SortHeader label="Max DD" column="maxDrawdownPercent" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
        <SortHeader label="Win %" column="winRate" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
        <th className="py-2 pr-3 text-gray-400">PF</th>
        <SortHeader label="Trades" column="totalTrades" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
        <th className="py-2 pr-3 text-gray-400">Params</th>
        <SortHeader label="Date" column="runAt" currentSort={sortBy} currentDir={sortDir} onSort={onSort} />
      </tr>
    </thead>
  );
}

// ============================================================================
// Compact Table Header
// ============================================================================

function CompactTableHead() {
  return (
    <thead className="sticky top-0 bg-gray-900 z-10">
      <tr className="text-left border-b border-gray-700 text-[10px]">
        <th className="py-1.5 pr-2 text-gray-400">Strategy</th>
        <th className="py-1.5 pr-2 text-gray-400">Return</th>
        <th className="py-1.5 pr-2 text-gray-400">Sharpe</th>
        <th className="py-1.5 text-gray-400">Date</th>
      </tr>
    </thead>
  );
}

// ============================================================================
// Expandable Group (fetches its own runs from API when expanded)
// ============================================================================

function AssetGroup({ group, filters, selectedId, onSelectRun }: {
  group: BacktestGroup;
  filters: FilterState;
  selectedId?: string | null;
  onSelectRun: (run: BacktestSummary) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Fetch runs for this symbol only when expanded
  const { data, isLoading } = useQuery({
    queryKey: ['group-runs', group.symbol, filters.strategy, filters.timeframe, filters.mode, filters.minSharpe],
    queryFn: () => getHistory({
      symbol: group.symbol,
      limit: 200,
      sortBy: 'sharpeRatio',
      sortDir: 'desc',
      ...(filters.strategy ? { strategy: filters.strategy } : {}),
      ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
      ...(filters.mode ? { mode: filters.mode } : {}),
      ...(filters.minSharpe && !isNaN(parseFloat(filters.minSharpe)) ? { minSharpe: parseFloat(filters.minSharpe) } : {}),
    }),
    enabled: isOpen,
    staleTime: 60000,
  });

  const runs = data?.results ?? [];

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-700/80 transition-colors text-left"
        onClick={() => setIsOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-medium text-white font-mono">{group.symbol}</span>
          <span className="text-xs text-gray-500">{group.count} run{group.count !== 1 ? 's' : ''}</span>
          <span className="text-xs text-gray-600">{group.timeframes.join(', ')}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500 text-xs">Best Sharpe:</span>
          <span className={`font-medium ${group.bestSharpe >= 1 ? 'text-green-400' : group.bestSharpe >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
            {group.bestSharpe.toFixed(2)}
          </span>
          <span className="text-gray-500 text-xs">Best Return:</span>
          <span className={`font-medium ${group.bestReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatReturn(group.bestReturn)}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="md" className="text-primary-400" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <TableHead sortBy="sharpeRatio" sortDir="desc" onSort={() => {}} />
              <tbody>
                {runs.map((run, idx) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    isSelected={selectedId === run.id}
                    isHighlighted={idx === 0}
                    onSelect={onSelectRun}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HistoryExplorerContent — reusable content without modal chrome
// ============================================================================

export function HistoryExplorerContent({
  onSelectRun,
  selectedId,
  loadingId,
  fixedRunType,
  compact = false,
  showFilters = true,
  showGroupToggle = true,
  defaultGroupByAsset = false,
  maxHeight,
  className = '',
}: HistoryExplorerContentProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [filters, setFilters] = useState<FilterState>({
    strategy: '', symbol: '', timeframe: '', mode: '', minSharpe: '',
    runType: fixedRunType ?? 'all',
    sortBy: 'runAt', sortDir: 'desc',
  });
  const [pendingFilters, setPendingFilters] = useState<FilterState>(filters);
  const [offset, setOffset] = useState(0);
  const [allRuns, setAllRuns] = useState<BacktestSummary[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [groupByAsset, setGroupByAsset] = useState(defaultGroupByAsset);
  const [filterKey, setFilterKey] = useState(0);

  const PAGE_SIZE = 50;

  // Build query params, passing fixedRunType to API if set
  const queryParams: HistoryParams = useMemo(() => ({
    limit: PAGE_SIZE, offset,
    sortBy: filters.sortBy, sortDir: filters.sortDir,
    ...(filters.strategy ? { strategy: filters.strategy } : {}),
    ...(filters.symbol ? { symbol: filters.symbol } : {}),
    ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.minSharpe && !isNaN(parseFloat(filters.minSharpe)) ? { minSharpe: parseFloat(filters.minSharpe) } : {}),
    ...(fixedRunType ? { runType: fixedRunType } : filters.runType !== 'all' ? { runType: filters.runType } : {}),
  }), [filters, offset, fixedRunType]);

  const { data, isLoading } = useQuery({
    queryKey: ['explorer-history', queryParams],
    queryFn: () => getHistory(queryParams),
    enabled: !groupByAsset,
  });

  // Groups query
  const groupFilterParams = useMemo(() => ({
    ...(filters.strategy ? { strategy: filters.strategy } : {}),
    ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.minSharpe && !isNaN(parseFloat(filters.minSharpe)) ? { minSharpe: parseFloat(filters.minSharpe) } : {}),
    ...(fixedRunType ? { runType: fixedRunType } : filters.runType !== 'all' ? { runType: filters.runType } : {}),
  }), [filters, fixedRunType]);

  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['explorer-groups', groupFilterParams],
    queryFn: () => getHistoryGroups(groupFilterParams),
    enabled: groupByAsset,
  });

  const groups = groupsData?.groups ?? [];

  // Accumulate flat runs
  useEffect(() => {
    if (!data || groupByAsset) return;
    if (offset === 0) {
      setAllRuns(data.results);
    } else {
      setAllRuns(prev => [...prev, ...data.results]);
    }
  }, [data, offset, groupByAsset]);

  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;

  // Client-side filter by run type (only when fixedRunType is not set and no server-side filter)
  const filteredRuns = useMemo(() => {
    if (fixedRunType) return allRuns;
    if (filters.runType === 'aggregations') return allRuns.filter(r => r.aggregationId != null);
    if (filters.runType === 'strategies') return allRuns.filter(r => r.aggregationId == null);
    return allRuns;
  }, [allRuns, filters.runType, fixedRunType]);

  // Infinite scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasMoreRef = useRef(hasMore);
  const isLoadingRef = useRef(isLoading);
  hasMoreRef.current = hasMore;
  isLoadingRef.current = isLoading;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMoreRef.current || isLoadingRef.current || groupByAsset) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setOffset(prev => prev + PAGE_SIZE);
    }
  }, [groupByAsset]);

  const applyFilters = useCallback(() => {
    setFilters(pendingFilters);
    setOffset(0);
    setAllRuns([]);
    setFilterKey(k => k + 1);
  }, [pendingFilters]);

  const handleSort = useCallback((col: SortColumn) => {
    const newDir = filters.sortBy === col && filters.sortDir === 'desc' ? 'asc' as const : 'desc' as const;
    const updated = { ...filters, sortBy: col, sortDir: newDir };
    setPendingFilters(updated);
    setFilters(updated);
    setOffset(0);
    setAllRuns([]);
  }, [filters]);

  const hasActiveFilters = filters.strategy || filters.symbol || filters.timeframe || filters.mode || filters.minSharpe || (!fixedRunType && filters.runType !== 'all');

  const handleToggleExport = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedForExport(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExportSelected = useCallback(async () => {
    if (selectedForExport.size === 0) return;
    setIsExporting(true);
    try {
      const blob = await exportConfigs(Array.from(selectedForExport));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backtest-configs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setSelectedForExport(new Set());
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [selectedForExport]);

  const scrollContainerStyle = maxHeight ? { maxHeight, overflowY: 'auto' as const } : {};

  return (
    <div className={className}>
      {/* Filters */}
      {showFilters && (
        <div className="py-2 border-b border-gray-700 bg-gray-800/50 mb-2 px-1">
          <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Strategy</label>
              <input type="text" placeholder="e.g. funding-rate-spike" value={pendingFilters.strategy}
                onChange={e => setPendingFilters(p => ({ ...p, strategy: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Symbol</label>
              <input type="text" placeholder="e.g. BTC/USDT:USDT" value={pendingFilters.symbol}
                onChange={e => setPendingFilters(p => ({ ...p, symbol: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">TF</label>
              <select value={pendingFilters.timeframe} onChange={e => setPendingFilters(p => ({ ...p, timeframe: e.target.value }))}
                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 focus:outline-none focus:border-primary-500">
                <option value="">All</option>
                <option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Min Sharpe</label>
              <input type="number" placeholder="0.5" step="0.1" value={pendingFilters.minSharpe}
                onChange={e => setPendingFilters(p => ({ ...p, minSharpe: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex gap-1 items-end">
              <button onClick={applyFilters} className="px-3 py-1 bg-primary-600 hover:bg-primary-500 text-white rounded text-xs font-medium transition-colors">Apply</button>
              {hasActiveFilters && (
                <button onClick={() => {
                  const cleared: FilterState = { strategy: '', symbol: '', timeframe: '', mode: '', minSharpe: '', runType: fixedRunType ?? 'all', sortBy: 'runAt', sortDir: 'desc' };
                  setPendingFilters(cleared); setFilters(cleared); setOffset(0); setAllRuns([]);
                }} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded text-xs transition-colors">Clear</button>
              )}
            </div>
          </div>
          {/* Run type toggle (hidden when fixedRunType is set) */}
          {!fixedRunType && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex rounded overflow-hidden border border-gray-600">
                {(['all', 'strategies', 'aggregations'] as RunTypeFilter[]).map(opt => (
                  <button
                    key={opt}
                    onClick={() => {
                      const updated = { ...pendingFilters, runType: opt };
                      setPendingFilters(updated);
                      setFilters(updated);
                      setOffset(0);
                      setAllRuns([]);
                    }}
                    className={`px-2 py-1 text-xs font-medium capitalize transition-colors ${
                      pendingFilters.runType === opt
                        ? opt === 'aggregations'
                          ? 'bg-purple-700 text-white'
                          : 'bg-primary-600 text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                    }`}
                  >
                    {opt === 'all' ? 'All' : opt === 'strategies' ? 'Strategies' : 'Aggregations'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Group toggle */}
      {showGroupToggle && (
        <div className="flex items-center justify-between mb-2">
          {total > 0 && !groupByAsset && (
            <span className="text-xs text-gray-500">{total.toLocaleString()} run{total !== 1 ? 's' : ''}</span>
          )}
          {groupByAsset && groups.length > 0 && (
            <span className="text-xs text-gray-500">{groups.length} asset{groups.length !== 1 ? 's' : ''}, {groups.reduce((s, g) => s + g.count, 0).toLocaleString()} runs</span>
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none ml-auto">
            <div
              className={`relative w-8 h-4 rounded-full transition-colors ${groupByAsset ? 'bg-primary-600' : 'bg-gray-600'}`}
              onClick={() => setGroupByAsset(g => !g)}
            >
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${groupByAsset ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-xs text-gray-400">Group by Asset</span>
          </label>
        </div>
      )}

      {/* Export / Import toolbar — only shown in non-compact flat list view */}
      {!compact && !groupByAsset && (
        <div className="flex items-center justify-between py-2 border-b border-gray-700/50 mb-2">
          <div className="flex items-center gap-2">
            {selectedForExport.size > 0 && (
              <span className="text-xs text-gray-400">{selectedForExport.size} selected</span>
            )}
            <button
              onClick={handleExportSelected}
              disabled={selectedForExport.size === 0 || isExporting}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                selectedForExport.size > 0
                  ? 'bg-green-700 hover:bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isExporting
                ? 'Exporting...'
                : `Export Selected${selectedForExport.size > 0 ? ` (${selectedForExport.size})` : ''}`}
            </button>
            {selectedForExport.size > 0 && (
              <button
                onClick={() => setSelectedForExport(new Set())}
                className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          {isAuthenticated && (
            <button
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1 bg-primary-700 hover:bg-primary-600 text-white rounded text-xs font-medium transition-colors"
            >
              Import Configs
            </button>
          )}
        </div>
      )}

      {/* Import modal */}
      <ImportConfigModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} />

      {/* Content */}
      <div ref={scrollRef} style={scrollContainerStyle} onScroll={handleScroll} key={filterKey}>
        {/* Loading state */}
        {((isLoading && allRuns.length === 0 && !groupByAsset) || (isLoadingGroups && groupByAsset)) && (
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isLoadingGroups && ((!groupByAsset && filteredRuns.length === 0) || (groupByAsset && groups.length === 0)) && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <p className="text-xs">No runs found</p>
            <p className="text-[10px] text-gray-600 mt-1">Try adjusting your filters</p>
          </div>
        )}

        {/* Group by Asset view */}
        {groupByAsset && groups.length > 0 && (
          <div className="space-y-2">
            {groups.map(group => (
              <AssetGroup
                key={group.symbol}
                group={group}
                filters={filters}
                selectedId={selectedId}
                onSelectRun={onSelectRun}
              />
            ))}
          </div>
        )}

        {/* Flat table view */}
        {!groupByAsset && filteredRuns.length > 0 && (
          <>
            {compact ? (
              <table className="w-full">
                <CompactTableHead />
                <tbody>
                  {filteredRuns.map(run => (
                    <CompactRunRow
                      key={run.id}
                      run={run}
                      isSelected={selectedId === run.id}
                      isLoading={loadingId === run.id}
                      onSelect={onSelectRun}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <TableHead
                  sortBy={filters.sortBy}
                  sortDir={filters.sortDir}
                  onSort={handleSort}
                  showCheckbox={true}
                  allSelected={filteredRuns.length > 0 && selectedForExport.size === filteredRuns.length}
                  onSelectAll={() => {
                    if (selectedForExport.size === filteredRuns.length && filteredRuns.length > 0) {
                      setSelectedForExport(new Set());
                    } else {
                      setSelectedForExport(new Set(filteredRuns.map(r => r.id)));
                    }
                  }}
                />
                <tbody>
                  {filteredRuns.map(run => (
                    <RunRow
                      key={run.id}
                      run={run}
                      isSelected={selectedId === run.id}
                      isLoading={loadingId === run.id}
                      onSelect={onSelectRun}
                      isSelectedForExport={selectedForExport.has(run.id)}
                      onToggleExport={handleToggleExport}
                    />
                  ))}
                </tbody>
              </table>
            )}

            {/* Loading more indicator */}
            {isLoading && filteredRuns.length > 0 && (
              <div className="flex items-center justify-center py-4 gap-2 text-gray-400 text-sm">
                <Spinner size="sm" />
                Loading more...
              </div>
            )}
            {!hasMore && filteredRuns.length > 0 && (
              <p className="text-center text-xs text-gray-600 py-2">
                Showing all {filteredRuns.length.toLocaleString()} run{filteredRuns.length !== 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </div>

    </div>
  );
}

// ============================================================================
// HistoryExplorer — thin modal wrapper around HistoryExplorerContent
// ============================================================================

export function HistoryExplorer({
  isOpen,
  onClose,
  onSelectRun,
  selectedId,
  title = 'Runs Explorer',
  fixedRunType,
  onPickRun,
}: HistoryExplorerProps) {
  // Close on Escape — only fires when this modal is mounted (topmost)
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleSelect = useCallback((run: BacktestSummary) => {
    if (onPickRun) {
      onPickRun(run);
      onClose();
    } else {
      onSelectRun(run.id);
      onClose();
    }
  }, [onPickRun, onSelectRun, onClose]);

  if (!isOpen) return null;

  // When used as a picker (stacked above CreateAggregationModal), use z-[60]
  const zClass = onPickRun ? 'z-[60]' : 'z-50';

  return (
    <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`} aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-7xl max-h-[90vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden min-h-0 px-6 py-4">
          <HistoryExplorerContent
            onSelectRun={handleSelect}
            selectedId={selectedId}
            fixedRunType={fixedRunType}
            showFilters={true}
            showGroupToggle={true}
            defaultGroupByAsset={true}
            maxHeight="calc(90vh - 140px)"
          />
        </div>
      </div>
    </div>
  );
}

export default HistoryExplorer;
