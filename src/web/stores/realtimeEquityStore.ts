/**
 * Realtime equity store — ephemeral in-memory store for real-time equity updates
 * received via SSE `realtime_equity_update` events.
 *
 * This is the single source of truth for live equity between ticks.
 * After a tick completes, React Query's DB-backed cache becomes the fallback.
 */

import { create } from 'zustand';

export interface RealtimeEquityData {
  equity: number;
  cash: number;
  positionsValue: number;
  markPrices: Record<string, number>;
  timestamp: number;
}

interface RealtimeEquityState {
  /** sessionId -> latest real-time equity snapshot */
  realtimeEquity: Record<string, RealtimeEquityData>;
  setEquity: (sessionId: string, data: RealtimeEquityData) => void;
  clearEquity: (sessionId: string) => void;
}

export const useRealtimeEquityStore = create<RealtimeEquityState>((set) => ({
  realtimeEquity: {},

  setEquity: (sessionId, data) =>
    set((state) => ({
      realtimeEquity: {
        ...state.realtimeEquity,
        [sessionId]: data,
      },
    })),

  clearEquity: (sessionId) =>
    set((state) => {
      const next = { ...state.realtimeEquity };
      delete next[sessionId];
      return { realtimeEquity: next };
    }),
}));
