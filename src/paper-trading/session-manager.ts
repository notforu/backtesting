/**
 * Paper Trading - Session Manager
 *
 * Singleton that manages all active PaperTradingEngine instances.
 * Handles lifecycle (create/start/pause/resume/stop/delete),
 * SSE event subscriptions, and server startup/shutdown.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AggregateBacktestConfig } from '../core/signal-types.js';
import { PaperTradingEngine } from './engine.js';
import type { PaperSession, PaperTradingEvent } from './types.js';
import * as paperDb from './db.js';
import { TelegramNotifier } from '../notifications/telegram.js';

export class SessionManager {
  /** Map of sessionId -> active engine (only sessions with a running/paused engine) */
  private engines: Map<string, PaperTradingEngine> = new Map();

  /** Map of sessionId -> set of event listeners (for SSE) */
  private eventListeners: Map<string, Set<(event: PaperTradingEvent) => void>> = new Map();

  /** Lazily initialized Telegram notifier (undefined = not yet checked) */
  private telegram: TelegramNotifier | null | undefined = undefined;

  /** Daily summary timers keyed by sessionId */
  private dailySummaryTimers: Map<string, ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = new Map();

  // --------------------------------------------------------------------------
  // Create & Delete
  // --------------------------------------------------------------------------

  /**
   * Create a new paper trading session (persisted to DB, status = 'stopped').
   * Does not start the engine. Call startSession() separately.
   */
  async createSession(params: {
    name: string;
    aggregationConfig: AggregateBacktestConfig;
    aggregationConfigId?: string;
    initialCapital?: number;
  }): Promise<PaperSession> {
    const id = uuidv4();
    // Prefer explicit initialCapital override; fall back to config's value
    const capital = params.initialCapital ?? params.aggregationConfig.initialCapital;

    const session = await paperDb.createPaperSession({
      id,
      name: params.name,
      aggregationConfig: params.aggregationConfig,
      aggregationConfigId: params.aggregationConfigId ?? null,
      initialCapital: capital,
    });

    return session;
  }

  /**
   * Delete a session and all its data.
   * Stops the engine first if it is running.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId);
    if (engine) {
      await engine.stop();
      this.engines.delete(sessionId);
    }
    this.eventListeners.delete(sessionId);
    this.clearDailySummaryTimer(sessionId);
    await paperDb.deletePaperSession(sessionId);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start (or re-start) a session.
   * Creates an engine if one is not already in memory for this session.
   */
  async startSession(sessionId: string): Promise<void> {
    let engine = this.engines.get(sessionId);

    // Always fetch the session record so we have the name for Telegram notifications
    const session = await paperDb.getPaperSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!engine) {
      engine = new PaperTradingEngine(session);
      this.engines.set(sessionId, engine);

      // Forward all paper-events to registered SSE listeners and Telegram
      engine.on('paper-event', (event: PaperTradingEvent) => {
        const listeners = this.eventListeners.get(sessionId);
        if (listeners) {
          for (const listener of listeners) {
            try {
              listener(event);
            } catch (err) {
              console.error(`[SessionManager] Listener error for session ${sessionId}:`, err);
            }
          }
        }

        // Forward to Telegram (if configured)
        this.handleTelegramNotification(event, session.name);
      });
    }

    await engine.start();

    // Schedule daily summary at midnight UTC (only if Telegram is configured)
    if (TelegramNotifier.isConfigured()) {
      this.scheduleDailySummary(sessionId, session.name, engine);
    }
  }

  /**
   * Pause a running session (stops ticking, keeps portfolio state in memory).
   * If the engine is not in memory (e.g. after server restart), just update DB status.
   */
  async pauseSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId);
    if (!engine) {
      // No engine in memory — update DB status directly
      await paperDb.updatePaperSession(sessionId, { status: 'paused' });
      return;
    }
    await engine.pause();
  }

  /**
   * Resume a paused session.
   * Recreates the engine from DB if it is not in memory (e.g. after server restart).
   */
  async resumeSession(sessionId: string): Promise<void> {
    let engine = this.engines.get(sessionId);

    if (!engine) {
      // Engine not in memory — recreate from DB (e.g. after server restart while paused)
      const session = await paperDb.getPaperSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      engine = new PaperTradingEngine(session);
      this.engines.set(sessionId, engine);

      // Forward events to SSE listeners and Telegram
      engine.on('paper-event', (event: PaperTradingEvent) => {
        const listeners = this.eventListeners.get(sessionId);
        if (listeners) {
          for (const listener of listeners) {
            try {
              listener(event);
            } catch (err) {
              console.error(`[SessionManager] Listener error for session ${sessionId}:`, err);
            }
          }
        }
        this.handleTelegramNotification(event, session.name);
      });

      // Schedule daily summary if Telegram configured
      if (TelegramNotifier.isConfigured()) {
        this.scheduleDailySummary(sessionId, session.name, engine);
      }

      // Freshly created engine has _status='stopped', so call start() not resume()
      await engine.start();
      return;
    }

    await engine.resume();
  }

  /**
   * Stop a session: force-closes all positions and marks it stopped.
   * Removes the engine from memory.
   * If the engine is not in memory (e.g. after server restart), just update DB status.
   */
  async stopSession(sessionId: string): Promise<void> {
    const engine = this.engines.get(sessionId);
    if (!engine) {
      // No engine in memory — update DB status directly
      await paperDb.updatePaperSession(sessionId, { status: 'stopped' });
      return;
    }
    await engine.stop();
    this.engines.delete(sessionId);
    this.clearDailySummaryTimer(sessionId);
  }

  // --------------------------------------------------------------------------
  // Force tick (dev/testing only)
  // --------------------------------------------------------------------------

  /**
   * Immediately execute a single tick for the given session.
   * Creates the engine if it isn't in memory yet (but does NOT start the scheduler).
   */
  async forceTick(sessionId: string) {
    let engine = this.engines.get(sessionId);

    if (!engine) {
      const session = await paperDb.getPaperSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      engine = new PaperTradingEngine(session);
      this.engines.set(sessionId, engine);
    }

    return engine.forceTick();
  }

  // --------------------------------------------------------------------------
  // SSE subscription
  // --------------------------------------------------------------------------

  /**
   * Subscribe to real-time events for a session.
   * Returns an unsubscribe function — call it when the SSE connection closes.
   *
   * The listener will receive all PaperTradingEvent variants:
   *   trade_opened, trade_closed, funding_payment, equity_update,
   *   tick_complete, error, status_change
   */
  subscribe(
    sessionId: string,
    listener: (event: PaperTradingEvent) => void,
  ): () => void {
    if (!this.eventListeners.has(sessionId)) {
      this.eventListeners.set(sessionId, new Set());
    }
    this.eventListeners.get(sessionId)!.add(listener);

    // Return an unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.eventListeners.delete(sessionId);
        }
      }
    };
  }

  // --------------------------------------------------------------------------
  // Server startup / shutdown
  // --------------------------------------------------------------------------

  /**
   * Called at server startup: find all sessions that were 'running' at last
   * shutdown and restart their engines.
   */
  async restoreActiveSessions(): Promise<void> {
    const sessions = await paperDb.listPaperSessions();
    const runningSessions = sessions.filter(s => s.status === 'running');

    console.log(
      `[SessionManager] Found ${runningSessions.length} running session(s) to restore`,
    );

    for (const session of runningSessions) {
      try {
        console.log(
          `[SessionManager] Restoring session: ${session.name} (${session.id})`,
        );
        await this.startSession(session.id);
      } catch (error) {
        console.error(
          `[SessionManager] Failed to restore session ${session.id}:`,
          error,
        );
        await paperDb.updatePaperSession(session.id, {
          status: 'error',
          errorMessage: `Failed to restore: ${error instanceof Error ? error.message : 'unknown'}`,
        });
      }
    }
  }

  /**
   * Called at server shutdown: pause all running engines gracefully.
   * Uses pause (not stop) so positions remain open and sessions can be
   * restored on next startup.
   */
  async shutdownAll(): Promise<void> {
    console.log(
      `[SessionManager] Shutting down ${this.engines.size} active engine(s)`,
    );

    // Clear all daily summary timers
    for (const sessionId of this.dailySummaryTimers.keys()) {
      this.clearDailySummaryTimer(sessionId);
    }

    const promises: Promise<void>[] = [];
    for (const [sessionId, engine] of this.engines) {
      promises.push(
        engine.pause().catch(err => {
          console.error(
            `[SessionManager] Error pausing engine ${sessionId}:`,
            err,
          );
        }),
      );
    }

    await Promise.all(promises);
    this.engines.clear();
    this.eventListeners.clear();
  }

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  /** Get the engine instance for a session (undefined if not in memory). */
  getEngine(sessionId: string): PaperTradingEngine | undefined {
    return this.engines.get(sessionId);
  }

  /** True if a session has an in-memory engine in 'running' state. */
  isRunning(sessionId: string): boolean {
    return this.engines.get(sessionId)?.status === 'running';
  }

  /** Number of sessions currently loaded into memory (running or paused). */
  get activeCount(): number {
    return this.engines.size;
  }

  // --------------------------------------------------------------------------
  // Telegram integration (private)
  // --------------------------------------------------------------------------

  /**
   * Lazily initialize and return the TelegramNotifier.
   * Returns null when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set.
   */
  private getTelegram(): TelegramNotifier | null {
    if (this.telegram === undefined) {
      this.telegram = TelegramNotifier.fromEnv();
    }
    return this.telegram;
  }

  /**
   * Route a PaperTradingEvent to the appropriate Telegram notification method.
   * All calls are fire-and-forget — failures are logged but never thrown.
   */
  private handleTelegramNotification(event: PaperTradingEvent, sessionName: string): void {
    const telegram = this.getTelegram();
    if (!telegram) return;

    switch (event.type) {
      case 'trade_opened':
        telegram.notifyTradeOpened({ ...event.trade, sessionName }).catch(err => {
          console.error('[SessionManager] Telegram trade_opened error:', err);
        });
        break;
      case 'trade_closed':
        telegram.notifyTradeClosed({ ...event.trade, sessionName }).catch(err => {
          console.error('[SessionManager] Telegram trade_closed error:', err);
        });
        break;
      case 'error':
        telegram.notifySessionError(sessionName, event.message).catch(err => {
          console.error('[SessionManager] Telegram error notification error:', err);
        });
        break;
      case 'status_change':
        telegram.notifySessionStatusChange(sessionName, event.oldStatus, event.newStatus).catch(err => {
          console.error('[SessionManager] Telegram status_change error:', err);
        });
        break;
      // funding_payment, equity_update, tick_complete: not forwarded to Telegram
    }
  }

  /**
   * Send a daily summary for a session by querying current DB state.
   */
  private async sendDailySummary(sessionId: string, sessionName: string): Promise<void> {
    const telegram = this.getTelegram();
    if (!telegram) return;

    try {
      const session = await paperDb.getPaperSession(sessionId);
      if (!session) return;

      const positions = await paperDb.getPaperPositions(sessionId);
      // Fetch all trades (large limit) for daily summary stats
      const { trades, total: totalTrades } = await paperDb.getPaperTrades(sessionId, 10_000, 0);

      // Trades from the last 24 hours
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const todayTrades = trades.filter(t => t.timestamp >= dayAgo);
      const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

      await telegram.notifyDailySummary({
        sessionName,
        equity: session.currentEquity,
        initialCapital: session.initialCapital,
        openPositions: positions.length,
        totalTrades,
        todayTrades: todayTrades.length,
        todayPnl,
      });
    } catch (err) {
      console.error(`[SessionManager] Daily summary error for ${sessionId}:`, err);
    }
  }

  /**
   * Schedule daily summary notifications at 00:00 UTC.
   * Sets a one-time timeout to the next midnight, then a recurring 24h interval.
   */
  private scheduleDailySummary(
    sessionId: string,
    sessionName: string,
    _engine: PaperTradingEngine,
  ): void {

    // Calculate ms until next midnight UTC
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    const timer = setTimeout(() => {
      void this.sendDailySummary(sessionId, sessionName);

      // Set up recurring 24h interval
      const interval = setInterval(() => {
        void this.sendDailySummary(sessionId, sessionName);
      }, 24 * 60 * 60 * 1000);

      this.dailySummaryTimers.set(sessionId, interval);
    }, msUntilMidnight);

    this.dailySummaryTimers.set(sessionId, timer);
  }

  /**
   * Cancel and remove the daily summary timer for a session.
   */
  private clearDailySummaryTimer(sessionId: string): void {
    const timer = this.dailySummaryTimers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      clearInterval(timer as ReturnType<typeof setInterval>);
      this.dailySummaryTimers.delete(sessionId);
    }
  }

}

// Singleton instance shared across the API server
export const sessionManager = new SessionManager();
