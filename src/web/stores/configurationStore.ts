/**
 * Zustand store for managing the Configurations page UI state.
 */

import { create } from 'zustand';

interface ConfigurationStore {
  // Tab
  activeConfigTab: 'strategies' | 'aggregations';
  setActiveConfigTab: (tab: 'strategies' | 'aggregations') => void;

  // Selection
  selectedConfigId: string | null;
  setSelectedConfigId: (id: string | null) => void;

  // Detail tabs
  activeDetailTab: 'runs' | 'paper' | 'versions';
  setActiveDetailTab: (tab: 'runs' | 'paper' | 'versions') => void;

  // Filters
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  filterStrategy: string;
  setFilterStrategy: (s: string) => void;
  filterSymbol: string;
  setFilterSymbol: (s: string) => void;
}

export const useConfigurationStore = create<ConfigurationStore>((set) => ({
  activeConfigTab: 'strategies',
  setActiveConfigTab: (tab) => set({ activeConfigTab: tab }),
  selectedConfigId: null,
  setSelectedConfigId: (id) => set({ selectedConfigId: id }),
  activeDetailTab: 'runs',
  setActiveDetailTab: (tab) => set({ activeDetailTab: tab }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  filterStrategy: '',
  setFilterStrategy: (s) => set({ filterStrategy: s }),
  filterSymbol: '',
  setFilterSymbol: (s) => set({ filterSymbol: s }),
}));
