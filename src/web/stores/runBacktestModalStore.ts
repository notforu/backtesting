/**
 * Zustand store for managing the RunBacktestModal open/close state and prefill data.
 */

import { create } from 'zustand';

export interface PrefillConfig {
  strategyName: string;
  symbol: string;
  timeframe: string;
  params: Record<string, unknown>;
}

interface RunBacktestModalStore {
  isOpen: boolean;
  prefillConfig: PrefillConfig | null;
  open: (prefill?: PrefillConfig) => void;
  close: () => void;
}

export const useRunBacktestModalStore = create<RunBacktestModalStore>((set) => ({
  isOpen: false,
  prefillConfig: null,
  open: (prefill) => set({ isOpen: true, prefillConfig: prefill ?? null }),
  close: () => set({ isOpen: false, prefillConfig: null }),
}));
