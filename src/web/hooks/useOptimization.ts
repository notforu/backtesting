/**
 * React Query hooks for parameter optimization.
 * Provides hooks for running optimizations and managing optimized parameters.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  runOptimization,
  getOptimizedParams,
  getAllOptimizations,
  deleteOptimization,
  deleteOptimizationById,
  type OptimizationProgressCallback,
} from '../api/client';
import type {
  OptimizationRequest,
  OptimizationResult,
} from '../types';
import { useState } from 'react';

// Query keys for cache management
export const optimizationQueryKeys = {
  all: ['optimizations'] as const,
  optimized: (strategyName: string, symbol: string, timeframe: string) =>
    ['optimization', strategyName, symbol, timeframe] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch all optimization runs for a specific strategy, symbol, and timeframe
 * Returns an array of results sorted by most recent first
 */
export function useOptimizedParams(strategyName: string, symbol: string, timeframe: string) {
  return useQuery<OptimizationResult[], Error>({
    queryKey: optimizationQueryKeys.optimized(strategyName, symbol, timeframe),
    queryFn: () => getOptimizedParams(strategyName, symbol, timeframe),
    enabled: !!strategyName && !!symbol && !!timeframe,
    staleTime: 1000 * 60 * 5, // 5 minutes - optimization history may change
    retry: false, // Don't retry on 404
  });
}

/**
 * Fetch all optimization results
 */
export function useAllOptimizations() {
  return useQuery<OptimizationResult[], Error>({
    queryKey: optimizationQueryKeys.all,
    queryFn: getAllOptimizations,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Run a parameter optimization with progress tracking
 */
export function useRunOptimization() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ current: number; total: number; percent: number } | null>(null);

  const mutation = useMutation<
    OptimizationResult,
    Error,
    OptimizationRequest & { onProgress?: OptimizationProgressCallback['onProgress'] }
  >({
    mutationFn: async (config) => {
      // Reset progress at start
      setProgress(null);

      return runOptimization(config, {
        onProgress: (progressData) => {
          setProgress(progressData);
          // Also call the component's progress callback if provided
          if (config.onProgress) {
            config.onProgress(progressData);
          }
        },
      });
    },
    onSuccess: (result) => {
      // Clear progress on success
      setProgress(null);

      // Invalidate and refetch all optimizations
      queryClient.invalidateQueries({ queryKey: optimizationQueryKeys.all });

      // Invalidate the specific optimization history so it refetches with the new result
      queryClient.invalidateQueries({
        queryKey: optimizationQueryKeys.optimized(result.strategyName, result.symbol, result.timeframe),
      });
    },
    onError: () => {
      // Clear progress on error
      setProgress(null);
    },
  });

  return {
    ...mutation,
    progress,
  };
}

/**
 * Delete all optimization runs for a strategy/symbol/timeframe
 */
export function useDeleteOptimization() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { strategyName: string; symbol: string; timeframe: string }>({
    mutationFn: ({ strategyName, symbol, timeframe }) => deleteOptimization(strategyName, symbol, timeframe),
    onSuccess: (_, { strategyName, symbol, timeframe }) => {
      // Invalidate all optimizations list
      queryClient.invalidateQueries({ queryKey: optimizationQueryKeys.all });

      // Remove from cache
      queryClient.removeQueries({
        queryKey: optimizationQueryKeys.optimized(strategyName, symbol, timeframe),
      });
    },
  });
}

/**
 * Delete a specific optimization run by ID
 */
export function useDeleteOptimizationById() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; strategyName: string; symbol: string; timeframe: string }>({
    mutationFn: ({ id }) => deleteOptimizationById(id),
    onSuccess: (_, { strategyName, symbol, timeframe }) => {
      // Invalidate all optimizations list
      queryClient.invalidateQueries({ queryKey: optimizationQueryKeys.all });

      // Invalidate the specific optimization history so it refetches
      queryClient.invalidateQueries({
        queryKey: optimizationQueryKeys.optimized(strategyName, symbol, timeframe),
      });
    },
  });
}
