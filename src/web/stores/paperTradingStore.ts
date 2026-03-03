/**
 * Zustand store for managing paper trading UI state.
 */

import { create } from 'zustand';

interface PaperTradingStore {
  selectedSessionId: string | null;
  isCreateModalOpen: boolean;
  activePage: 'backtesting' | 'paper-trading';

  setSelectedSession: (id: string | null) => void;
  setCreateModalOpen: (open: boolean) => void;
  setActivePage: (page: 'backtesting' | 'paper-trading') => void;
}

export const usePaperTradingStore = create<PaperTradingStore>((set) => ({
  selectedSessionId: null,
  isCreateModalOpen: false,
  activePage: 'paper-trading',

  setSelectedSession: (id) => set({ selectedSessionId: id }),
  setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
  setActivePage: (page) => set({ activePage: page }),
}));
