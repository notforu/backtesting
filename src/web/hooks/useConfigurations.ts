/**
 * React Query hooks for strategy configuration data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStrategyConfigs,
  getStrategyConfig,
  createStrategyConfig,
  deleteStrategyConfig,
  getStrategyConfigRuns,
  getStrategyConfigVersions,
  getConfigPaperSessions,
} from '../api/client.js';

export function useStrategyConfigs(filters?: { strategy?: string; symbol?: string; timeframe?: string }) {
  return useQuery({
    queryKey: ['strategy-configs', filters],
    queryFn: () => getStrategyConfigs(filters),
    refetchInterval: 30000,
  });
}

export function useStrategyConfig(id: string | null) {
  return useQuery({
    queryKey: ['strategy-config', id],
    queryFn: () => getStrategyConfig(id!),
    enabled: !!id,
  });
}

export function useStrategyConfigRuns(id: string | null) {
  return useQuery({
    queryKey: ['strategy-config-runs', id],
    queryFn: () => getStrategyConfigRuns(id!),
    enabled: !!id,
  });
}

export function useStrategyConfigVersions(strategy: string, symbol: string, timeframe: string) {
  return useQuery({
    queryKey: ['strategy-config-versions', strategy, symbol, timeframe],
    queryFn: () => getStrategyConfigVersions(strategy, symbol, timeframe),
    enabled: !!strategy && !!symbol && !!timeframe,
  });
}

export function useConfigPaperSessions(configId: string | null) {
  return useQuery({
    queryKey: ['config-paper-sessions', configId],
    queryFn: () => getConfigPaperSessions(configId!),
    enabled: !!configId,
    refetchInterval: 15000,
  });
}

export function useCreateStrategyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStrategyConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}

export function useDeleteStrategyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteStrategyConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategy-configs'] });
    },
  });
}
