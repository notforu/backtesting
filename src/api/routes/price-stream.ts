/**
 * Price Stream Route
 *
 * SSE endpoint that proxies Bybit WebSocket kline (candlestick) data to the client.
 * Supports shared WebSocket connections — multiple SSE clients watching the same
 * symbol/timeframe share a single upstream Bybit WS connection.
 *
 * GET /api/paper-trading/price-stream?exchange=bybit&symbol=BTC/USDT:USDT&timeframe=1m
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

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

export interface PriceStreamEvent {
  type: 'kline';
  symbol: string;
  timeframe: string;
  candle: PriceStreamCandle;
  confirm: boolean;
}

// ============================================================================
// Bybit WebSocket helpers
// ============================================================================

/** Map CCXT/app timeframe strings → Bybit kline interval identifiers */
const TIMEFRAME_TO_BYBIT: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

/** Convert CCXT symbol (BTC/USDT:USDT) → Bybit symbol (BTCUSDT) */
function toBybitSymbol(ccxtSymbol: string): string {
  // Remove the settlement currency suffix if present (e.g. ":USDT")
  const base = ccxtSymbol.split(':')[0];
  // Remove the slash separator
  return base.replace('/', '');
}

/** Bybit public WS URL for linear (USDT-margined) perpetuals */
const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/linear';

/** Connection key used to share WS connections across SSE clients */
type ConnectionKey = string;

function makeKey(bybitSymbol: string, bybitInterval: string): ConnectionKey {
  return `${bybitSymbol}:${bybitInterval}`;
}

// ============================================================================
// Shared connection pool
// ============================================================================

/**
 * A shared upstream Bybit WebSocket connection.
 * Multiple SSE clients for the same symbol/timeframe share one WS connection.
 */
interface SharedConnection {
  ws: WebSocket;
  listeners: Set<(event: PriceStreamEvent) => void>;
  pingInterval: ReturnType<typeof setInterval> | null;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

const pool = new Map<ConnectionKey, SharedConnection>();

function openSharedConnection(
  key: ConnectionKey,
  bybitSymbol: string,
  bybitInterval: string,
  ccxtSymbol: string,
  timeframe: string,
): SharedConnection {
  const listeners = new Set<(event: PriceStreamEvent) => void>();

  const connect = (): WebSocket => {
    const ws = new WebSocket(BYBIT_WS_URL);

    ws.addEventListener('open', () => {
      // Subscribe to kline topic
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: [`kline.${bybitInterval}.${bybitSymbol}`],
        }),
      );

      // Keep-alive ping every 20 seconds (Bybit drops idle connections after 30s)
      if (conn.pingInterval) clearInterval(conn.pingInterval);
      conn.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 20_000);
    });

    ws.addEventListener('message', (msgEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(msgEvent.data as string);
      } catch {
        return;
      }

      const msg = data as {
        topic?: string;
        data?: Array<{
          start: number;
          open: string;
          high: string;
          low: string;
          close: string;
          volume: string;
          confirm: boolean;
        }>;
      };

      const expectedTopic = `kline.${bybitInterval}.${bybitSymbol}`;
      if (msg.topic !== expectedTopic || !Array.isArray(msg.data) || msg.data.length === 0) {
        return;
      }

      const kline = msg.data[0];
      const streamEvent: PriceStreamEvent = {
        type: 'kline',
        symbol: ccxtSymbol,
        timeframe,
        candle: {
          timestamp: Number(kline.start),
          open: parseFloat(kline.open),
          high: parseFloat(kline.high),
          low: parseFloat(kline.low),
          close: parseFloat(kline.close),
          volume: parseFloat(kline.volume),
        },
        confirm: kline.confirm,
      };

      // Broadcast to all SSE listeners
      for (const listener of listeners) {
        try {
          listener(streamEvent);
        } catch {
          // Listener errored (client disconnected) — will be cleaned up separately
        }
      }
    });

    ws.addEventListener('error', () => {
      // Error is followed by close — handled in close handler
    });

    ws.addEventListener('close', () => {
      if (conn.pingInterval) {
        clearInterval(conn.pingInterval);
        conn.pingInterval = null;
      }

      if (conn.closed) return;

      // Attempt reconnect after 5 seconds if there are still listeners
      if (listeners.size > 0) {
        conn.reconnectTimeout = setTimeout(() => {
          if (conn.closed || listeners.size === 0) return;
          conn.ws = connect();
        }, 5_000);
      }
    });

    return ws;
  };

  const conn: SharedConnection = {
    ws: null as unknown as WebSocket, // assigned immediately below
    listeners,
    pingInterval: null,
    reconnectTimeout: null,
    closed: false,
  };

  conn.ws = connect();
  pool.set(key, conn);
  return conn;
}

