/**
 * Zustand store for managing paper trading UI state.
 */

import { create } from 'zustand';

export type ActivePage = 'backtesting' | 'configurations' | 'paper-trading';

interface PaperTradingStore {
  selectedSessionId: string | null;
  isCreateModalOpen: boolean;
  activePage: ActivePage;

  setSelectedSession: (id: string | null) => void;
  setCreateModalOpen: (open: boolean) => void;
  setActivePage: (page: ActivePage) => void;
}

export const usePaperTradingStore = create<PaperTradingStore>((set) => ({
  selectedSessionId: null,
  isCreateModalOpen: false,
  activePage: 'paper-trading',

  setSelectedSession: (id) => set({ selectedSessionId: id }),
  setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
  setActivePage: (page) => set({ activePage: page }),
}));
