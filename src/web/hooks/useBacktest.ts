/**
 * React Query hooks for backtest data fetching.
 * Provides declarative data fetching with caching and automatic refetching.
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStrategies,
  getStrategy,
  getHistory,
  getBacktest,
  runBacktest,
  deleteBacktest,
  deleteAllHistory,
  getCandles,
  getExchanges,
  getSymbols,
  getAggregations,
  createAggregation,
  updateAggregation,
  deleteAggregation,
  runAggregation,
} from '../api/client';
import { useBacktestStore } from '../stores/backtestStore';
import type {
  RunBacktestRequest,
  AggregateBacktestResult,
  CandleRequest,
  StrategyInfo,
  StrategyDetails,
  BacktestResult,
  Candle,
  PaginatedHistory,
  AggregationConfig,
  CreateAggregationRequest,
  UpdateAggregationRequest,
  RunAggregationRequest,
} from '../types';

// Query keys for cache management
export const queryKeys = {
  strategies: ['strategies'] as const,
  strategy: (name: string) => ['strategy', name] as const,
  history: ['history'] as const,
  backtest: (id: string) => ['backtest', id] as const,
  candles: (params: CandleRequest) => ['candles', params] as const,
  exchanges: ['exchanges'] as const,
  symbols: (exchange: string) => ['symbols', exchange] as const,
  aggregations: ['aggregations'] as const,
  aggregation: (id: string) => ['aggregation', id] as const,
};

// ============================================================================
// Strategy Hooks
// ============================================================================

/**
 * Fetch list of all available strategies
 */
