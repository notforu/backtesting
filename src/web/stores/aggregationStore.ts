/**
 * Zustand store for managing aggregation state.
 * Provides global state for the aggregation panel.
 */

import { create } from 'zustand';

interface AggregationStore {
  // Active tab in the sidebar config panel
  activeConfigTab: 'strategies' | 'aggregations';

  // Selected aggregation for viewing/running
  selectedAggregationId: string | null;

  // Run config (date range for selected aggregation)
  startDate: string;
  endDate: string;
  initialCapital: number;

  // Create modal state
  isCreateModalOpen: boolean;

  // Actions
  setActiveConfigTab: (tab: 'strategies' | 'aggregations') => void;
  setSelectedAggregation: (id: string | null) => void;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  setInitialCapital: (capital: number) => void;
  setCreateModalOpen: (open: boolean) => void;
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

export const useAggregationStore = create<AggregationStore>((set) => ({
  activeConfigTab: 'strategies',
  selectedAggregationId: null,
  startDate: defaultDates.startDate,
  endDate: defaultDates.endDate,
  initialCapital: 10000,
  isCreateModalOpen: false,

  setActiveConfigTab: (tab) => set({ activeConfigTab: tab }),
  setSelectedAggregation: (id) => set({ selectedAggregationId: id }),
  setStartDate: (startDate) => set({ startDate }),
  setEndDate: (endDate) => set({ endDate }),
  setInitialCapital: (initialCapital) => set({ initialCapital }),
  setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
}));