function getOrCreateConnection(
  key: ConnectionKey,
  bybitSymbol: string,
  bybitInterval: string,
  ccxtSymbol: string,
  timeframe: string,
): SharedConnection {
  const existing = pool.get(key);
  if (existing && !existing.closed) return existing;
  return openSharedConnection(key, bybitSymbol, bybitInterval, ccxtSymbol, timeframe);
}

function removeListener(key: ConnectionKey, listener: (event: PriceStreamEvent) => void): void {
  const conn = pool.get(key);
  if (!conn) return;

  conn.listeners.delete(listener);

  // Close and remove the shared connection if no more listeners
  if (conn.listeners.size === 0) {
    conn.closed = true;
    if (conn.pingInterval) {
      clearInterval(conn.pingInterval);
      conn.pingInterval = null;
    }
    if (conn.reconnectTimeout) {
      clearTimeout(conn.reconnectTimeout);
      conn.reconnectTimeout = null;
    }
    try {
      conn.ws.close();
    } catch {
      // Ignore close errors
    }
    pool.delete(key);
  }
}

// ============================================================================
// Route schema
// ============================================================================

const PriceStreamQuerySchema = z.object({
  exchange: z.string().min(1).default('bybit'),
  symbol: z.string().min(1),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']),
});

// ============================================================================
// Route plugin
// ============================================================================

export async function priceStreamRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/paper-trading/price-stream
   *
   * Query params:
   *   exchange  - e.g. "bybit"
   *   symbol    - e.g. "BTC/USDT:USDT"
   *   timeframe - e.g. "1m"
   *
   * Returns an SSE stream of kline events while the client is connected.
   * Multiple clients for the same symbol/timeframe share a single Bybit WS connection.
   */
  fastify.get(
    '/api/paper-trading/price-stream',
    async (
      request: FastifyRequest<{ Querystring: Record<string, string> }>,
      reply: FastifyReply,
    ) => {
      let parsed: z.infer<typeof PriceStreamQuerySchema>;
      try {
        parsed = PriceStreamQuerySchema.parse(request.query);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        throw error;
      }

      const { symbol, timeframe } = parsed;
      // Currently only Bybit linear is supported; exchange param is reserved for future use
      const bybitSymbol = toBybitSymbol(symbol);
      const bybitInterval = TIMEFRAME_TO_BYBIT[timeframe];

      if (!bybitInterval) {
        return reply.status(400).send({ error: `Unsupported timeframe: ${timeframe}` });
      }

      const key = makeKey(bybitSymbol, bybitInterval);

      // Set SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      // Send connected event immediately
      reply.raw.write(
        `data: ${JSON.stringify({ type: 'connected', symbol, timeframe })}\n\n`,
      );

      // Register listener on the shared connection
      const conn = getOrCreateConnection(key, bybitSymbol, bybitInterval, symbol, timeframe);

      const listener = (event: PriceStreamEvent): void => {
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // Client disconnected; the close handler below will clean up
        }
      };

      conn.listeners.add(listener);

      // Clean up when client disconnects
      request.raw.on('close', () => {
        removeListener(key, listener);
      });

      // Keep the SSE connection alive — never resolves until client disconnects
      await new Promise<void>(() => {});
    },
  );
}
