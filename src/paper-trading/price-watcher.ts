/**
 * Paper Trading - Price Watcher
 *
 * Polls Bybit mark prices via CCXT REST every 2 seconds for all symbols
 * across active paper trading sessions. Computes per-session equity and
 * emits callbacks to the SessionManager for SSE forwarding.
 *
 * No API keys are required — only public Bybit REST endpoints are used.
 */

import ccxt from 'ccxt';
import type { PaperPosition } from './types.js';

// ============================================================================
// Public callback / types
// ============================================================================

export interface EquityUpdate {
  equity: number;
  cash: number;
  positionsValue: number;
  markPrices: Record<string, number>;
  timestamp: number;
}

type EquityCallback = (update: EquityUpdate) => void;

// ============================================================================
// Session state snapshot stored inside PriceWatcher
// ============================================================================

interface SessionSnapshot {
  symbols: Set<string>;
  cash: number;
  positions: PaperPosition[];
  callback: EquityCallback;
}

// ============================================================================
// PriceWatcher
// ============================================================================

/** Polling interval for mark prices (ms). */
const POLL_INTERVAL_MS = 2_000;

export class PriceWatcher {
  /** CCXT Bybit exchange instance (REST, no API keys). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private exchange: any;

  /** Map of sessionId -> session snapshot. */
  private sessions: Map<string, SessionSnapshot> = new Map();

  /** True once start() has been called and while the loop is active. */
  private running = false;

  /** Timer handle for the polling interval. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Latest mark prices (updated every poll). */
  private priceCache: Record<string, number> = {};

  constructor() {
    this.exchange = new ccxt.bybit({
      options: { defaultType: 'swap' },
    });
  }

  // --------------------------------------------------------------------------
  // Session registration
  // --------------------------------------------------------------------------

  registerSession(
    sessionId: string,
    symbols: string[],
    cash: number,
    positions: PaperPosition[],
    callback: EquityCallback,
  ): void {
    this.sessions.set(sessionId, {
      symbols: new Set(symbols),
      cash,
      positions,
      callback,
    });

    console.log(
      `[PriceWatcher] Registered session ${sessionId} — symbols: [${symbols.join(', ')}]`,
    );
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[PriceWatcher] Unregistered session ${sessionId}`);

    if (this.sessions.size === 0 && this.running) {
      console.log('[PriceWatcher] No sessions remaining — stopping');
      this.stop().catch(err => {
        console.error('[PriceWatcher] Error stopping:', err);
      });
    }
  }

  updateSessionState(
    sessionId: string,
    cash: number,
    positions: PaperPosition[],
  ): void {
    const snapshot = this.sessions.get(sessionId);
    if (!snapshot) return;
    snapshot.cash = cash;
    snapshot.positions = positions;
    for (const p of positions) {
      snapshot.symbols.add(p.symbol);
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    if (this.sessions.size === 0) {
      console.log('[PriceWatcher] No sessions registered — start() deferred');
      return;
    }

    this.running = true;
    console.log('[PriceWatcher] Starting price polling (every 2s)');

    // Do first poll immediately, then set interval
    void this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log('[PriceWatcher] Stopped');
  }

  // --------------------------------------------------------------------------
  // Polling
  // --------------------------------------------------------------------------

  /** True while a poll is in progress (prevents overlapping polls). */
  private polling = false;
  private pollCount = 0;

  private async poll(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;

    try {
      const allSymbols = this.collectAllSymbols();

      if (allSymbols.length > 0) {
        // Fetch all tickers in one REST call
        const tickers = await this.exchange.fetchTickers(allSymbols);

        for (const [symbol, ticker] of Object.entries(tickers)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = ticker as any;
          const mark =
            typeof t.markPrice === 'number'
              ? t.markPrice
              : typeof t.info?.markPrice === 'string'
                ? parseFloat(t.info.markPrice)
                : typeof t.last === 'number'
                  ? t.last
                  : undefined;

          if (mark !== undefined && !isNaN(mark) && mark > 0) {
            this.priceCache[symbol] = mark;
          }
        }
      }

      this.pollCount++;

      // Log first poll and periodic heartbeat (every 30 polls = ~60s)
      if (this.pollCount === 1) {
        console.log(
          `[PriceWatcher] First poll: ${Object.keys(this.priceCache).length} prices for ${this.sessions.size} sessions`,
        );
      } else if (this.pollCount % 30 === 0) {
        console.log(
          `[PriceWatcher] heartbeat: poll #${this.pollCount}, ${Object.keys(this.priceCache).length} prices, ${this.sessions.size} sessions`,
        );
      }

      // Emit equity updates for ALL registered sessions
      const now = Date.now();
      for (const [sessionId, snapshot] of this.sessions) {
        const update = this.computeEquity(snapshot, now);
        if (update) {
          try {
            snapshot.callback(update);
          } catch (err) {
            console.error(
              `[PriceWatcher] Callback error for session ${sessionId}:`,
              err,
            );
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[PriceWatcher] Poll error: ${errMsg}`);
    } finally {
      this.polling = false;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private collectAllSymbols(): string[] {
    const set = new Set<string>();
    for (const snapshot of this.sessions.values()) {
      for (const sym of snapshot.symbols) {
        set.add(sym);
      }
    }
    return Array.from(set);
  }

  /**
   * Compute equity for a session using cached mark prices.
   * Always returns an update (uses entry price as fallback for missing marks).
   */
  private computeEquity(
    snapshot: SessionSnapshot,
    now: number,
  ): EquityUpdate {
    if (snapshot.positions.length === 0) {
      return {
        equity: snapshot.cash,
        cash: snapshot.cash,
        positionsValue: 0,
        markPrices: {},
        timestamp: now,
      };
    }

    let positionsValue = 0;
    const relevantMarkPrices: Record<string, number> = {};

    for (const pos of snapshot.positions) {
      const mark = this.priceCache[pos.symbol];
      if (mark === undefined) {
        positionsValue += pos.entryPrice * pos.amount;
        continue;
      }

      relevantMarkPrices[pos.symbol] = mark;

      if (pos.direction === 'long') {
        positionsValue += mark * pos.amount;
      } else {
        positionsValue += (2 * pos.entryPrice - mark) * pos.amount;
      }
    }

    return {
      equity: snapshot.cash + positionsValue,
      cash: snapshot.cash,
      positionsValue,
      markPrices: relevantMarkPrices,
      timestamp: now,
    };
  }
}

// Singleton instance shared across the application
export const priceWatcher = new PriceWatcher();
