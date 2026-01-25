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
} from '../api/client';
import type {
  OptimizationRequest,
  OptimizationResult,
} from '../types';

// Query keys for cache management
export const optimizationQueryKeys = {
  all: ['optimizations'] as const,
  optimized: (strategyName: string, symbol: string) =>
    ['optimization', strategyName, symbol] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch optimized parameters for a specific strategy and symbol
 */
export function useOptimizedParams(strategyName: string, symbol: string) {
  return useQuery<OptimizationResult, Error>({
    queryKey: optimizationQueryKeys.optimized(strategyName, symbol),
    queryFn: () => getOptimizedParams(strategyName, symbol),
    enabled: !!strategyName && !!symbol,
    staleTime: 1000 * 60 * 60, // 1 hour - optimized params don't change often
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
 * Run a parameter optimization
 */
export function useRunOptimization() {
  const queryClient = useQueryClient();

  return useMutation<OptimizationResult, Error, OptimizationRequest>({
    mutationFn: runOptimization,
    onSuccess: (result) => {
      // Invalidate and refetch all optimizations
      queryClient.invalidateQueries({ queryKey: optimizationQueryKeys.all });

      // Cache the new result
      queryClient.setQueryData(
        optimizationQueryKeys.optimized(result.strategyName, result.symbol),
        result
      );
    },
  });
}

/**
 * Delete an optimization result
 */
export function useDeleteOptimization() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { strategyName: string; symbol: string }>({
    mutationFn: ({ strategyName, symbol }) => deleteOptimization(strategyName, symbol),
    onSuccess: (_, { strategyName, symbol }) => {
      // Invalidate all optimizations list
      queryClient.invalidateQueries({ queryKey: optimizationQueryKeys.all });

      // Remove from cache
      queryClient.removeQueries({
        queryKey: optimizationQueryKeys.optimized(strategyName, symbol),
      });
    },
  });
}
