/**
 * Paper Trading - Price Watcher
 *
 * Uses CCXT Pro watchTickers (Bybit WebSocket) to stream real-time mark prices
 * for all symbols held across active paper trading sessions. Computes per-session
 * equity and emits throttled callbacks to the SessionManager.
 *
 * No API keys are required — only public Bybit WebSocket topics are used.
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
  /** Last emission timestamp (ms) — used for throttling */
  lastEmittedAt: number;
}

// ============================================================================
// PriceWatcher
// ============================================================================

/** Minimum ms between equity update emissions per session (2 seconds). */
const EMIT_THROTTLE_MS = 2_000;

export class PriceWatcher {
  /** CCXT Pro Bybit exchange instance (shared across all sessions). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private exchange: any;

  /** Map of sessionId -> session snapshot. */
  private sessions: Map<string, SessionSnapshot> = new Map();

  /** True once start() has been called and while the loop is active. */
  private running = false;

  /** True once the first non-empty tick has been logged. */
  private loggedFirstTick = false;

  /** Resolves when watchLoop() should stop (set by stop()). */
  private stopSignal: (() => void) | null = null;

  constructor() {
    // ccxt.pro is exported as a named property on the default ccxt import.
    // TypeScript types include it but we cast to any to avoid declaration issues.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ccxtAny = ccxt as any;
    this.exchange = new ccxtAny.pro.bybit({
      options: {
        defaultType: 'swap',
      },
    });
  }

  // --------------------------------------------------------------------------
  // Session registration
  // --------------------------------------------------------------------------

