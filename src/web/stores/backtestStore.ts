/**
 * Zustand store for managing backtest state.
 * Provides global state for the current backtest result and UI state.
 */

import { create } from 'zustand';
import type { BacktestResult, AggregateBacktestResult } from '../types';

// ============================================================================
// Backtest Store
// ============================================================================

interface BacktestStore {
  // Current backtest result
  currentResult: BacktestResult | AggregateBacktestResult | null;

  // UI state
  isRunning: boolean;
  error: string | null;

  // Selected backtest from history
  selectedBacktestId: string | null;

  // Actions
  setResult: (result: BacktestResult | AggregateBacktestResult) => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedBacktestId: (id: string | null) => void;
  clear: () => void;
}

export const useBacktestStore = create<BacktestStore>((set) => ({
  // Initial state
  currentResult: null,
  isRunning: false,
  error: null,
  selectedBacktestId: null,

  // Actions
  setResult: (result) =>
    set({
      currentResult: result,
      isRunning: false,
      error: null,
      selectedBacktestId: result.id,
    }),

  setRunning: (running) =>
    set({
      isRunning: running,
      error: running ? null : undefined, // Clear error when starting
    }),

  setError: (error) =>
    set({
      error,
      isRunning: false,
    }),

  setSelectedBacktestId: (id) =>
    set({
      selectedBacktestId: id,
    }),

  clear: () =>
    set({
      currentResult: null,
      isRunning: false,
      error: null,
      selectedBacktestId: null,
    }),
}));

// Re-export from split store files for backward compatibility
export { useConfigStore } from './configStore';
export { useOptimizationStore } from './optimizationStore';
export { useOptimizerModalStore } from './optimizerModalStore';
