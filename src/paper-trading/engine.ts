/**
 * Paper Trading Engine
 *
 * Mirrors runAggregateBacktest() from aggregate-engine.ts but operates on
 * one real-time tick at a time, driven by closed candle intervals.
 *
 * Design decisions:
 * - Adapter caching: adapters are created once per sub-strategy and reused across ticks.
 *   strategy.init() is only called on the first tick; subsequent ticks call appendCandles()
 *   to update candle data without losing strategy internal state.
 * - Shadow state restore: on the first tick after start/resume, DB positions are used
 *   to restore the adapter's shadow position so strategies see the right position state.
 * - 1-bar execution delay: uses the last CLOSED candle, not the forming bar
 * - Stale data guard: skips tick if latest candle is too old
 * - Per-tick candle cache: candles fetched once per unique symbol:timeframe per tick (M5)
 * - Multi-bar processing: processes ALL new bars since last tick to catch crossovers
 */

import { EventEmitter } from 'events';
import type { Candle, FundingRate } from '../core/types.js';
import { timeframeToMs } from '../core/types.js';
import type { AggregateBacktestConfig, SubStrategyConfig, Signal } from '../core/signal-types.js';
import { SignalAdapter } from '../core/signal-adapter.js';
import { MultiSymbolPortfolio } from '../core/multi-portfolio.js';
import { loadStrategy } from '../strategy/loader.js';
import type { Strategy } from '../strategy/base.js';
import { LiveDataFetcher } from './live-data.js';
import type { PaperSession, PaperTrade, PaperTradingEvent, TickResult } from './types.js';
import * as paperDb from './db.js';
import { saveFundingRates } from '../data/db.js';
import type { Trade } from '../core/types.js';
import type { RiskManager } from '../risk/risk-manager.js';

const WARMUP_CANDLES = 200; // Historical candles for strategy warmup
const MAX_RETRIES = 10; // Maximum transient error retries before giving up
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000]; // 30s, 1m, 2m, 5m, 10m, 15m

// ============================================================================
// Internal types
// ============================================================================

interface AdapterWithConfig {
  adapter: SignalAdapter;
  /** The underlying strategy instance — needed to call optional lifecycle hooks
   *  (e.g. onEnd) that are not exposed via the SignalAdapter public API. */
  strategy: Strategy;
  config: SubStrategyConfig;
  candles: Candle[];
  accumulatedFunding: number;
  /** Index of the first bar that is "new" since the last tick. Bars before this
   *  index are warmup bars and should not generate signals or exits. */
  newBarsStartIndex: number;
}

// ============================================================================
// PaperTradingEngine
// ============================================================================

export class PaperTradingEngine extends EventEmitter {
  readonly sessionId: string;

  private config: AggregateBacktestConfig;
  private portfolio: MultiSymbolPortfolio;
  private fetcher: LiveDataFetcher;

  // Active adapters for the current tick (populated at tick start, cleared after)
  private adapters: AdapterWithConfig[] = [];

  // Adapter cache — keyed by `${strategyName}:${symbol}:${timeframe}`.
  // Cached adapters persist strategy internal state across ticks so that
  // strategy.init() is only called once (on first encounter), not every tick.
  // Stores both the SignalAdapter (with shadow state) and the Strategy instance.
  private adapterCache: Map<string, { adapter: SignalAdapter; strategy: Strategy }> = new Map();

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: 'running' | 'paused' | 'stopped' | 'error' = 'stopped';
  private tickCount: number = 0;
  private lastTickAt: number | null = null;

  // Track last processed funding rate timestamp per symbol to avoid double-payments
  private lastProcessedFRTimestamps: Map<string, number> = new Map();

  // Track last processed candle timestamp per symbol:timeframe to detect new bars
  private lastProcessedCandleTs: Map<string, number> = new Map();

  // Guard against concurrent tick execution
  private isTicking: boolean = false;

  // Retry state — reset to 0 after a successful tick
  private retryCount: number = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;

  // Optional RiskManager — when set, every trade is validated before execution
  // and the kill switch is checked after every equity update.
  // When absent, the engine operates as before (backward compatible).
  private riskManager?: RiskManager;

  constructor(session: PaperSession) {
    super();
    this.sessionId = session.id;
    this.config = session.aggregationConfig;
    this.portfolio = new MultiSymbolPortfolio(session.initialCapital);
    this.fetcher = new LiveDataFetcher();
    this.tickCount = session.tickCount;
    this.lastTickAt = session.lastTickAt;

    // Initialize status from DB so event log shows correct transitions
    // (e.g. "paused → running" instead of "stopped → running" after server restart)
    const dbStatus = session.status as typeof this._status;
    if (dbStatus === 'paused' || dbStatus === 'error') {
      this._status = dbStatus;
    }
  }

  get status(): string {
    return this._status;
  }

  /** Attach a RiskManager to this engine. Must be called before the engine starts. */
  setRiskManager(rm: RiskManager): void {
    this.riskManager = rm;
  }

  get currentRetryCount(): number {
    return this.retryCount;
  }

  get currentLastError(): string | null {
    return this.lastError;
  }

  get currentLastErrorAt(): number | null {
    return this.lastErrorAt;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this._status === 'running') return;

    const oldStatus = this._status;
    this._status = 'running';

    // Reset retry state on start (may be restarting from error)
    this.retryCount = 0;
    this.lastError = null;
    this.lastErrorAt = null;

