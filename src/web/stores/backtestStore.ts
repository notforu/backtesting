/**
 * Zustand store for managing backtest state.
 * Provides global state for the current backtest result and UI state.
 */

import { create } from 'zustand';
import type { BacktestResult, PairsBacktestResult, RunBacktestRequest, Timeframe } from '../types';

// ============================================================================
// Backtest Store
// ============================================================================

interface BacktestStore {
  // Current backtest result
  currentResult: BacktestResult | PairsBacktestResult | null;

  // UI state
  isRunning: boolean;
  error: string | null;

  // Selected backtest from history
  selectedBacktestId: string | null;

  // Actions
  setResult: (result: BacktestResult | PairsBacktestResult) => void;
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

// ============================================================================
// Config Store - Persist form state
// ============================================================================

interface ConfigStore {
  // Form values
  strategy: string;
  params: Record<string, unknown>;
  symbol: string;
  symbolB: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange: string;
  leverage: number;

  // Actions
  setStrategy: (strategy: string) => void;
  setParams: (params: Record<string, unknown>) => void;
  updateParam: (key: string, value: unknown) => void;
  setSymbol: (symbol: string) => void;
  setSymbolB: (symbolB: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setInitialCapital: (capital: number) => void;
  setExchange: (exchange: string) => void;
  setLeverage: (leverage: number) => void;
  getConfig: () => RunBacktestRequest;
  reset: () => void;
}

// Default dates: 1 month ago to today
const getDefaultDates = () => {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
};

const defaultDates = getDefaultDates();

const defaultConfigState = {
  strategy: '',
  params: {},
  symbol: 'BTCUSDT',
  symbolB: '',
  timeframe: '1h' as Timeframe,
  startDate: defaultDates.startDate,
  endDate: defaultDates.endDate,
  initialCapital: 10000,
  exchange: 'binance',
  leverage: 1,
};

export const useConfigStore = create<ConfigStore>((set, get) => ({
  ...defaultConfigState,

  setStrategy: (strategy) => set({ strategy, params: {} }),
  setParams: (params) => set({ params }),
  updateParam: (key, value) =>
    set((state) => ({
      params: { ...state.params, [key]: value },
    })),
  setSymbol: (symbol) => set({ symbol }),
  setSymbolB: (symbolB) => set({ symbolB }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setStartDate: (startDate) => set({ startDate }),
  setEndDate: (endDate) => set({ endDate }),
  setInitialCapital: (initialCapital) => set({ initialCapital }),
  setExchange: (exchange) => set({ exchange }),
  setLeverage: (leverage) => set({ leverage }),

  getConfig: () => {
    const state = get();
    return {
      strategyName: state.strategy,
      params: state.params,
      symbol: state.symbol,
      timeframe: state.timeframe,
      startDate: state.startDate,
      endDate: state.endDate,
      initialCapital: state.initialCapital,
      exchange: state.exchange,
    };
  },

  reset: () => set(defaultConfigState),
}));

// ============================================================================
// Optimization Store
// ============================================================================

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

// ============================================================================
// Optimizer Modal Store
// ============================================================================

interface OptimizerModalStore {
  isOptimizerModalOpen: boolean;
  optimizerModalTab: 'setup' | 'history';
  setOptimizerModalOpen: (open: boolean) => void;
  setOptimizerModalTab: (tab: 'setup' | 'history') => void;
}

export const useOptimizerModalStore = create<OptimizerModalStore>((set) => ({
  isOptimizerModalOpen: false,
  optimizerModalTab: 'setup',
  setOptimizerModalOpen: (open) => set({ isOptimizerModalOpen: open }),
  setOptimizerModalTab: (tab) => set({ optimizerModalTab: tab }),
}));
