/**
 * usePriceStream — React hook for real-time candlestick updates via SSE.
 *
 * Connects to /api/paper-trading/price-stream and returns the latest forming
 * (or just-closed) candle for the requested symbol/timeframe.
 * The connection is opened only when `params` is non-null and is cleaned up
 * on unmount or when params change.
 */

import { useState, useEffect, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface PriceStreamCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceStreamEvent {
  type: 'kline' | 'connected';
  symbol: string;
  timeframe: string;
  candle?: PriceStreamCandle;
  confirm?: boolean;
}

export interface PriceStreamParams {
  exchange: string;
  symbol: string;
  timeframe: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Subscribe to real-time price updates for a given symbol/timeframe.
 *
 * @param params - Connection parameters, or null to disconnect / not connect.
 * @returns The latest candle received from the stream, or null if not yet received.
 */
export function usePriceStream(params: PriceStreamParams | null): PriceStreamCandle | null {
  const [latestCandle, setLatestCandle] = useState<PriceStreamCandle | null>(null);
  // Keep a stable ref so the abort controller cleanup doesn't capture stale state
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset candle when params change (including disconnect)
    setLatestCandle(null);

    if (!params) return;

    const { exchange, symbol, timeframe } = params;
    const queryString = new URLSearchParams({ exchange, symbol, timeframe }).toString();
    const url = `/api/paper-trading/price-stream?${queryString}`;

    const controller = new AbortController();
    abortRef.current = controller;

    let active = true;

    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok || !response.body) {
          console.warn('[usePriceStream] SSE connection failed:', response.status);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE messages are separated by double newlines
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            if (!chunk.startsWith('data: ')) continue;
            const jsonStr = chunk.slice(6); // strip "data: " prefix
            try {
              const event = JSON.parse(jsonStr) as PriceStreamEvent;
              if (event.type === 'kline' && event.candle) {
                setLatestCandle({ ...event.candle });
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      } catch (err) {
        // AbortError is expected on cleanup — don't log it
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[usePriceStream] SSE error:', err);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      abortRef.current = null;
    };
  }, [params?.exchange, params?.symbol, params?.timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  return latestCandle;
}
