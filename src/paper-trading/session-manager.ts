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
import { priceWatcher } from './price-watcher.js';
import { RiskManager } from '../risk/risk-manager.js';
import { getPlatformSetting } from '../data/db.js';

/**
 * Hour of the day (UTC) at which the daily summary digest is sent.
 * Change this constant to move the digest to a different time without
 * touching the scheduling logic.
 */
export const DAILY_DIGEST_HOUR_UTC = 9;

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
    userId?: string;
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
      userId: params.userId,
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

      // Attach RiskManager (reads kill switch settings from DB)
      const rm = await this.createRiskManager(session);
      engine.setRiskManager(rm);

      // Forward all paper-events to registered SSE listeners, Telegram, and event log
      this.registerEngineEventHandlers(engine, sessionId, session.name);
    }

    await engine.start();

    // Register session with PriceWatcher for real-time equity updates
    await this.registerWithPriceWatcher(sessionId, session);

    // Schedule daily summary at 09:00 UTC (only if Telegram is configured)
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
    // Stop real-time equity updates when session is paused
    priceWatcher.unregisterSession(sessionId);
  }

  /**
   * Resume a paused or errored session.
   * Recreates the engine from DB if it is not in memory (e.g. after server restart).
   * Also handles sessions in 'error' state by creating a new engine and starting it.
   */
  async resumeSession(sessionId: string): Promise<void> {
    let engine = this.engines.get(sessionId);

    if (!engine) {
      // Engine not in memory — recreate from DB (e.g. after server restart while paused/errored)
      const session = await paperDb.getPaperSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      engine = new PaperTradingEngine(session);
      this.engines.set(sessionId, engine);

      // Attach RiskManager (reads kill switch settings from DB)
      const rm = await this.createRiskManager(session);
      engine.setRiskManager(rm);

      // Forward events to SSE listeners, Telegram, and event log
      this.registerEngineEventHandlers(engine, sessionId, session.name);

      // Schedule daily summary if Telegram configured
      if (TelegramNotifier.isConfigured()) {
        this.scheduleDailySummary(sessionId, session.name, engine);
      }

      // Freshly created engine has _status='stopped', so call start() not resume()
      await engine.start();

      // Register session with PriceWatcher for real-time equity updates
      await this.registerWithPriceWatcher(sessionId, session);
      return;
    }

    // Engine is in memory — call resume() which now handles both 'paused' and 'error' states
    await engine.resume();

    // Re-register with PriceWatcher after resume
    const session = await paperDb.getPaperSession(sessionId);
    if (session) {
      await this.registerWithPriceWatcher(sessionId, session);
    }
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
    // Stop real-time equity updates when session is stopped
    priceWatcher.unregisterSession(sessionId);
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
   * Called at server startup: find all sessions that were 'running' or 'paused'
   * at last shutdown and restore their engines.
   */
  async restoreActiveSessions(): Promise<void> {
    const sessions = await paperDb.listPaperSessions();
    const restorableSessions = sessions.filter(
      s => s.status === 'running' || s.status === 'paused',
    );

    console.log(
      `[SessionManager] Found ${restorableSessions.length} active session(s) to restore`,
    );

    for (const session of restorableSessions) {
      try {
        console.log(
          `[SessionManager] Restoring session: ${session.name} (${session.id}) [was ${session.status}]`,
        );
        // resumeSession handles creating engine from DB and starting it
        await this.resumeSession(session.id);
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

    // Pause all engines so they can be restored on restart.
    // The engine's own pause() guard handles the 'not running' case gracefully.
    for (const [sessionId, engine] of this.engines) {
      try {
        await engine.pause();
      } catch (err) {
        console.error(
          `[SessionManager] Error pausing engine ${sessionId}:`,
          err,
        );
      }
    }
    this.engines.clear();
    this.eventListeners.clear();

    // Shut down the PriceWatcher WebSocket connection
    try {
      await priceWatcher.stop();
    } catch (err) {
      console.error('[SessionManager] Error stopping PriceWatcher:', err);
    }
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
  // RiskManager factory (private)
  // --------------------------------------------------------------------------

  /**
   * Create a RiskManager for a session, reading kill switch settings from the
   * platform_settings table.  Falls back to safe defaults if the key is absent.
   */
  private async createRiskManager(session: PaperSession): Promise<RiskManager> {
    let killSwitchEnabled = true;
    let killSwitchDDPercent = 30;

    try {
      const raw = await getPlatformSetting('kill_switch_pt');
      if (raw && typeof raw === 'object' && raw !== null) {
        const cfg = raw as Record<string, unknown>;
        if (typeof cfg.enabled === 'boolean') killSwitchEnabled = cfg.enabled;
        if (typeof cfg.ddPercent === 'number' && cfg.ddPercent > 0 && cfg.ddPercent < 100) {
          killSwitchDDPercent = cfg.ddPercent;
        }
      }
    } catch (err) {
      console.warn('[SessionManager] Could not load kill_switch_pt setting, using defaults:', err);
    }

    const maxPositions = session.aggregationConfig.maxPositions ?? 5;
    return new RiskManager({
      maxCapital: session.initialCapital,
      maxTradeSize: session.initialCapital * 0.5,
      maxPositions,
      killSwitchEnabled,
      killSwitchDDPercent,
      symbolWhitelist: [],
    });
  }

  // --------------------------------------------------------------------------
  // Engine event handler wiring (private)
  // --------------------------------------------------------------------------

  /**
   * Wire up event forwarding for an engine:
   * - Forward to SSE listeners
   * - Forward to Telegram
   * - Persist to event log DB
   */
  private registerEngineEventHandlers(
    engine: PaperTradingEngine,
    sessionId: string,
    sessionName: string,
  ): void {
    engine.on('paper-event', (event: PaperTradingEvent) => {
      // Forward to SSE listeners
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

      // After tick completes, update the PriceWatcher with fresh position state
      if (event.type === 'tick_complete' || event.type === 'equity_update') {
        this.syncPriceWatcherState(sessionId);
      }

      // Forward to Telegram
      this.handleTelegramNotification(event, sessionName);

      // Persist to event log
      this.persistEvent(event, sessionName);
    });
  }

  /**
   * Register a session with the PriceWatcher for real-time equity updates.
   * Fetches current positions from DB and starts the watch loop if not already running.
   */
  private async registerWithPriceWatcher(sessionId: string, session: PaperSession): Promise<void> {
    try {
      const positions = await paperDb.getPaperPositions(sessionId);

      // Build the symbol list from both the aggregation config sub-strategies
      // and any currently open positions (for sessions that may have drifted)
      const symbolSet = new Set<string>();
      for (const sub of session.aggregationConfig.subStrategies) {
        symbolSet.add(sub.symbol);
      }
      for (const pos of positions) {
        symbolSet.add(pos.symbol);
      }

      const symbols = Array.from(symbolSet);

      priceWatcher.registerSession(
        sessionId,
        symbols,
        session.currentCash,
        positions,
        (update) => {
          const event: PaperTradingEvent = {
            type: 'realtime_equity_update',
            sessionId,
            equity: update.equity,
            cash: update.cash,
            positionsValue: update.positionsValue,
            markPrices: update.markPrices,
            timestamp: update.timestamp,
          };
          // Forward directly to SSE listeners (not persisted, not sent to Telegram)
          const listeners = this.eventListeners.get(sessionId);
          if (listeners && listeners.size > 0) {
            for (const listener of listeners) {
              try {
                listener(event);
              } catch {
                // Client disconnected — SSE cleanup handles removal
              }
            }
          }
        },
      );

      // Start the watch loop (no-op if already running)
      priceWatcher.start();
    } catch (err) {
      console.error(
        `[SessionManager] Failed to register session ${sessionId} with PriceWatcher:`,
        err,
      );
    }
  }

  /**
   * After an engine tick, refresh the PriceWatcher's position snapshot from the DB
   * so the next equity computation reflects the latest opened/closed positions.
   * Fire-and-forget.
   */
  private syncPriceWatcherState(sessionId: string): void {
    // Fetch both session (for currentCash) and positions in parallel
    Promise.all([
      paperDb.getPaperSession(sessionId),
      paperDb.getPaperPositions(sessionId),
    ])
      .then(([session, positions]) => {
        if (!session) return;
        priceWatcher.updateSessionState(sessionId, session.currentCash, positions);
      })
      .catch(err => {
        console.error(`[SessionManager] syncPriceWatcherState error for ${sessionId}:`, err);
      });
  }

  /**
   * Format and persist a paper trading event to the database.
   * Fire-and-forget — errors are logged but never thrown.
   */
  private persistEvent(event: PaperTradingEvent, sessionName: string): void {
    // Skip noisy / ephemeral events
    if (
      event.type === 'equity_update' ||
      event.type === 'tick_complete' ||
      event.type === 'realtime_equity_update'
    ) return;

    let type: string = event.type;
    let message: string;
    let details: Record<string, unknown> | null = null;

    switch (event.type) {
      case 'trade_opened': {
        const t = event.trade;
        const dir = t.action === 'open_long' ? 'long' : 'short';
        const sym = t.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
        message = `Opened ${dir} ${sym} — ${t.amount.toFixed(4)} @ $${t.price.toFixed(2)}`;
        details = { tradeId: t.id, symbol: t.symbol, action: t.action, price: t.price, amount: t.amount };
        break;
      }
      case 'trade_closed': {
        const t = event.trade;
        const dir = t.action === 'close_long' ? 'long' : 'short';
        const sym = t.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
        const pnlStr = t.pnl != null ? `$${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : 'N/A';
        const pctStr = t.pnlPercent != null ? `(${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%)` : '';
        message = `Closed ${dir} ${sym} — PnL: ${pnlStr} ${pctStr}`.trim();
        details = { tradeId: t.id, symbol: t.symbol, action: t.action, price: t.price, amount: t.amount, pnl: t.pnl, pnlPercent: t.pnlPercent };
        break;
      }
      case 'funding_payment': {
        const sym = event.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
        const sign = event.amount >= 0 ? '+' : '';
        message = `Funding payment: ${sym} ${sign}$${event.amount.toFixed(4)}`;
        details = { symbol: event.symbol, amount: event.amount, equity: event.equity };
        break;
      }
      case 'error': {
        message = `Error: ${event.message}`;
        details = { error: event.message };
        break;
      }
      case 'status_change': {
        message = `Status: ${event.oldStatus} → ${event.newStatus}`;
        details = { oldStatus: event.oldStatus, newStatus: event.newStatus };
        break;
      }
      case 'retry': {
        const nextAt = new Date(event.nextRetryAt).toISOString();
        message = `Retry ${event.retryCount}: ${event.error} (next at ${nextAt})`;
        type = 'retry';
        details = { retryCount: event.retryCount, nextRetryAt: event.nextRetryAt, error: event.error };
        break;
      }
      case 'kill_switch_triggered': {
        message = `Kill switch triggered: ${event.reason} (equity: $${event.equity.toFixed(2)})`;
        details = { reason: event.reason, equity: event.equity };
        break;
      }
      case 'trade_rejected': {
        message = `Trade rejected for ${event.symbol}: ${event.reason}`;
        details = { symbol: event.symbol, reason: event.reason };
        break;
      }
      default:
        return;
    }

    paperDb.savePaperSessionEvent({
      sessionId: event.sessionId,
      type,
      message,
      details,
    }).catch(err => {
      console.error(`[SessionManager] Failed to persist event for ${sessionName}:`, err);
    });
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
      case 'kill_switch_triggered':
        telegram.sendMessage(
          `<b>KILL SWITCH TRIGGERED</b>\nSession: ${sessionName}\nReason: ${event.reason}\nEquity: $${event.equity.toFixed(2)}\nAll positions closed. Session paused.`,
        ).catch(err => {
          console.error('[SessionManager] Telegram kill_switch error:', err);
        });
        break;
      // funding_payment, equity_update, tick_complete, trade_rejected: not forwarded to Telegram
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
   * Schedule daily summary notifications at DAILY_DIGEST_HOUR_UTC (09:00 UTC).
   * Sets a one-time timeout to the next occurrence of that hour, then a recurring 24h interval.
   */
  private scheduleDailySummary(
    sessionId: string,
    sessionName: string,
    _engine: PaperTradingEngine,
  ): void {

    // Calculate ms until next 09:00 UTC
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(DAILY_DIGEST_HOUR_UTC, 0, 0, 0);

    // If the target hour today has already passed (or is exactly now), schedule for tomorrow
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    const msUntilDigest = next.getTime() - now.getTime();

    const timer = setTimeout(() => {
      void this.sendDailySummary(sessionId, sessionName);

      // Set up recurring 24h interval
      const interval = setInterval(() => {
        void this.sendDailySummary(sessionId, sessionName);
      }, 24 * 60 * 60 * 1000);

      this.dailySummaryTimers.set(sessionId, interval);
    }, msUntilDigest);

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
