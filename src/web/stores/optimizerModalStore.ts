/**
 * Zustand store for managing optimizer modal UI state.
 */

import { create } from 'zustand';

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