  /**
   * Register a session for real-time equity tracking.
   * If the PriceWatcher is already running, the new session's symbols are
   * automatically included in the next watchTickers call.
   *
   * @param sessionId  Unique session ID
   * @param symbols    CCXT-format symbols held by this session (e.g. "BTC/USDT:USDT")
   * @param cash       Current available cash balance
   * @param positions  Current open positions
   * @param callback   Called with an EquityUpdate every ~2 s while prices move
   */
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
      lastEmittedAt: 0,
    });

    console.log(
      `[PriceWatcher] Registered session ${sessionId} — symbols: [${symbols.join(', ')}]`,
    );
  }

  /**
   * Remove a session from real-time equity tracking.
   * If no sessions remain, the watch loop is automatically stopped.
   */
  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[PriceWatcher] Unregistered session ${sessionId}`);

    // If no sessions remain, stop the loop to avoid idle connections
    if (this.sessions.size === 0 && this.running) {
      console.log('[PriceWatcher] No sessions remaining — stopping watch loop');
      this.stop().catch(err => {
        console.error('[PriceWatcher] Error stopping after last session removed:', err);
      });
    }
  }

  /**
   * Update the cash and position snapshot for a session.
   * Called after each engine tick so the next equity computation uses fresh data.
   */
  updateSessionState(
    sessionId: string,
    cash: number,
    positions: PaperPosition[],
  ): void {
    const snapshot = this.sessions.get(sessionId);
    if (!snapshot) return;
    snapshot.cash = cash;
    snapshot.positions = positions;
    // Add any new position symbols (don't clear existing ones from initial registration)
    for (const p of positions) {
      snapshot.symbols.add(p.symbol);
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the WebSocket watch loop.
   * Safe to call multiple times — does nothing if already running.
   * Also does nothing if no sessions are registered.
   */
  start(): void {
    if (this.running) return;
    if (this.sessions.size === 0) {
      console.log('[PriceWatcher] No sessions registered — start() deferred');
      return;
    }

    this.running = true;
    console.log('[PriceWatcher] Starting watch loop');

    // Run the loop in the background; errors are caught inside watchLoop()
    void this.watchLoop();
  }

  /**
   * Stop the WebSocket watch loop and close the exchange connection.
   * Safe to call if not running.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.stopSignal) {
      this.stopSignal();
      this.stopSignal = null;
    }

    try {
      await this.exchange.close();
    } catch {
      // Ignore close errors
    }

    console.log('[PriceWatcher] Stopped');
  }

  // --------------------------------------------------------------------------
  // Internal loop
  // --------------------------------------------------------------------------

  /**
   * Core WebSocket loop.
   *
   * CCXT Pro's watchTickers() resolves with updated tickers each time new
   * price data arrives. We loop continuously: after each resolution we compute
   * equity for every registered session and emit throttled callbacks.
   *
   * CCXT Pro handles reconnection automatically, so we just log errors and
   * continue looping (unless stop() has been called).
   */
  private async watchLoop(): Promise<void> {
    while (this.running) {
      // Collect all symbols across all sessions
      const allSymbols = this.collectAllSymbols();
      if (allSymbols.length === 0) {
        // No symbols to watch — still emit equity = cash for all sessions
        const now = Date.now();
        for (const [, snapshot] of this.sessions) {
          if (now - snapshot.lastEmittedAt < EMIT_THROTTLE_MS) continue;
          const update = this.computeEquity(snapshot, {}, now);
          if (update) {
            snapshot.lastEmittedAt = now;
            try {
              snapshot.callback(update);
            } catch {
              // ignore
            }
          }
        }
        await this.sleep(2_000);
        continue;
      }

      try {
        // watchTickers resolves each time any ticker updates
        const tickers = await this.exchange.watchTickers(allSymbols);

        if (!this.running) break;

        // Extract mark prices from the returned ticker map
        const markPrices: Record<string, number> = {};
        for (const [symbol, ticker] of Object.entries(tickers)) {
          // CCXT normalises the mark price onto ticker.markPrice (number | undefined)
          // Fall back to ticker.info.markPrice (string from raw Bybit response)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = ticker as any;
          const mark =
            typeof t.markPrice === 'number'
              ? t.markPrice
              : typeof t.info?.markPrice === 'string'
                ? parseFloat(t.info.markPrice)
                : undefined;

          if (mark !== undefined && !isNaN(mark) && mark > 0) {
            markPrices[symbol] = mark;
          }
        }

        if (!this.loggedFirstTick && Object.keys(markPrices).length > 0) {
          console.log(`[PriceWatcher] Receiving prices for ${Object.keys(markPrices).length} symbols`);
          this.loggedFirstTick = true;
        }

        // Emit equity updates for each registered session
        const now = Date.now();
        for (const [sessionId, snapshot] of this.sessions) {
          // Throttle per session
          if (now - snapshot.lastEmittedAt < EMIT_THROTTLE_MS) continue;

          // Check that we have mark prices for at least one of the session symbols
          const hasAnyPrice = snapshot.positions.some(
            p => markPrices[p.symbol] !== undefined,
          );
          // Allow emission even with no positions (equity = cash)
          if (!hasAnyPrice && snapshot.positions.length > 0) continue;

          const update = this.computeEquity(snapshot, markPrices, now);
          if (update) {
            snapshot.lastEmittedAt = now;
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
        if (!this.running) break;

        // Log and continue — CCXT Pro will reconnect automatically
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[PriceWatcher] watchTickers error (will retry): ${errMsg}`);

        // Short back-off before retrying to avoid tight error loops
        await this.sleep(1_000);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Collect the union of all symbols across all registered sessions.
   */
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
   * Compute equity for a session snapshot using the provided mark prices.
   *
   * Equity = cash + sum of position values at mark price
   *
   * Position value:
   *   - Long:  markPrice * amount
   *   - Short: (2 * entryPrice - markPrice) * amount
   *     (this is collateral + unrealized PnL, keeping value positive when trade is profitable)
   */
  private computeEquity(
    snapshot: SessionSnapshot,
    markPrices: Record<string, number>,
    now: number,
  ): EquityUpdate | null {
    if (snapshot.positions.length === 0) {
      // No open positions — equity equals cash
      return {
        equity: snapshot.cash,
        cash: snapshot.cash,
        positionsValue: 0,
        markPrices,
        timestamp: now,
      };
    }

    let positionsValue = 0;
    const relevantMarkPrices: Record<string, number> = {};

    for (const pos of snapshot.positions) {
      const mark = markPrices[pos.symbol];
      if (mark === undefined) {
        // Use entry price as fallback if mark price unavailable for this symbol
        const fallback =
          pos.direction === 'long'
            ? pos.entryPrice * pos.amount
            : pos.entryPrice * pos.amount; // same value either way (no PnL known)
        positionsValue += fallback;
        continue;
      }

      relevantMarkPrices[pos.symbol] = mark;

      if (pos.direction === 'long') {
        positionsValue += mark * pos.amount;
      } else {
        // Short: collateral (entryPrice * amount) + unrealized PnL (entryPrice - markPrice) * amount
        // = (2 * entryPrice - markPrice) * amount
        positionsValue += (2 * pos.entryPrice - mark) * pos.amount;
      }
    }

    const equity = snapshot.cash + positionsValue;

    return {
      equity,
      cash: snapshot.cash,
      positionsValue,
      markPrices: relevantMarkPrices,
      timestamp: now,
    };
  }

  /** Simple promise-based sleep helper. */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance shared across the application
export const priceWatcher = new PriceWatcher();
