/**
 * Zustand store for managing scanner state.
 * Tracks multi-market scan results and progress.
 */

import { create } from 'zustand';
import type { ScanResultRow, ScanSummary } from '../types';

interface ScannerStore {
  // State
  scanResults: ScanResultRow[];
  isScanning: boolean;
  scanProgress: { current: number; total: number } | null;
  scanSummary: ScanSummary | null;
  scanError: string | null;
  selectedMarkets: string[]; // PM:slug format

  // Actions
  startScan: () => void;
  addResult: (result: ScanResultRow) => void;
  setScanProgress: (progress: { current: number; total: number } | null) => void;
  setScanSummary: (summary: ScanSummary) => void;
  setScanError: (error: string | null) => void;
  setSelectedMarkets: (markets: string[]) => void;
  toggleMarket: (market: string) => void;
  clearResults: () => void;
  clearAll: () => void;
}

export const useScannerStore = create<ScannerStore>((set) => ({
  // Initial state
  scanResults: [],
  isScanning: false,
  scanProgress: null,
  scanSummary: null,
  scanError: null,
  selectedMarkets: [],

  // Actions
  startScan: () =>
    set({
      scanResults: [],
      isScanning: true,
      scanProgress: null,
      scanSummary: null,
      scanError: null,
    }),

  addResult: (result) =>
    set((state) => ({
      scanResults: [...state.scanResults, result],
    })),

  setScanProgress: (progress) =>
    set({ scanProgress: progress }),

  setScanSummary: (summary) =>
    set({
      scanSummary: summary,
      isScanning: false,
      scanProgress: null,
    }),

  setScanError: (error) =>
    set({
      scanError: error,
      isScanning: false,
      scanProgress: null,
    }),

  setSelectedMarkets: (markets) =>
    set({ selectedMarkets: markets }),

  toggleMarket: (market) =>
    set((state) => {
      const exists = state.selectedMarkets.includes(market);
      return {
        selectedMarkets: exists
          ? state.selectedMarkets.filter((m) => m !== market)
          : [...state.selectedMarkets, market],
      };
    }),

  clearResults: () =>
    set({
      scanResults: [],
      scanSummary: null,
      scanError: null,
      scanProgress: null,
    }),

  clearAll: () =>
    set({
      scanResults: [],
      isScanning: false,
      scanProgress: null,
      scanSummary: null,
      scanError: null,
      selectedMarkets: [],
    }),
}));
