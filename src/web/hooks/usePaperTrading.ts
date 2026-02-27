/**
 * React Query hooks and SSE subscription hook for paper trading.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useCallback, useRef } from 'react';
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
} from '../api/client';
import type { PaperTradingEvent, CreatePaperSessionRequest } from '../types';

// Query key factories
const SESSIONS_KEY = ['paper-sessions'] as const;
const sessionKey = (id: string) => ['paper-session', id] as const;
const tradesKey = (id: string) => ['paper-trades', id] as const;
const equityKey = (id: string) => ['paper-equity', id] as const;

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
          break;
        case 'status_change':
          queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
          break;
        default:
          break;
      }
    };

    unsubRef.current = subscribePaperSession(sessionId, handleEvent);

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [sessionId, queryClient]);
}
