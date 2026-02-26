/**
 * Zustand store for managing paper trading UI state.
 */

import { create } from 'zustand';

interface PaperTradingStore {
  selectedSessionId: string | null;
  isCreateModalOpen: boolean;

  setSelectedSession: (id: string | null) => void;
  setCreateModalOpen: (open: boolean) => void;
}

export const usePaperTradingStore = create<PaperTradingStore>((set) => ({
  selectedSessionId: null,
  isCreateModalOpen: false,

  setSelectedSession: (id) => set({ selectedSessionId: id }),
  setCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
}));
