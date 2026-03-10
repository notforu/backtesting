/**
 * Zustand store for managing form configuration state.
 */

import { create } from 'zustand';
import type { BacktestResult, AggregateBacktestResult, RunBacktestRequest, Timeframe } from '../types';

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
  leverage: number;
  mode: 'spot' | 'futures';
  _configSource: 'dropdown' | 'history' | 'init';

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
  setLeverage: (leverage: number) => void;
  setMode: (mode: 'spot' | 'futures') => void;
  getConfig: () => RunBacktestRequest;
  applyHistoryParams: (result: BacktestResult | AggregateBacktestResult) => void;
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
  timeframe: '1h' as Timeframe,
  startDate: defaultDates.startDate,
  endDate: defaultDates.endDate,
  initialCapital: 10000,
  exchange: 'binance',
  leverage: 1,
  mode: 'spot' as const,
  _configSource: 'init' as const,
};

export const useConfigStore = create<ConfigStore>((set, get) => ({
  ...defaultConfigState,

  setStrategy: (strategy) => set({ strategy, params: {}, _configSource: 'dropdown' }),
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
  setLeverage: (leverage) => set({ leverage }),
  setMode: (mode) => set({ mode }),

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
      mode: state.mode,
    };
  },

  applyHistoryParams: (result: BacktestResult | AggregateBacktestResult) => {
    const config = result.config as any;
    set({
      strategy: config.strategyName,
      params: config.params,
      symbol: config.symbol,
      timeframe: config.timeframe,
      startDate: new Date(config.startDate).toISOString().split('T')[0],
      endDate: new Date(config.endDate).toISOString().split('T')[0],
      initialCapital: config.initialCapital,
      exchange: config.exchange,
      leverage: 1,
      mode: config.mode || 'spot',
      _configSource: 'history',
    });
  },

  reset: () => set(defaultConfigState),
}));
