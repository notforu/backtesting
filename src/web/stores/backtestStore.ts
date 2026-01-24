/**
 * Zustand store for managing backtest state.
 * Provides global state for the current backtest result and UI state.
 */

import { create } from 'zustand';
import type { BacktestResult, RunBacktestRequest, Timeframe } from '../types';

// ============================================================================
// Backtest Store
// ============================================================================

interface BacktestStore {
  // Current backtest result
  currentResult: BacktestResult | null;

  // UI state
  isRunning: boolean;
  error: string | null;

  // Selected backtest from history
  selectedBacktestId: string | null;

  // Actions
  setResult: (result: BacktestResult) => void;
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
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialCapital: number;
  exchange: string;

  // Actions
  setStrategy: (strategy: string) => void;
  setParams: (params: Record<string, unknown>) => void;
  updateParam: (key: string, value: unknown) => void;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setInitialCapital: (capital: number) => void;
  setExchange: (exchange: string) => void;
  getConfig: () => RunBacktestRequest;
  reset: () => void;
}

// Default dates: 1 year ago to today
const getDefaultDates = () => {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);

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
  timeframe: '1h' as Timeframe,
  startDate: defaultDates.startDate,
  endDate: defaultDates.endDate,
  initialCapital: 10000,
  exchange: 'binance',
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
  setTimeframe: (timeframe) => set({ timeframe }),
  setStartDate: (startDate) => set({ startDate }),
  setEndDate: (endDate) => set({ endDate }),
  setInitialCapital: (initialCapital) => set({ initialCapital }),
  setExchange: (exchange) => set({ exchange }),

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