    // Restore portfolio state from DB before first tick
    await this.restoreState();

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'running' });
    await paperDb.updatePaperSession(this.sessionId, { status: 'running', errorMessage: null });

    // Run the first tick immediately, then schedule subsequent ticks
    this.scheduleTick(0);
  }

  async pause(): Promise<void> {
    if (this._status !== 'running') return;

    const oldStatus = this._status;
    this._status = 'paused';

    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'paused' });
    await paperDb.updatePaperSession(this.sessionId, { status: 'paused', nextTickAt: null });
  }

  async resume(): Promise<void> {
    if (this._status !== 'paused' && this._status !== 'error') return;

    const oldStatus = this._status;
    this._status = 'running';

    // Reset retry state on manual resume
    this.retryCount = 0;
    this.lastError = null;
    this.lastErrorAt = null;

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'running' });
    await paperDb.updatePaperSession(this.sessionId, { status: 'running', errorMessage: null });

    // Keep lastProcessedCandleTs so the next tick correctly identifies ALL bars
    // that were missed during the pause. The existing multi-bar processing loop
    // will process all new bars since lastProcessedCandleTs, preserving crossover signals.

    // Run a tick immediately on resume
    this.scheduleTick(0);
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped') return;

    const oldStatus = this._status;
    this._status = 'stopped';

    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    // M2: Notify strategies that the session is ending before clearing state.
    for (const awd of this.adapters) {
      try {
        awd.strategy.onEnd?.();
      } catch (err) {
        console.warn(
          `[PaperEngine ${this.sessionId}] Error calling onEnd for ${awd.config.strategyName}:`,
          err,
        );
      }
    }

    // Clear adapter list and cache on stop so a fresh start creates new adapters
    this.adapters = [];
    this.adapterCache.clear();

    // Force-close all open positions at current market prices
    await this.forceCloseAllPositions();

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'stopped' });
    await paperDb.updatePaperSession(this.sessionId, {
      status: 'stopped',
      currentEquity: this.portfolio.equity,
      currentCash: this.portfolio.cash,
      nextTickAt: null,
    });
  }

  /**
   * Cleanup for server shutdown — clears timers without touching DB.
   * Leaves DB status as 'running' so restoreActiveSessions() can restart on next boot.
   */
  shutdownCleanup(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this._status = 'stopped'; // local only, no DB write
  }

  /**
   * Force a single tick immediately. Useful for dev/testing without waiting for
   * the candle close timer. Does not schedule the next tick.
   */
  async forceTick(): Promise<TickResult> {
    return this.executeTick();
  }

  // ==========================================================================
  // State restoration
  // ==========================================================================

  private async restoreState(): Promise<void> {
    const session = await paperDb.getPaperSession(this.sessionId);
    if (!session) return;

    const positions = await paperDb.getPaperPositions(this.sessionId);

    // Rebuild portfolio with the correct cash balance.
    // Re-open each position with zero fee so the portfolio tracks amounts correctly,
    // then adjust cash to match the stored value (fees were already paid historically).
    this.portfolio = new MultiSymbolPortfolio(session.initialCapital);

    for (const pos of positions) {
      this.portfolio.updatePrice(pos.symbol, pos.entryPrice);
      if (pos.direction === 'long') {
        this.portfolio.openLong(pos.symbol, pos.amount, pos.entryPrice, pos.entryTime, 0);
      } else {
        this.portfolio.openShort(pos.symbol, pos.amount, pos.entryPrice, pos.entryTime, 0);
      }
    }

    // After zero-fee re-opens, cash may not match the stored value (because the
    // original opens had fees). Apply the difference as a funding adjustment.
    const cashDiff = session.currentCash - this.portfolio.cash;
    if (Math.abs(cashDiff) > 0.001) {
      this.portfolio.applyFundingPayment(cashDiff);
    }

    this.tickCount = session.tickCount;
    this.lastTickAt = session.lastTickAt;

    // lastProcessedCandleTs is intentionally left empty here.
    // On the next tick, each adapter will compute newBarsStartIndex relative to
    // lastTickAt (stored in the session), so we do not need to pre-populate it.
    // The map will be populated at the end of the first tick after restore.
  }

  // ==========================================================================
  // Tick scheduling
  // ==========================================================================

  private scheduleTick(delayMs: number): void {
    if (this._status !== 'running') return;

    this.tickTimer = setTimeout(async () => {
      if (this._status !== 'running') return;

      try {
        await this.executeTick();

        // Reset retry state after a successful tick
        this.retryCount = 0;
        this.lastError = null;
        this.lastErrorAt = null;

        // Schedule next tick aligned to the next candle close
        if (this._status === 'running') {
          const nextDelay = this.calculateNextTickDelay();
          const nextTickAt = Date.now() + nextDelay;
          await paperDb.updatePaperSession(this.sessionId, { nextTickAt });
          this.scheduleTick(nextDelay);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[PaperEngine ${this.sessionId}] Tick error:`, message);

        if (this.isTransientError(error)) {
          this.retryCount++;
          this.lastError = message;
          this.lastErrorAt = Date.now();

          if (this.retryCount > MAX_RETRIES) {
            // Too many retries — give up and set error state
            console.error(
              `[PaperEngine ${this.sessionId}] Max retries (${MAX_RETRIES}) exceeded, giving up`,
            );
            this._status = 'error';
            this.emitEvent({ type: 'error', sessionId: this.sessionId, message });
            this.emitEvent({
              type: 'status_change',
              sessionId: this.sessionId,
              oldStatus: 'running',
              newStatus: 'error',
            });
            await paperDb.updatePaperSession(this.sessionId, {
              status: 'error',
              errorMessage: `Max retries exceeded: ${message}`,
              nextTickAt: null,
            });
          } else {
            // Schedule retry with exponential backoff, keep status as 'running'
            const delay = this.getRetryDelay();
            const nextRetryAt = Date.now() + delay;
            console.warn(
              `[PaperEngine ${this.sessionId}] Transient error, retry ${this.retryCount}/${MAX_RETRIES} in ${delay / 1000}s: ${message}`,
            );

            this.emitEvent({
              type: 'retry',
              sessionId: this.sessionId,
              retryCount: this.retryCount,
              nextRetryAt,
              error: message,
            });

            await paperDb.updatePaperSession(this.sessionId, {
              errorMessage: `Retry ${this.retryCount}/${MAX_RETRIES}: ${message}`,
              nextTickAt: nextRetryAt,
            });

            this.scheduleTick(delay);
          }
        } else {
          // Fatal error — die immediately
          this._status = 'error';
          this.emitEvent({ type: 'error', sessionId: this.sessionId, message });
          this.emitEvent({
            type: 'status_change',
            sessionId: this.sessionId,
            oldStatus: 'running',
            newStatus: 'error',
          });

          await paperDb.updatePaperSession(this.sessionId, {
            status: 'error',
            errorMessage: message,
            nextTickAt: null,
          });
        }
      }
    }, delayMs);
  }

  /**
   * Classify an error as transient (network/rate-limit/temporary) or fatal (config/logic).
   * Transient errors should be retried; fatal errors should permanently stop the session.
   */
  private isTransientError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMsg = message.toLowerCase();

    // Fatal error patterns — config or strategy errors that won't resolve on retry
    const fatalPatterns = [
      'session not found',
      'strategy',
      'not found',
      'invalid config',
      'validation',
      'cannot read',
      'cannot access',
      'out of memory',
    ];

    for (const pattern of fatalPatterns) {
      if (lowerMsg.includes(pattern)) return false;
    }

    // Transient error patterns — network, rate limits, temporary issues
    const transientPatterns = [
      'network',
      'timeout',
      'timed out',
      'rate limit',
      'ratelimit',
      'too many requests',
      'econnreset',
      'econnrefused',
      'enotfound',
      'econnaborted',
      'etimedout',
      'connection refused',
      'connection reset',
      'socket hang up',
      '503',
      '502',
      '504',
      '429',
      'service unavailable',
      'bad gateway',
      'gateway timeout',
      'no candles',
      'stale',
      'fetch failed',
      'sqlite_busy',
      'database is locked',
      'connection pool',
      'pool timeout',
      'no valid sub-strategies',
    ];

    for (const pattern of transientPatterns) {
      if (lowerMsg.includes(pattern)) return true;
    }

    // Also treat Node.js network error codes as transient
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code) {
        const transientCodes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED'];
        if (transientCodes.includes(code)) return true;
      }
    }

    // Default: treat as transient (better to retry than to permanently fail)
    return true;
  }

  /**
   * Calculate the retry delay for the current retry count.
   * Uses exponential backoff: 30s, 1m, 2m, 5m, 10m, 15m (capped).
   */
  private getRetryDelay(): number {
    const index = Math.min(this.retryCount - 1, RETRY_DELAYS_MS.length - 1);
    return RETRY_DELAYS_MS[index];
  }

  /**
   * Calculate milliseconds until the next candle close, using the shortest
   * timeframe among sub-strategies. Adds a scaled buffer after candle close
   * to ensure the bar has fully settled (10% of the timeframe, max 30s).
   * This prevents drift on short timeframes like 1m where a 30s buffer would
   * cause every-other-minute ticking instead of every minute.
   */
  private calculateNextTickDelay(): number {
    let shortestTfMs = Infinity;
    for (const sub of this.config.subStrategies) {
      const tfMs = timeframeToMs(sub.timeframe);
      if (tfMs < shortestTfMs) shortestTfMs = tfMs;
    }

    if (!isFinite(shortestTfMs)) shortestTfMs = 4 * 60 * 60 * 1000; // Default 4h

    const now = Date.now();
    // Scale buffer with timeframe: 10% of TF, capped at 30s.
    // For 1m: 6s, for 5m: 30s, for 4h: 30s.
    const buffer = Math.min(30_000, Math.floor(shortestTfMs * 0.1));

    // Find the next candle close: smallest multiple of shortestTfMs strictly after now
    const nextClose = Math.ceil(now / shortestTfMs) * shortestTfMs;
    const delay = nextClose - now + buffer;

    // Minimum 2 seconds to prevent tight loops
    return Math.max(delay, 2_000);
  }

  // ==========================================================================
  // Main tick execution (mirrors aggregate-engine.ts lines 148-344)
  // ==========================================================================

  private async executeTick(): Promise<TickResult> {
    if (this.isTicking) {
      throw new Error('Tick already in progress');
    }
    this.isTicking = true;

    const tradesOpened: PaperTrade[] = [];
    const tradesClosed: PaperTrade[] = [];
    const fundingPayments: Array<{ symbol: string; amount: number }> = [];
    // wallClockTimestamp is used for lastTickAt, events, and the tick result timestamp.
    // The equity snapshot uses the latest candle timestamp instead (M3 fix).
    const wallClockTimestamp = Date.now();

    try {
      // ------------------------------------------------------------------
      // Step 1: Fetch funding rates for futures mode (per unique symbol).
      // M5 fix: Removed the redundant candle fetch from this step. Candles are
      // fetched in Step 2 via perSubCandleCache, which deduplicates by
      // symbol:timeframe. This eliminates one full round of network calls.
      // ------------------------------------------------------------------

      const frCache = new Map<string, FundingRate[]>(); // symbol -> funding rates

      if (this.config.mode === 'futures') {
        const uniqueSymbols = [...new Set(this.config.subStrategies.map(s => s.symbol))];
        for (const symbol of uniqueSymbols) {
          const fundingRates = await this.fetcher.fetchLatestFundingRates(symbol, 100);
          frCache.set(symbol, fundingRates);

          // Cache funding rates to DB so the chart can display them (fire-and-forget)
          if (fundingRates.length > 0) {
            saveFundingRates(fundingRates, this.config.exchange, symbol).catch(err => {
              console.warn(`[PaperEngine ${this.sessionId}] Failed to cache funding rates for ${symbol}:`, err);
            });
          }
        }
      }

      // ------------------------------------------------------------------
      // Step 2: Build adapters for each sub-strategy.
      // Candles are fetched per sub-strategy timeframe and cached by
      // symbol:timeframe so each unique pair is only fetched once per tick.
      // Also determine newBarsStartIndex: the index of the first candle that is
      // newer than the last processed candle for this symbol:timeframe pair.
      // ------------------------------------------------------------------

      this.adapters = [];
      const perSubCandleCache = new Map<string, Candle[]>(); // `${symbol}:${timeframe}` -> candles

      for (const subConfig of this.config.subStrategies) {
        const cacheKey = `${subConfig.symbol}:${subConfig.timeframe}`;

        let subCandles = perSubCandleCache.get(cacheKey);
        if (!subCandles) {
          subCandles = await this.fetcher.fetchLatestCandles(
            subConfig.symbol,
            subConfig.timeframe,
            WARMUP_CANDLES,
          );
          perSubCandleCache.set(cacheKey, subCandles);
        }

        if (subCandles.length === 0) {
          console.warn(
            `[PaperEngine ${this.sessionId}] No candles for ${subConfig.symbol} ${subConfig.timeframe}, skipping`,
          );
          continue;
        }

        // Stale data guard: the most recent closed candle should be within one
        // full bar of where we expect it based on the current time.
        const lastCandle = subCandles[subCandles.length - 1];
        const tfMs = timeframeToMs(subConfig.timeframe);
        const expectedLatestTs = Math.floor(Date.now() / tfMs) * tfMs - tfMs;
        const staleTolerance = tfMs;

        if (lastCandle.timestamp < expectedLatestTs - staleTolerance) {
          console.warn(
            `[PaperEngine ${this.sessionId}] Stale data for ${subConfig.symbol} ${subConfig.timeframe}: ` +
            `latest candle ${new Date(lastCandle.timestamp).toISOString()}, ` +
            `expected ~${new Date(expectedLatestTs).toISOString()}`,
          );
          continue;
        }

        // Get funding rates for this symbol (already fetched above)
        const fundingRates = frCache.get(subConfig.symbol) ?? [];

        // Check adapter cache — keyed by strategyName:symbol:timeframe.
        // On cache hit: reuse the existing adapter and update its candle data
        //   via appendCandles() so strategy internal state is preserved and
        //   strategy.init() is NOT called again.
        // On cache miss: load the strategy, create a fresh adapter, call init().
        const adapterCacheKey = `${subConfig.strategyName}:${subConfig.symbol}:${subConfig.timeframe}`;
        const cachedEntry = this.adapterCache.get(adapterCacheKey);

        let strategy: Strategy;
        let adapter: SignalAdapter;

        if (cachedEntry) {
          // Reuse cached adapter — update candles without re-initialising
          strategy = cachedEntry.strategy;
          adapter = cachedEntry.adapter;
          adapter.appendCandles(subCandles, fundingRates);
        } else {
          // First encounter — create fresh adapter and call init()
          strategy = await loadStrategy(subConfig.strategyName);
          adapter = new SignalAdapter(
            strategy,
            subConfig.symbol,
            subConfig.timeframe,
            subConfig.params,
          );
          adapter.init(subCandles, fundingRates);
          // Store in cache for subsequent ticks
          this.adapterCache.set(adapterCacheKey, { adapter, strategy });
        }

        // Restore shadow state from open DB positions so the strategy's internal
        // logic (stop-loss, take-profit, hold period) sees the right position.
        // Filter by subStrategyKey (not just symbol) so that two sub-strategies
        // trading the same symbol (e.g. different timeframes) each only restore
        // the positions they originally created.
        const dbPositions = await paperDb.getPaperPositions(this.sessionId);
        const subKey = `${subConfig.strategyName}:${subConfig.symbol}:${subConfig.timeframe}`;
        const matchingPositions = dbPositions.filter(p => p.subStrategyKey === subKey);
        for (const pos of matchingPositions) {
          adapter.confirmExecutionWithPrice(
            pos.direction as 'long' | 'short',
            pos.entryPrice,
            pos.entryTime,
          );
        }

        // Determine which bars are new since the last tick.
        // - If we have a stored last-processed timestamp for this key, scan for the
        //   first bar strictly after it.
        // - If this is the first tick (no stored timestamp), only process the very
        //   last bar to avoid replaying all 200 warmup bars as signals.
        const lastTs = this.lastProcessedCandleTs.get(cacheKey);
        let newBarsStartIndex: number;

        if (lastTs === undefined) {
          // First tick for this adapter: only process the last (most recent closed) bar.
          newBarsStartIndex = subCandles.length - 1;
        } else {
          // Find the first bar strictly after lastTs
          newBarsStartIndex = subCandles.length; // default: no new bars
          for (let i = 0; i < subCandles.length; i++) {
            if (subCandles[i].timestamp > lastTs) {
              newBarsStartIndex = i;
              break;
            }
          }
        }

        // Load persisted fundingAccumulated from DB position so that when we close
        // a position the full cross-tick funding income is recorded in the trade
        // (not just funding from the current tick alone).
        const persistedFunding = matchingPositions.reduce(
          (sum, pos) => sum + (pos.fundingAccumulated ?? 0),
          0,
        );

        this.adapters.push({
          adapter,
          strategy,
          config: subConfig,
          candles: subCandles,
          accumulatedFunding: persistedFunding,
          newBarsStartIndex,
        });
      }

      if (this.adapters.length === 0) {
        throw new Error('No valid sub-strategies loaded (all had empty or stale candle data)');
      }

      // ------------------------------------------------------------------
      // Steps 3-8: Process each new bar across all adapters.
      // This mimics the backtest loop bar-by-bar so that crossover signals
      // between ticks are never missed.
      // ------------------------------------------------------------------

      const minNewStart = Math.min(...this.adapters.map(a => a.newBarsStartIndex));
      const maxBarIndex = Math.max(...this.adapters.map(a => a.candles.length - 1));

      // M3: Track latest candle timestamp across all bars and adapters.
      // Used for the equity snapshot timestamp so it aligns with candle time,
      // not wall-clock time. Falls back to wallClockTimestamp if no bars run.
      let latestCandleTimestamp: number = wallClockTimestamp;
      let latestCandleTimestampSet = false;

      for (let barIdx = minNewStart; barIdx <= maxBarIndex; barIdx++) {
        // ----------------------------------------------------------------
        // Step 3: Update portfolio prices with the close of this bar.
        // ----------------------------------------------------------------
        for (const awd of this.adapters) {
          if (barIdx < awd.candles.length) {
            const bar = awd.candles[barIdx];
            this.portfolio.updatePrice(awd.config.symbol, bar.close);
            // M3: Track latest candle timestamp
            if (!latestCandleTimestampSet || bar.timestamp > latestCandleTimestamp) {
              latestCandleTimestamp = bar.timestamp;
              latestCandleTimestampSet = true;
            }
          }
        }

        // ----------------------------------------------------------------
        // Step 4: Process funding payments (futures mode only).
        // Only apply FR timestamps that fall within the range of this bar
        // (between the previous bar's open and this bar's close timestamp).
        // ----------------------------------------------------------------
        if (this.config.mode === 'futures') {
          for (const awd of this.adapters) {
            if (barIdx >= awd.candles.length) continue;

            const symbol = awd.config.symbol;
            const fundingRates = frCache.get(symbol) ?? [];
            const currentBar = awd.candles[barIdx];
            const prevBarTs = barIdx > 0 ? awd.candles[barIdx - 1].timestamp : 0;
            const lastProcessedFRTs = this.lastProcessedFRTimestamps.get(symbol) ??
              (this.lastTickAt ?? 0);

            for (const fr of fundingRates) {
              // Only apply FR events within this bar's time window and not yet processed
              if (fr.timestamp <= lastProcessedFRTs) continue;
              if (fr.timestamp <= prevBarTs) continue;
              if (fr.timestamp > currentBar.timestamp) continue;

              const positions = this.portfolio.getPositionForSymbol(symbol);
              if (!positions.longPosition && !positions.shortPosition) continue;

              const markPrice = fr.markPrice ?? currentBar.close;
              if (markPrice === 0) continue;

              if (positions.longPosition) {
                const payment = -positions.longPosition.amount * markPrice * fr.fundingRate;
                this.portfolio.applyFundingPayment(payment);
                awd.accumulatedFunding += payment;
                fundingPayments.push({ symbol, amount: payment });

                this.emitEvent({
                  type: 'funding_payment',
                  sessionId: this.sessionId,
                  symbol,
                  amount: payment,
                  equity: this.portfolio.equity,
                });
              }

              if (positions.shortPosition) {
                const payment = positions.shortPosition.amount * markPrice * fr.fundingRate;
                this.portfolio.applyFundingPayment(payment);
                awd.accumulatedFunding += payment;
                fundingPayments.push({ symbol, amount: payment });

                this.emitEvent({
                  type: 'funding_payment',
                  sessionId: this.sessionId,
                  symbol,
                  amount: payment,
                  equity: this.portfolio.equity,
                });
              }
            }

            // Advance the FR pointer up to this bar's timestamp
            if (fundingRates.length > 0) {
              const lastFrInBar = [...fundingRates]
                .filter(fr => fr.timestamp <= currentBar.timestamp)
                .pop();
              if (lastFrInBar && lastFrInBar.timestamp > (this.lastProcessedFRTimestamps.get(symbol) ?? 0)) {
                this.lastProcessedFRTimestamps.set(symbol, lastFrInBar.timestamp);
              }
            }
          }
        }

        // ----------------------------------------------------------------
        // Step 5: Check exits for this bar.
        // Only process adapters that have reached this bar index and where
        // this bar is within the "new bars" window.
        // ----------------------------------------------------------------
        for (const awd of this.adapters) {
          if (barIdx >= awd.candles.length) continue;
          if (barIdx < awd.newBarsStartIndex) continue; // warmup bar for this adapter

          if (!awd.adapter.isInPosition()) continue;

          const positions = this.portfolio.getPositionForSymbol(awd.config.symbol);
          const hasRealPosition =
            positions.longPosition !== null || positions.shortPosition !== null;
          if (!hasRealPosition) continue;

          if (awd.adapter.wantsExit(barIdx)) {
            const closeCandle = awd.candles[barIdx];
            const closeTimestamp = closeCandle.timestamp;

            if (positions.longPosition) {
              // Long exit is a sell — slippage reduces the fill price
              const closePrice = this.applySlippage(closeCandle.close, 'sell');
              const trade = this.portfolio.closeLong(
                awd.config.symbol,
                'all',
                closePrice,
                closeTimestamp,
                this.getFeeRate(),
              );
              const paperTrade = await this.saveTrade(awd, trade, 'close_long', awd.accumulatedFunding);
              tradesClosed.push(paperTrade);
              awd.accumulatedFunding = 0;
              await paperDb.deletePaperPosition(
                this.sessionId,
                `${awd.config.strategyName}:${awd.config.symbol}:${awd.config.timeframe}`,
                'long',
              );
              // Notify RiskManager of closed position
              if (this.riskManager) {
                this.riskManager.onTradeClosed({
                  symbol: awd.config.symbol,
                  pnl: paperTrade.pnl ?? 0,
                });
              }
            }

            if (positions.shortPosition) {
              // Short exit is a buy — slippage increases the fill price
              const closePrice = this.applySlippage(closeCandle.close, 'buy');
              const trade = this.portfolio.closeShort(
                awd.config.symbol,
                'all',
                closePrice,
                closeTimestamp,
                this.getFeeRate(),
              );
              const paperTrade = await this.saveTrade(awd, trade, 'close_short', awd.accumulatedFunding);
              tradesClosed.push(paperTrade);
              awd.accumulatedFunding = 0;
              await paperDb.deletePaperPosition(
                this.sessionId,
                `${awd.config.strategyName}:${awd.config.symbol}:${awd.config.timeframe}`,
                'short',
              );
              // Notify RiskManager of closed position
              if (this.riskManager) {
                this.riskManager.onTradeClosed({
                  symbol: awd.config.symbol,
                  pnl: paperTrade.pnl ?? 0,
                });
              }
            }

            awd.adapter.confirmExit();
          }
        }

        // ----------------------------------------------------------------
        // Step 6: Collect entry signals for this bar.
        // ----------------------------------------------------------------
        const barSignals: Array<{ signal: Signal; awd: AdapterWithConfig; barIndex: number }> = [];

        for (const awd of this.adapters) {
          if (barIdx >= awd.candles.length) continue;
          if (barIdx < awd.newBarsStartIndex) continue;

          if (awd.adapter.isInPosition()) continue;

          const signal = awd.adapter.getSignal(barIdx);
          if (signal && signal.direction !== 'flat') {
            barSignals.push({ signal, awd, barIndex: barIdx });
          }
        }

        // ----------------------------------------------------------------
        // Step 7: Select signals based on allocation mode.
        // ----------------------------------------------------------------
        const currentPositionCount = this.portfolio.getPositionCount();
        let selectedSignals: Array<{ signal: Signal; awd: AdapterWithConfig; barIndex: number }> = [];

        if (barSignals.length > 0) {
          barSignals.sort((a, b) => b.signal.weight - a.signal.weight);

          switch (this.config.allocationMode) {
            case 'single_strongest': {
              if (currentPositionCount === 0) {
                selectedSignals = [barSignals[0]];
              }
              break;
            }
            case 'top_n': {
              const availableSlots = Math.max(0, this.config.maxPositions - currentPositionCount);
              selectedSignals = barSignals.slice(0, availableSlots);
              break;
            }
            case 'weighted_multi': {
              const availableSlots = Math.max(0, this.config.maxPositions - currentPositionCount);
              selectedSignals = barSignals.slice(0, availableSlots);
              break;
            }
          }
        }

        // ----------------------------------------------------------------
        // Step 8: Execute selected signals.
        // Snapshot cash before the loop so all allocations share the same base.
        // ----------------------------------------------------------------
        const cashSnapshot = this.portfolio.cash;
        const totalWeightSnapshot = selectedSignals.reduce(
          (sum, s) => sum + s.signal.weight,
          0,
        );

        for (const { signal, awd, barIndex } of selectedSignals) {
          const entryCandle = awd.candles[barIndex];
          // Long entry is a buy (slippage increases price), short entry is a sell (slippage decreases price)
          const entryPrice = signal.direction === 'long'
            ? this.applySlippage(entryCandle.close, 'buy')
            : this.applySlippage(entryCandle.close, 'sell');
          const entryTimestamp = entryCandle.timestamp;

          let capitalForTrade: number;
          if (this.config.allocationMode === 'weighted_multi' && selectedSignals.length > 1) {
            capitalForTrade =
              totalWeightSnapshot > 0
                ? (signal.weight / totalWeightSnapshot) * cashSnapshot * 0.9
                : (cashSnapshot * 0.9) / selectedSignals.length;
          } else if (this.config.allocationMode === 'top_n') {
            // Each position gets an equal fixed share of initial capital, regardless of when it opens.
            // Using initialCapital / maxPositions ensures symmetry even when positions open on different bars.
            const positionSizeFraction = 0.9;
            capitalForTrade = (this.config.initialCapital * positionSizeFraction) / this.config.maxPositions;
          } else {
            capitalForTrade = cashSnapshot * 0.9;
          }

          const amount = capitalForTrade / entryPrice;
          if (amount <= 0) continue;

          // RiskManager pre-trade validation
          if (this.riskManager) {
            const validation = this.riskManager.validateTrade({
              symbol: awd.config.symbol,
              size: capitalForTrade,
              direction: signal.direction as 'long' | 'short',
            });
            if (!validation.allowed) {
              console.warn(
                `[PaperEngine ${this.sessionId}] Trade rejected for ${awd.config.symbol}: ${validation.reason}`,
              );
              this.emitEvent({
                type: 'trade_rejected',
                sessionId: this.sessionId,
                symbol: awd.config.symbol,
                reason: validation.reason ?? 'RiskManager rejected trade',
              });
              continue;
            }
          }

          try {
            let trade: Trade;
            if (signal.direction === 'long') {
              trade = this.portfolio.openLong(
                awd.config.symbol,
                amount,
                entryPrice,
                entryTimestamp,
                this.getFeeRate(),
              );
            } else {
              trade = this.portfolio.openShort(
                awd.config.symbol,
                amount,
                entryPrice,
                entryTimestamp,
                this.getFeeRate(),
              );
            }

            const action = signal.direction === 'long' ? 'open_long' : 'open_short';
            const paperTrade = await this.saveTrade(awd, trade, action, 0);
            tradesOpened.push(paperTrade);

            // Notify RiskManager that a new position was opened
            if (this.riskManager) {
              this.riskManager.onTradeOpened({
                symbol: awd.config.symbol,
                size: capitalForTrade,
              });
            }

            // Confirm in adapter so shadow state stays in sync
            awd.adapter.confirmExecutionAtBar(signal.direction, barIndex);
            awd.accumulatedFunding = 0;

            // Persist position to DB.
            // signal.direction is guaranteed to be 'long' | 'short' here because
            // 'flat' signals were filtered out before selectedSignals was built.
            // Include subStrategyKey so that on the next tick each adapter only
            // restores the positions it originally created (not same-symbol others).
            const { stopLoss, takeProfit } = this.computeSlTp(
              awd,
              barIndex,
              entryPrice,
              signal.direction as 'long' | 'short',
            );
            await paperDb.savePaperPosition({
              sessionId: this.sessionId,
              symbol: awd.config.symbol,
              direction: signal.direction as 'long' | 'short',
              subStrategyKey: `${awd.config.strategyName}:${awd.config.symbol}:${awd.config.timeframe}`,
              entryPrice,
              amount,
              entryTime: entryTimestamp,
              unrealizedPnl: 0,
              fundingAccumulated: 0,
              stopLoss,
              takeProfit,
            });
          } catch (err) {
            console.warn(
              `[PaperEngine ${this.sessionId}] Could not execute ${signal.direction} ` +
              `for ${signal.symbol}: ${err instanceof Error ? err.message : 'unknown'}`,
            );
          }
        }
      } // end bar loop

      // ------------------------------------------------------------------
      // After bar loop: advance lastProcessedCandleTs for all adapters.
      // ------------------------------------------------------------------
      for (const awd of this.adapters) {
        const lastCandle = awd.candles[awd.candles.length - 1];
        const cacheKey = `${awd.config.symbol}:${awd.config.timeframe}`;
        this.lastProcessedCandleTs.set(cacheKey, lastCandle.timestamp);
      }

      // FR timestamps are advanced inside the bar loop (Step 4, lines 767-775)
      // only up to the last bar's timestamp. Do NOT advance beyond the last
      // processed bar here — that would skip FR events whose bar hasn't closed
      // yet, causing them to never be applied.

      // ------------------------------------------------------------------
      // Step 9: Save equity snapshot and update session.
      // M3 fix: Use latestCandleTimestamp (candle time) for the snapshot so
      // the equity history aligns with chart candles, not wall-clock time.
      // lastTickAt still uses wallClockTimestamp to reflect actual tick time.
      // ------------------------------------------------------------------

      this.tickCount++;
      this.lastTickAt = wallClockTimestamp;

      const equity = this.portfolio.equity;
      const cash = this.portfolio.cash;
      const positionsValue = equity - cash;

      await paperDb.savePaperEquitySnapshot({
        sessionId: this.sessionId,
        timestamp: latestCandleTimestamp, // candle time, not wall clock (M3)
        equity,
        cash,
        positionsValue,
      });

      await paperDb.updatePaperSession(this.sessionId, {
        currentEquity: equity,
        currentCash: cash,
        tickCount: this.tickCount,
        lastTickAt: this.lastTickAt,
      });

      // ------------------------------------------------------------------
      // Kill switch check: update RiskManager with latest equity, then check
      // whether the drawdown threshold has been breached.
      // When triggered: force-close all positions, emit event, pause engine.
      // ------------------------------------------------------------------
      if (this.riskManager) {
        this.riskManager.onEquityUpdate(equity);
        const ksCheck = this.riskManager.checkKillSwitch();
        if (ksCheck.triggered) {
          console.warn(
            `[PaperEngine ${this.sessionId}] Kill switch triggered: ${ksCheck.reason}`,
          );
          // Force-close all open positions before pausing
          await this.forceCloseAllPositions();
          this.emitEvent({
            type: 'kill_switch_triggered',
            sessionId: this.sessionId,
            reason: ksCheck.reason ?? 'Kill switch triggered',
            equity,
          });
          // Pause so the session stops ticking but remains recoverable
          await this.pause();
          // Return early — no further processing after kill switch
          return {
            tickNumber: this.tickCount,
            timestamp: wallClockTimestamp,
            tradesOpened,
            tradesClosed,
            fundingPayments,
            equity,
            cash,
            positionsValue,
            openPositions: [],
          };
        }
      }

      // ------------------------------------------------------------------
      // Step 10: Update unrealized PnL and fundingAccumulated for all open
      // positions in DB.
      // M4 fix: Also persist accumulatedFunding from the matching adapter.
      // ------------------------------------------------------------------

      // Build lookup map from subStrategyKey -> awd for O(1) access (M4)
      const awdBySubKey = new Map<string, AdapterWithConfig>();
      for (const awd of this.adapters) {
        const subKey = `${awd.config.strategyName}:${awd.config.symbol}:${awd.config.timeframe}`;
        awdBySubKey.set(subKey, awd);
      }

      const openPositions = await paperDb.getPaperPositions(this.sessionId);
      for (const pos of openPositions) {
        const posForSymbol = this.portfolio.getPositionForSymbol(pos.symbol);
        const actualPos =
          pos.direction === 'long' ? posForSymbol.longPosition : posForSymbol.shortPosition;
        if (actualPos) {
          // M4: Update fundingAccumulated from the matching adapter's running total
          const matchingAwd = awdBySubKey.get(pos.subStrategyKey);
          const fundingAccumulated = matchingAwd !== undefined
            ? matchingAwd.accumulatedFunding
            : pos.fundingAccumulated;

          await paperDb.savePaperPosition({
            ...pos,
            unrealizedPnl: actualPos.unrealizedPnl,
            fundingAccumulated,
          });
        }
      }

      // ------------------------------------------------------------------
      // Step 11: Emit events.
      // ------------------------------------------------------------------

      this.emitEvent({
        type: 'equity_update',
        sessionId: this.sessionId,
        equity,
        cash,
        positionsValue,
        timestamp: wallClockTimestamp,
      });

      const nextDelay = this.calculateNextTickDelay();
      this.emitEvent({
        type: 'tick_complete',
        sessionId: this.sessionId,
        tickNumber: this.tickCount,
        timestamp: wallClockTimestamp,
        nextTickAt: this._status === 'running' ? Date.now() + nextDelay : null,
      });

      // ------------------------------------------------------------------
      // Build and return tick result.
      // ------------------------------------------------------------------

      const result: TickResult = {
        tickNumber: this.tickCount,
        timestamp: wallClockTimestamp,
        tradesOpened,
        tradesClosed,
        fundingPayments,
        equity,
        cash,
        positionsValue,
        openPositions: await paperDb.getPaperPositions(this.sessionId),
      };

      return result;
    } finally {
      this.isTicking = false;
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getFeeRate(): number {
    return this.config.feeRate ?? 0.00055;
  }

  /**
   * Apply slippage to a price.
   * Buys (long entry, short exit) get a higher fill price.
   * Sells (long exit, short entry) get a lower fill price.
   */
  private applySlippage(price: number, side: 'buy' | 'sell'): number {
    const slippage = this.config.slippagePercent ?? 0;
    if (slippage === 0) return price;
    if (side === 'buy') {
      return price * (1 + slippage / 100);
    } else {
      return price * (1 - slippage / 100);
    }
  }

  private async saveTrade(
    awd: AdapterWithConfig,
    portfolioTrade: Trade,
    action: PaperTrade['action'],
    fundingIncome: number,
  ): Promise<PaperTrade> {
    const paperTrade = await paperDb.savePaperTrade({
      sessionId: this.sessionId,
      symbol: awd.config.symbol,
      action,
      price: portfolioTrade.price,
      amount: portfolioTrade.amount,
      timestamp: portfolioTrade.timestamp,
      pnl: portfolioTrade.pnl ?? null,
      pnlPercent: portfolioTrade.pnlPercent ?? null,
      fee: portfolioTrade.fee ?? 0,
      fundingIncome,
      balanceAfter: portfolioTrade.balanceAfter,
    });

    const eventType = action.startsWith('open') ? 'trade_opened' : 'trade_closed';
    this.emitEvent({ type: eventType, sessionId: this.sessionId, trade: paperTrade });

    return paperTrade;
  }

  private emitEvent(event: PaperTradingEvent): void {
    this.emit('paper-event', event);
  }

  /**
   * Compute stop-loss and take-profit price levels for a newly opened position.
   *
   * Supports two conventions detected from strategy params:
   *  1. ATR-based: params.useATRStops === true (or not set) + params.atrPeriod,
   *     params.atrStopMultiplier, params.atrTPMultiplier
   *  2. Percentage-based: params.stopLossPct / params.takeProfitPct
   *
   * If neither convention is detectable, returns null for both values.
   */
  private computeSlTp(
    awd: AdapterWithConfig,
    barIndex: number,
    entryPrice: number,
    direction: 'long' | 'short',
  ): { stopLoss: number | null; takeProfit: number | null } {
    const params = awd.config.params ?? {};

    try {
      // --- ATR-based SL/TP ---
      const useATRStops = params.useATRStops !== false; // default true if not set
      if (useATRStops && params.atrStopMultiplier !== undefined && params.atrTPMultiplier !== undefined) {
        const atrPeriod = typeof params.atrPeriod === 'number' ? params.atrPeriod : 14;
        const stopMult = Number(params.atrStopMultiplier);
        const tpMult = Number(params.atrTPMultiplier);

        // Calculate ATR from candles up to and including barIndex
        const candles = awd.candles.slice(0, barIndex + 1);
        if (candles.length > atrPeriod) {
          const highs = candles.map(c => c.high);
          const lows = candles.map(c => c.low);
          const closes = candles.map(c => c.close);

          // Wilder's ATR (simple approximation: average of true ranges)
          const trueRanges: number[] = [];
          for (let i = 1; i < candles.length; i++) {
            const tr = Math.max(
              highs[i] - lows[i],
              Math.abs(highs[i] - closes[i - 1]),
              Math.abs(lows[i] - closes[i - 1]),
            );
            trueRanges.push(tr);
          }
          // Use last `atrPeriod` true ranges
          const recentTRs = trueRanges.slice(-atrPeriod);
          const atr = recentTRs.reduce((s, v) => s + v, 0) / recentTRs.length;

          if (atr > 0) {
            if (direction === 'long') {
              return {
                stopLoss: entryPrice - atr * stopMult,
                takeProfit: entryPrice + atr * tpMult,
              };
            } else {
              return {
                stopLoss: entryPrice + atr * stopMult,
                takeProfit: entryPrice - atr * tpMult,
              };
            }
          }
        }
      }

      // --- Percentage-based SL/TP ---
      if (params.stopLossPct !== undefined || params.takeProfitPct !== undefined) {
        const slPct = typeof params.stopLossPct === 'number' ? params.stopLossPct : null;
        const tpPct = typeof params.takeProfitPct === 'number' ? params.takeProfitPct : null;

        if (direction === 'long') {
          return {
            stopLoss: slPct !== null ? entryPrice * (1 - slPct / 100) : null,
            takeProfit: tpPct !== null ? entryPrice * (1 + tpPct / 100) : null,
          };
        } else {
          return {
            stopLoss: slPct !== null ? entryPrice * (1 + slPct / 100) : null,
            takeProfit: tpPct !== null ? entryPrice * (1 - tpPct / 100) : null,
          };
        }
      }
    } catch {
      // Best-effort: if anything goes wrong, return null rather than crashing
    }

    return { stopLoss: null, takeProfit: null };
  }

  /**
   * Force-close all open positions at current market prices.
   * Called when the engine is stopped.
   *
   * If adapters are empty (engine just initialized, no tick run yet),
   * we fall back to iterating DB positions directly.
   */
  private async forceCloseAllPositions(): Promise<void> {
    const dbPositions = await paperDb.getPaperPositions(this.sessionId);
    if (dbPositions.length === 0) return;

    // Build a minimal adapter map keyed by symbol for symbols that have adapters
    const adapterBySymbol = new Map<string, AdapterWithConfig>();
    for (const awd of this.adapters) {
      adapterBySymbol.set(awd.config.symbol, awd);
    }

    for (const pos of dbPositions) {
      try {
        // Fetch current price directly from live data
        const candles = await this.fetcher.fetchLatestCandles(
          pos.symbol,
          // Use the timeframe from the matching adapter, or default to 4h
          this.config.subStrategies.find(s => s.symbol === pos.symbol)?.timeframe ?? '4h',
          1,
        );
        if (candles.length === 0) continue;

        const closePrice = candles[candles.length - 1].close;
        const closeTimestamp = Date.now();

        // Make sure the portfolio has a price for this symbol
        this.portfolio.updatePrice(pos.symbol, closePrice);

        // Create a minimal fake AdapterWithConfig for saveTrade.
        // If a real adapter exists for this symbol, prefer it to preserve
        // its accumulated funding amount for the close trade record.
        const existingAwd = adapterBySymbol.get(pos.symbol);
        const fakeStrategy: Strategy = {
          name: pos.subStrategyKey,
          description: '',
          version: '1.0.0',
          params: [],
          onBar: () => { /* noop */ },
        };
        const fakeAwd: AdapterWithConfig = existingAwd ?? {
          adapter: undefined as unknown as SignalAdapter, // Not used in saveTrade
          strategy: fakeStrategy,
          config: this.config.subStrategies.find(s => s.symbol === pos.symbol) ??
            this.config.subStrategies[0],
          candles,
          accumulatedFunding: 0,
          newBarsStartIndex: 0,
        };

        if (pos.direction === 'long') {
          const positions = this.portfolio.getPositionForSymbol(pos.symbol);
          if (!positions.longPosition) continue;

          // Long force-close is a sell — slippage reduces the fill price
          const exitPrice = this.applySlippage(closePrice, 'sell');
          const trade = this.portfolio.closeLong(
            pos.symbol,
            'all',
            exitPrice,
            closeTimestamp,
            this.getFeeRate(),
          );
          await this.saveTrade(fakeAwd, trade, 'close_long', fakeAwd.accumulatedFunding);
          await paperDb.deletePaperPosition(this.sessionId, pos.subStrategyKey, 'long');
        } else {
          const positions = this.portfolio.getPositionForSymbol(pos.symbol);
          if (!positions.shortPosition) continue;

          // Short force-close is a buy — slippage increases the fill price
          const exitPrice = this.applySlippage(closePrice, 'buy');
          const trade = this.portfolio.closeShort(
            pos.symbol,
            'all',
            exitPrice,
            closeTimestamp,
            this.getFeeRate(),
          );
          await this.saveTrade(fakeAwd, trade, 'close_short', fakeAwd.accumulatedFunding);
          await paperDb.deletePaperPosition(this.sessionId, pos.subStrategyKey, 'short');
        }
      } catch (err) {
        console.error(
          `[PaperEngine ${this.sessionId}] Error force-closing ${pos.symbol} ${pos.direction}:`,
          err,
        );
      }
    }
  }
}
