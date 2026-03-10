/**
 * Zustand store for managing optimization progress state.
 */

import { create } from 'zustand';

interface OptimizationProgress {
  current: number;
  total: number;
  percent: number;
}

interface OptimizationStore {
  // State
  isOptimizing: boolean;
  optimizationProgress: OptimizationProgress | null;
  optimizationError: string | null;
  usingOptimizedParams: boolean;

  // Actions
  setOptimizing: (optimizing: boolean) => void;
  setProgress: (progress: OptimizationProgress | null) => void;
  setOptimizationError: (error: string | null) => void;
  setUsingOptimizedParams: (using: boolean) => void;
  clearOptimization: () => void;
}

export const useOptimizationStore = create<OptimizationStore>((set) => ({
  // Initial state
  isOptimizing: false,
  optimizationProgress: null,
  optimizationError: null,
  usingOptimizedParams: false,

  // Actions
  setOptimizing: (optimizing) =>
    set({
      isOptimizing: optimizing,
      optimizationError: optimizing ? null : undefined, // Clear error when starting
    }),

  setProgress: (progress) =>
    set({
      optimizationProgress: progress,
    }),

  setOptimizationError: (error) =>
    set({
      optimizationError: error,
      isOptimizing: false,
      optimizationProgress: null,
    }),

  setUsingOptimizedParams: (using) =>
    set({
      usingOptimizedParams: using,
    }),

  clearOptimization: () =>
    set({
      isOptimizing: false,
      optimizationProgress: null,
      optimizationError: null,
    }),
}));
