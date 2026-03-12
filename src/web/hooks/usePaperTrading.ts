/**
 * React Query hooks and SSE subscription hook for paper trading.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useRef, useMemo } from 'react';
import {
  listPaperSessions,
  getPaperSession,
  createPaperSession,
  deletePaperSession,
  startPaperSession,
  pausePaperSession,
  resumePaperSession,
  stopPaperSession,
  getPaperTrades,
  getPaperEquity,
  forcePaperTick,
  subscribePaperSession,
  getPaperSessionEvents,
} from '../api/client';
import type { PaperTradingEvent, CreatePaperSessionRequest, PaperSessionDetail } from '../types';
import { useRealtimeEquityStore } from '../stores/realtimeEquityStore';

// Query key factories
const SESSIONS_KEY = ['paper-sessions'] as const;
const sessionKey = (id: string) => ['paper-session', id] as const;
const tradesKey = (id: string) => ['paper-trades', id] as const;
const equityKey = (id: string) => ['paper-equity', id] as const;
const eventsKey = (id: string) => ['paper-events', id] as const;

export function usePaperSessions() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: listPaperSessions,
    refetchInterval: 30000,
  });
}

export function usePaperSession(id: string | null) {
  return useQuery({
    queryKey: sessionKey(id ?? ''),
    queryFn: () => getPaperSession(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });
}

export function usePaperTrades(id: string | null, limit = 20) {
  return useQuery({
    queryKey: [...tradesKey(id ?? ''), limit],
    queryFn: () => getPaperTrades(id!, limit, 0),
    enabled: !!id,
  });
}

export function usePaperAllTrades(id: string | null) {
  return useQuery({
    queryKey: [...tradesKey(id ?? ''), 'all'],
    queryFn: () => getPaperTrades(id!, 10000, 0),
    enabled: !!id,
  });
}

export function usePaperEquity(id: string | null) {
  return useQuery({
    queryKey: equityKey(id ?? ''),
    queryFn: () => getPaperEquity(id!),
    enabled: !!id,
  });
}

export function usePaperSessionEvents(id: string | null) {
  return useQuery({
    queryKey: eventsKey(id ?? ''),
    queryFn: () => getPaperSessionEvents(id!, 100, 0),
    enabled: !!id,
    refetchInterval: 30000, // Refresh every 30s
  });
}

export function useCreatePaperSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePaperSessionRequest) => createPaperSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

export function useDeletePaperSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePaperSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

export function usePaperSessionControl(sessionId: string | null) {
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    }
  }, [queryClient, sessionId]);

  const start = useMutation({
    mutationFn: () => startPaperSession(sessionId!),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => pausePaperSession(sessionId!),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => resumePaperSession(sessionId!),
    onSuccess: invalidate,
  });
  const stop = useMutation({
    mutationFn: () => stopPaperSession(sessionId!),
    onSuccess: invalidate,
  });
  const tick = useMutation({
    mutationFn: () => forcePaperTick(sessionId!),
    onSuccess: invalidate,
  });

  return { start, pause, resume, stop, tick };
}

export function usePaperSessionSSE(sessionId: string | null) {
  const queryClient = useQueryClient();
  const setEquity = useRealtimeEquityStore((s) => s.setEquity);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const handleEvent = (event: PaperTradingEvent) => {
      switch (event.type) {
        case 'equity_update':
        case 'tick_complete':
          queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: equityKey(sessionId) });
          break;
        case 'trade_opened':
        case 'trade_closed':
          queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: tradesKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: equityKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: eventsKey(sessionId) });
          break;
        case 'status_change':
          queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
          queryClient.invalidateQueries({ queryKey: eventsKey(sessionId) });
          break;
        case 'funding_payment':
        case 'error':
          queryClient.invalidateQueries({ queryKey: eventsKey(sessionId) });
          break;
        case 'realtime_equity_update': {
          // Write to the Zustand store — this is the single source of truth for
          // real-time equity across all components (sidebar, detail header, chart).
          setEquity(sessionId, {
            equity: event.equity,
            cash: event.cash,
            positionsValue: event.positionsValue,
            markPrices: event.markPrices ?? {},
            timestamp: event.timestamp,
          });

          // Also keep positions' unrealizedPnl in sync for the detail view
          queryClient.setQueryData(sessionKey(sessionId), (old: unknown) => {
            if (!old || typeof old !== 'object') return old;
            const session = old as PaperSessionDetail;
            const updatedPositions = Array.isArray(session.positions)
              ? session.positions.map((pos) => {
                  const mark = event.markPrices?.[pos.symbol];
                  if (mark === undefined) return pos;
                  const pnl =
                    pos.direction === 'long'
                      ? (mark - pos.entryPrice) * pos.amount
                      : (pos.entryPrice - mark) * pos.amount;
                  return { ...pos, unrealizedPnl: pnl };
                })
              : session.positions;
            return { ...session, positions: updatedPositions };
          });
          break;
        }
        default:
          break;
      }
    };

    unsubRef.current = subscribePaperSession(sessionId, handleEvent);

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [sessionId, queryClient, setEquity]);
}

// ============================================================================
// useSessionEquity — single source of truth for equity across all components
// ============================================================================

export interface SessionEquityValues {
  equity: number;
  cash: number;
  positionsValue: number;
  returnPct: number;
  /** The timestamp of the real-time update, if one exists. Null when falling back to DB data. */
  realtimeTimestamp: number | null;
}

/**
 * Returns the most up-to-date equity for a session.
 * Real-time values from the SSE store take precedence over DB-backed React Query data.
 * Falls back to the React Query session data when no real-time update exists yet.
 */
export function useSessionEquity(sessionId: string | null): SessionEquityValues | null {
  const realtimeEquity = useRealtimeEquityStore((s) =>
    sessionId ? s.realtimeEquity[sessionId] : undefined,
  );
  const { data: session } = usePaperSession(sessionId);

  return useMemo(() => {
    if (!session) return null;

    const equity = realtimeEquity?.equity ?? session.currentEquity;
    const cash = realtimeEquity?.cash ?? session.currentCash;
    const positionsValue = realtimeEquity?.positionsValue ?? (session.currentEquity - session.currentCash);
    const returnPct =
      session.initialCapital > 0
        ? ((equity - session.initialCapital) / session.initialCapital) * 100
        : 0;
    const realtimeTimestamp = realtimeEquity?.timestamp ?? null;

    return { equity, cash, positionsValue, returnPct, realtimeTimestamp };
  }, [realtimeEquity, session]);
}