export function useStrategies() {
  return useQuery<StrategyInfo[], Error>({
    queryKey: queryKeys.strategies,
    queryFn: getStrategies,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Fetch details for a specific strategy
 */
export function useStrategy(name: string) {
  return useQuery<StrategyDetails, Error>({
    queryKey: queryKeys.strategy(name),
    queryFn: () => getStrategy(name),
    enabled: !!name, // Only fetch when name is provided
    staleTime: 1000 * 60 * 5,
  });
}

// ============================================================================
// History Hooks
// ============================================================================

const PAGE_SIZE = 10;

/**
 * Fetch backtest history with infinite loading
 */
export function useHistory() {
  return useInfiniteQuery<PaginatedHistory, Error>({
    queryKey: queryKeys.history,
    queryFn: ({ pageParam = 0 }) => getHistory({ limit: PAGE_SIZE, offset: pageParam as number, runType: 'strategies' }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const totalLoaded = allPages.reduce((sum, page) => sum + page.results.length, 0);
      return totalLoaded;
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Fetch a specific backtest result
 */
export function useBacktest(id: string | null) {
  return useQuery<BacktestResult, Error>({
    queryKey: queryKeys.backtest(id || ''),
    queryFn: () => getBacktest(id!),
    enabled: !!id,
    staleTime: Infinity, // Backtest results don't change
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Run a new backtest mutation
 */
export function useRunBacktest() {
  const queryClient = useQueryClient();
  const { setRunning, setResult, setError } = useBacktestStore();

  return useMutation<BacktestResult, Error, RunBacktestRequest>({
    mutationFn: runBacktest,
    onMutate: () => {
      setRunning(true);
    },
    onSuccess: (result) => {
      setResult(result);
      // Invalidate history to include new result
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
      queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
      // Cache the new result
      queryClient.setQueryData(queryKeys.backtest(result.id), result);
    },
    onError: (error) => {
      setError(error.message);
    },
  });
}

/**
 * Delete a backtest mutation
 */
export function useDeleteBacktest() {
  const queryClient = useQueryClient();
  const { currentResult, clear } = useBacktestStore();

  return useMutation<void, Error, string>({
    mutationFn: deleteBacktest,
    onSuccess: (_, deletedId) => {
      // Invalidate history
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
      queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
      // Remove from cache
      queryClient.removeQueries({ queryKey: queryKeys.backtest(deletedId) });
      // Clear current result if it was deleted
      if (currentResult?.id === deletedId) {
        clear();
      }
    },
  });
}

/**
 * Delete all backtest history mutation
 */
export function useDeleteAllHistory() {
  const queryClient = useQueryClient();
  const { clear } = useBacktestStore();

  return useMutation<{ message: string; count: number }, Error, void>({
    mutationFn: deleteAllHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
      queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
      clear();
    },
  });
}

// ============================================================================
// Data Hooks
// ============================================================================

/**
 * Fetch candle data
 */
export function useCandles(params: CandleRequest | null) {
  return useQuery<Candle[], Error>({
    queryKey: queryKeys.candles(params!),
    queryFn: () => getCandles(params!),
    enabled: !!params,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

/**
 * Fetch available exchanges
 */
export function useExchanges() {
  return useQuery<string[], Error>({
    queryKey: queryKeys.exchanges,
    queryFn: getExchanges,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

/**
 * Fetch symbols for an exchange
 */
export function useSymbols(exchange: string) {
  return useQuery<string[], Error>({
    queryKey: queryKeys.symbols(exchange),
    queryFn: () => getSymbols(exchange),
    enabled: !!exchange,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * Fetch candles at a specific resolution for multi-resolution chart
 */
export function useResolutionCandles(params: {
  exchange: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
} | null) {
  return useQuery<Candle[], Error>({
    queryKey: ['resolution-candles', params],
    queryFn: async () => {
      if (!params) return [];
      const queryParams = new URLSearchParams({
        exchange: params.exchange,
        symbol: params.symbol,
        timeframe: params.timeframe,
        start: params.startDate,
        end: params.endDate,
      });
      const response = await fetch(`/api/candles?${queryParams.toString()}`);
      if (!response.ok) throw new Error(`Failed to fetch candles: ${response.statusText}`);
      const data = await response.json();
      // API returns { candles, source, count } - extract candles array
      return data.candles || data;
    },
    enabled: !!params,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

/**
 * Fetch funding rates for a given exchange/symbol/date range
 */
export function useFundingRates(params: {
  exchange: string;
  symbol: string;
  start: number;
  end: number;
} | null) {
  return useQuery({
    queryKey: ['funding-rates', params],
    queryFn: async () => {
      if (!params) return [];
      const { getFundingRates } = await import('../api/client');
      const data = await getFundingRates(params);
      return data.rates;
    },
    enabled: !!params,
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

// ============================================================================
// Aggregation Hooks
// ============================================================================

/**
 * Fetch all aggregation configs
 */
export function useAggregations() {
  return useQuery<AggregationConfig[], Error>({
    queryKey: queryKeys.aggregations,
    queryFn: getAggregations,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Create a new aggregation
 */
export function useCreateAggregation() {
  const queryClient = useQueryClient();
  return useMutation<AggregationConfig, Error, CreateAggregationRequest>({
    mutationFn: (config) => createAggregation(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aggregations });
    },
  });
}

/**
 * Update an aggregation
 */
export function useUpdateAggregation() {
  const queryClient = useQueryClient();
  return useMutation<AggregationConfig, Error, { id: string; updates: UpdateAggregationRequest }>({
    mutationFn: ({ id, updates }) => updateAggregation(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aggregations });
    },
  });
}

/**
 * Delete an aggregation
 */
export function useDeleteAggregation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteAggregation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aggregations });
    },
  });
}

/**
 * Run an aggregation backtest
 */
export function useRunAggregation() {
  const queryClient = useQueryClient();
  const { setRunning, setResult, setError } = useBacktestStore();

  return useMutation<AggregateBacktestResult, Error, { id: string; request: RunAggregationRequest }>({
    mutationFn: ({ id, request }) => runAggregation(id, request),
    onMutate: () => {
      setRunning(true);
    },
    onSuccess: (result) => {
      setResult(result);
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
      queryClient.invalidateQueries({ queryKey: ['explorer-history'] });
      queryClient.setQueryData(queryKeys.backtest(result.id), result);
    },
    onError: (error) => {
      setError(error.message);
    },
  });
}

// ============================================================================
// Combined Hook - Load backtest from history
// ============================================================================

/**
 * Load a backtest from history and set it as current
 */
export function useLoadBacktest() {
  const queryClient = useQueryClient();
  const { setResult, setError, setSelectedBacktestId } = useBacktestStore();

  const loadBacktest = async (id: string) => {
    try {
      setSelectedBacktestId(id);

      // Check if already cached
      const cached = queryClient.getQueryData<BacktestResult>(
        queryKeys.backtest(id)
      );

      if (cached) {
        setResult(cached);
        return cached;
      }

      // Fetch from API
      const result = await queryClient.fetchQuery({
        queryKey: queryKeys.backtest(id),
        queryFn: () => getBacktest(id),
      });

      setResult(result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load backtest';
      setError(message);
      throw error;
    }
  };

  return { loadBacktest };
}
