/**
 * React Query hooks for backtest data fetching.
 * Provides declarative data fetching with caching and automatic refetching.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStrategies,
  getStrategy,
  getHistory,
  getBacktest,
  runBacktest,
  runPairsBacktest,
  deleteBacktest,
  getCandles,
  getExchanges,
  getSymbols,
} from '../api/client';
import { useBacktestStore } from '../stores/backtestStore';
import type {
  RunBacktestRequest,
  RunPairsBacktestRequest,
  CandleRequest,
  StrategyInfo,
  StrategyDetails,
  BacktestSummary,
  BacktestResult,
  PairsBacktestResult,
  Candle,
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

/**
 * Fetch backtest history
 */
export function useHistory() {
  return useQuery<BacktestSummary[], Error>({
    queryKey: queryKeys.history,
    queryFn: getHistory,
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
      // Cache the new result
      queryClient.setQueryData(queryKeys.backtest(result.id), result);
    },
    onError: (error) => {
      setError(error.message);
    },
  });
}

/**
 * Run a pairs backtest mutation
 */
export function useRunPairsBacktest() {
  const queryClient = useQueryClient();
  const { setRunning, setResult, setError } = useBacktestStore();

  return useMutation<PairsBacktestResult, Error, RunPairsBacktestRequest>({
    mutationFn: runPairsBacktest,
    onMutate: () => {
      setRunning(true);
    },
    onSuccess: (result) => {
      setResult(result);
      // Invalidate history to include new result
      queryClient.invalidateQueries({ queryKey: queryKeys.history });
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
      // Remove from cache
      queryClient.removeQueries({ queryKey: queryKeys.backtest(deletedId) });
      // Clear current result if it was deleted
      if (currentResult?.id === deletedId) {
        clear();
      }
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
