/**
 * History Runs Explorer Modal
 * Filtering, sorting, infinite scroll, and server-side group-by-asset.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHistory, getHistoryGroups, type HistoryParams, type BacktestGroup } from '../../api/client';
import type { BacktestSummary } from '../../types';

// ============================================================================
// Types
// ============================================================================

interface HistoryExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRun: (id: string) => void;
  selectedId?: string | null;
}

type SortColumn = 'runAt' | 'sharpeRatio' | 'totalReturnPercent' | 'maxDrawdownPercent' | 'winRate' | 'totalTrades';

interface FilterState {
  strategy: string;
  symbol: string;
  timeframe: string;
  mode: string;
  minSharpe: string;
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

function RunRow({ run, isSelected, isHighlighted, onSelect, expanded, onToggle }: {
  run: BacktestSummary;
  isSelected: boolean;
  isHighlighted?: boolean;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const hasParams = run.params && Object.keys(run.params).length > 0;

  return (
    <>
      <tr
        className={`border-b border-gray-700/50 cursor-pointer transition-colors ${
          isSelected ? 'bg-primary-900/30' : isHighlighted ? 'bg-green-900/10 hover:bg-green-900/20' : 'hover:bg-gray-700/30'
        }`}
        onClick={() => onSelect(run.id)}
      >
        <td className="py-2 pr-3">
          <div className="font-medium text-white text-sm truncate max-w-[140px]" title={run.strategyName}>{run.strategyName}</div>
        </td>
        <td className="py-2 pr-3">
          <span className="text-gray-300 text-sm font-mono">{run.symbol}</span>
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
          <span className={`font-medium text-sm ${(run.totalReturnPercent ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatReturn(run.totalReturnPercent)}
          </span>
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
            <button
              className="text-xs text-primary-400 hover:text-primary-300"
              onClick={(e) => { e.stopPropagation(); onToggle(run.id); }}
            >
              {expanded ? 'hide' : 'params'}
            </button>
          )}
        </td>
        <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{formatRelativeTime(run.runAt)}</td>
      </tr>
      {expanded && hasParams && (
        <tr className="bg-gray-800/40">
          <td colSpan={12} className="px-4 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-gray-300">
              {Object.entries(run.params!).map(([k, v]) => (
                <span key={k}>
                  <span className="text-gray-500">{k}:</span>{' '}
                  <span className="text-gray-200">{typeof v === 'number' ? (Number.isInteger(v) ? v : (v as number).toFixed(4)) : String(v)}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================================================
// Table header
// ============================================================================

function TableHead({ sortBy, sortDir, onSort }: { sortBy: SortColumn; sortDir: 'asc' | 'desc'; onSort: (c: SortColumn) => void }) {
  return (
    <thead className="sticky top-0 bg-gray-900 z-10">
      <tr className="text-left border-b border-gray-700 text-xs">
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
// Expandable Group (fetches its own runs from API when expanded)
// ============================================================================

function AssetGroup({ group, filters, selectedId, onSelectRun }: {
  group: BacktestGroup;
  filters: FilterState;
  selectedId?: string | null;
  onSelectRun: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedParams, setExpandedParams] = useState<string | null>(null);

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
              <svg className="animate-spin h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
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
                    expanded={expandedParams === run.id}
                    onToggle={id => setExpandedParams(p => p === id ? null : id)}
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
// Main Component
// ============================================================================

export function HistoryExplorer({ isOpen, onClose, onSelectRun, selectedId }: HistoryExplorerProps) {
  const [filters, setFilters] = useState<FilterState>({
    strategy: '', symbol: '', timeframe: '', mode: '', minSharpe: '',
    sortBy: 'runAt', sortDir: 'desc',
  });
  const [pendingFilters, setPendingFilters] = useState<FilterState>(filters);
  const [offset, setOffset] = useState(0);
  const [allRuns, setAllRuns] = useState<BacktestSummary[]>([]);
  const [groupByAsset, setGroupByAsset] = useState(false);
  const [expandedParams, setExpandedParams] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState(0);

  const PAGE_SIZE = 50;

  // --- Flat list query ---
  const queryParams: HistoryParams = useMemo(() => ({
    limit: PAGE_SIZE, offset,
    sortBy: filters.sortBy, sortDir: filters.sortDir,
    ...(filters.strategy ? { strategy: filters.strategy } : {}),
    ...(filters.symbol ? { symbol: filters.symbol } : {}),
    ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.minSharpe && !isNaN(parseFloat(filters.minSharpe)) ? { minSharpe: parseFloat(filters.minSharpe) } : {}),
  }), [filters, offset]);

  const { data, isLoading } = useQuery({
    queryKey: ['explorer-history', queryParams],
    queryFn: () => getHistory(queryParams),
    enabled: isOpen && !groupByAsset,
  });

  // --- Groups query (server-side) ---
  const groupFilterParams = useMemo(() => ({
    ...(filters.strategy ? { strategy: filters.strategy } : {}),
    ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
    ...(filters.mode ? { mode: filters.mode } : {}),
    ...(filters.minSharpe && !isNaN(parseFloat(filters.minSharpe)) ? { minSharpe: parseFloat(filters.minSharpe) } : {}),
  }), [filters]);

  const { data: groupsData, isLoading: isLoadingGroups } = useQuery({
    queryKey: ['explorer-groups', groupFilterParams],
    queryFn: () => getHistoryGroups(groupFilterParams),
    enabled: isOpen && groupByAsset,
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

  // --- Infinite scroll via onScroll ---
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

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

  const handleSelectRun = useCallback((id: string) => {
    onSelectRun(id);
    onClose();
  }, [onSelectRun, onClose]);

  if (!isOpen) return null;

  const hasActiveFilters = filters.strategy || filters.symbol || filters.timeframe || filters.mode || filters.minSharpe;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-7xl max-h-[90vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">Runs Explorer</h2>
            {!groupByAsset && total > 0 && (
              <span className="px-2 py-0.5 bg-primary-900/50 border border-primary-700/50 text-primary-300 text-xs rounded-full font-medium">
                {total.toLocaleString()} run{total !== 1 ? 's' : ''}
              </span>
            )}
            {groupByAsset && groups.length > 0 && (
              <span className="px-2 py-0.5 bg-primary-900/50 border border-primary-700/50 text-primary-300 text-xs rounded-full font-medium">
                {groups.length} asset{groups.length !== 1 ? 's' : ''}, {groups.reduce((s, g) => s + g.count, 0).toLocaleString()} runs
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${groupByAsset ? 'bg-primary-600' : 'bg-gray-600'}`}
                onClick={() => setGroupByAsset(g => !g)}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${groupByAsset ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-sm text-gray-400">Group by Asset</span>
            </label>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-800/50">
          <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Strategy</label>
              <input type="text" placeholder="e.g. funding-rate-spike" value={pendingFilters.strategy}
                onChange={e => setPendingFilters(p => ({ ...p, strategy: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-full px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Symbol</label>
              <input type="text" placeholder="e.g. BTC/USDT:USDT" value={pendingFilters.symbol}
                onChange={e => setPendingFilters(p => ({ ...p, symbol: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-full px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Timeframe</label>
              <select value={pendingFilters.timeframe} onChange={e => setPendingFilters(p => ({ ...p, timeframe: e.target.value }))}
                className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500">
                <option value="">All</option>
                <option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Mode</label>
              <select value={pendingFilters.mode} onChange={e => setPendingFilters(p => ({ ...p, mode: e.target.value }))}
                className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500">
                <option value="">All</option><option value="spot">Spot</option><option value="futures">Futures</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Min Sharpe</label>
              <input type="number" placeholder="0.5" step="0.1" value={pendingFilters.minSharpe}
                onChange={e => setPendingFilters(p => ({ ...p, minSharpe: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applyFilters()}
                className="w-20 px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500" />
            </div>
          </div>
          <div className="flex items-end gap-3 mt-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Sort By</label>
              <select value={pendingFilters.sortBy} onChange={e => setPendingFilters(p => ({ ...p, sortBy: e.target.value as SortColumn }))}
                className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-primary-500">
                <option value="runAt">Date</option><option value="sharpeRatio">Sharpe</option><option value="totalReturnPercent">Return</option>
                <option value="maxDrawdownPercent">Drawdown</option><option value="winRate">Win Rate</option><option value="totalTrades">Trades</option>
              </select>
            </div>
            <button onClick={() => setPendingFilters(p => ({ ...p, sortDir: p.sortDir === 'desc' ? 'asc' : 'desc' }))}
              className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 hover:bg-gray-600 transition-colors">
              {pendingFilters.sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
            <button onClick={applyFilters} className="px-5 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded text-sm font-medium transition-colors">Apply</button>
            {hasActiveFilters && (
              <button onClick={() => {
                const cleared: FilterState = { strategy: '', symbol: '', timeframe: '', mode: '', minSharpe: '', sortBy: 'runAt', sortDir: 'desc' };
                setPendingFilters(cleared); setFilters(cleared); setOffset(0); setAllRuns([]);
              }} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 rounded text-sm transition-colors">Clear</button>
            )}
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll} key={filterKey}>
          <div className="px-6 py-4">
            {/* Loading state */}
            {((isLoading && allRuns.length === 0 && !groupByAsset) || (isLoadingGroups && groupByAsset)) && (
              <div className="flex items-center justify-center py-16">
                <svg className="animate-spin h-7 w-7 text-primary-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !isLoadingGroups && ((!groupByAsset && allRuns.length === 0) || (groupByAsset && groups.length === 0)) && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <p className="text-sm">No runs found</p>
                <p className="text-xs text-gray-600 mt-1">Try adjusting your filters</p>
              </div>
            )}

            {/* Group by Asset view */}
            {groupByAsset && groups.length > 0 && (
              <div className="space-y-2">
                {groups.map(group => (
                  <AssetGroup key={group.symbol} group={group} filters={filters} selectedId={selectedId} onSelectRun={handleSelectRun} />
                ))}
              </div>
            )}

            {/* Flat table view */}
            {!groupByAsset && allRuns.length > 0 && (
              <>
                <table className="w-full text-sm">
                  <TableHead sortBy={filters.sortBy} sortDir={filters.sortDir} onSort={handleSort} />
                  <tbody>
                    {allRuns.map(run => (
                      <RunRow key={run.id} run={run} isSelected={selectedId === run.id} onSelect={handleSelectRun}
                        expanded={expandedParams === run.id} onToggle={id => setExpandedParams(p => p === id ? null : id)} />
                    ))}
                  </tbody>
                </table>

                {/* Loading more indicator */}
                {isLoading && allRuns.length > 0 && (
                  <div className="flex items-center justify-center py-4 gap-2 text-gray-400 text-sm">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading more...
                  </div>
                )}
                {!hasMore && allRuns.length > 0 && (
                  <p className="text-center text-xs text-gray-600 py-4">
                    Showing all {allRuns.length.toLocaleString()} run{allRuns.length !== 1 ? 's' : ''}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HistoryExplorer;
