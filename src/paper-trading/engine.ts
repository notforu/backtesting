/**
 * Paper Trading Engine
 *
 * Mirrors runAggregateBacktest() from aggregate-engine.ts but operates on
 * one real-time tick at a time, driven by closed candle intervals.
 *
 * Design decisions:
 * - Adapter re-init per tick: matches backtest pattern, acceptable at 4h+ intervals
 * - Shadow state restore: adapters are re-created each tick; DB positions are used
 *   to confirm execution so strategies see the right position state
 * - 1-bar execution delay: uses the last CLOSED candle, not the forming bar
 * - Stale data guard: skips tick if latest candle is too old
 * - Per-tick candle cache: candles and funding rates fetched once per symbol per tick
 */

import { EventEmitter } from 'events';
import type { Candle, FundingRate, Timeframe } from '../core/types.js';
import { timeframeToMs } from '../core/types.js';
import type { AggregateBacktestConfig, SubStrategyConfig, Signal } from '../core/signal-types.js';
import { SignalAdapter } from '../core/signal-adapter.js';
import { MultiSymbolPortfolio } from '../core/multi-portfolio.js';
import { loadStrategy } from '../strategy/loader.js';
import { LiveDataFetcher } from './live-data.js';
import type { PaperSession, PaperTrade, PaperTradingEvent, TickResult } from './types.js';
import * as paperDb from './db.js';
import type { Trade } from '../core/types.js';

const FEE_RATE = 0.00055; // Bybit taker fee
const WARMUP_CANDLES = 200; // Historical candles for strategy warmup

// ============================================================================
// Internal types
// ============================================================================

interface AdapterWithConfig {
  adapter: SignalAdapter;
  config: SubStrategyConfig;
  candles: Candle[];
  accumulatedFunding: number;
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

  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: 'running' | 'paused' | 'stopped' | 'error' = 'stopped';
  private tickCount: number = 0;
  private lastTickAt: number | null = null;

  // Track last processed funding rate timestamp per symbol to avoid double-payments
  private lastProcessedFRTimestamps: Map<string, number> = new Map();

  // Guard against concurrent tick execution
  private isTicking: boolean = false;

  constructor(session: PaperSession) {
    super();
    this.sessionId = session.id;
    this.config = session.aggregationConfig;
    this.portfolio = new MultiSymbolPortfolio(session.initialCapital);
    this.fetcher = new LiveDataFetcher();
    this.tickCount = session.tickCount;
    this.lastTickAt = session.lastTickAt;
  }

  get status(): string {
    return this._status;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this._status === 'running') return;

    const oldStatus = this._status;
    this._status = 'running';

    // Restore portfolio state from DB before first tick
    await this.restoreState();

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'running' });
    await paperDb.updatePaperSession(this.sessionId, { status: 'running' });

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
    if (this._status !== 'paused') return;

    const oldStatus = this._status;
    this._status = 'running';

    this.emitEvent({ type: 'status_change', sessionId: this.sessionId, oldStatus, newStatus: 'running' });
    await paperDb.updatePaperSession(this.sessionId, { status: 'running' });

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
    }, delayMs);
  }

  /**
   * Calculate milliseconds until the next candle close, using the shortest
   * timeframe among sub-strategies. Adds a 30-second buffer after candle close
   * to ensure the bar has fully settled.
   */
  private calculateNextTickDelay(): number {
    let shortestTfMs = Infinity;
    for (const sub of this.config.subStrategies) {
      const tfMs = timeframeToMs(sub.timeframe);
      if (tfMs < shortestTfMs) shortestTfMs = tfMs;
    }

    if (!isFinite(shortestTfMs)) shortestTfMs = 4 * 60 * 60 * 1000; // Default 4h

    const now = Date.now();
    const buffer = 30_000; // 30 second buffer after candle close

    // Find the next candle close: smallest multiple of shortestTfMs strictly after now
    const nextClose = Math.ceil(now / shortestTfMs) * shortestTfMs;
    const delay = nextClose - now + buffer;

    // Minimum 10 seconds to prevent tight loops
    return Math.max(delay, 10_000);
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
    const timestamp = Date.now();

    try {
      // ------------------------------------------------------------------
      // Step 1: Fetch candles and funding rates for each sub-strategy.
      // Cache by symbol to avoid redundant network calls within this tick.
      // ------------------------------------------------------------------

      const candleCache = new Map<string, Candle[]>(); // symbol -> candles
      const frCache = new Map<string, FundingRate[]>(); // symbol -> funding rates

      // Collect unique symbols
      const uniqueSymbols = [...new Set(this.config.subStrategies.map(s => s.symbol))];

      for (const symbol of uniqueSymbols) {
        // Find the shortest timeframe for this symbol (for candle alignment)
        const symbolConfigs = this.config.subStrategies.filter(s => s.symbol === symbol);
        const shortestTf = symbolConfigs.reduce<Timeframe>((shortest, s) => {
          return timeframeToMs(s.timeframe) < timeframeToMs(shortest) ? s.timeframe : shortest;
        }, symbolConfigs[0].timeframe);

        const candles = await this.fetcher.fetchLatestCandles(symbol, shortestTf, WARMUP_CANDLES);
        candleCache.set(symbol, candles);

        if (this.config.mode === 'futures') {
          const fundingRates = await this.fetcher.fetchLatestFundingRates(symbol, 100);
          frCache.set(symbol, fundingRates);
        }
      }

      // ------------------------------------------------------------------
      // Step 2: Build adapters for each sub-strategy.
      // Each sub-strategy may use its own timeframe, so we fetch timeframe-specific
      // candles. Re-uses the cache when the same symbol+timeframe is requested.
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

        // Create and initialize adapter
        const strategy = await loadStrategy(subConfig.strategyName);
        const adapter = new SignalAdapter(
          strategy,
          subConfig.symbol,
          subConfig.timeframe,
          subConfig.params,
        );
        adapter.init(subCandles, fundingRates);

        // Restore shadow state from open DB positions so the strategy's internal
        // logic (stop-loss, take-profit, hold period) sees the right position.
        const dbPositions = await paperDb.getPaperPositions(this.sessionId);
        const symbolPositions = dbPositions.filter(p => p.symbol === subConfig.symbol);
        for (const pos of symbolPositions) {
          adapter.confirmExecution(pos.direction as 'long' | 'short');
        }

        this.adapters.push({
          adapter,
          config: subConfig,
          candles: subCandles,
          accumulatedFunding: 0,
        });
      }

      if (this.adapters.length === 0) {
        throw new Error('No valid sub-strategies loaded (all had empty or stale candle data)');
      }

      // ------------------------------------------------------------------
      // Step 3: Update portfolio prices with the latest close price for
      // each symbol (mirrors aggregate-engine.ts step 4a).
      // ------------------------------------------------------------------

      for (const awd of this.adapters) {
        const lastCandle = awd.candles[awd.candles.length - 1];
        this.portfolio.updatePrice(awd.config.symbol, lastCandle.close);
      }

      // ------------------------------------------------------------------
      // Step 4: Process funding payments (futures mode only).
      // Only apply funding rate timestamps that we haven't processed yet.
      // Mirrors aggregate-engine.ts step 4b.
      // ------------------------------------------------------------------

      if (this.config.mode === 'futures') {
        for (const awd of this.adapters) {
          const symbol = awd.config.symbol;
          const fundingRates = frCache.get(symbol) ?? [];
          const lastProcessedTs = this.lastProcessedFRTimestamps.get(symbol) ??
            (this.lastTickAt ?? 0);

          for (const fr of fundingRates) {
            if (fr.timestamp <= lastProcessedTs) continue;

            const positions = this.portfolio.getPositionForSymbol(symbol);
            if (!positions.longPosition && !positions.shortPosition) continue;

            // Use the FR mark price if available; fall back to latest candle close
            const lastCandle = awd.candles[awd.candles.length - 1];
            const markPrice = fr.markPrice ?? lastCandle.close;
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

          // Advance the last-processed pointer for this symbol
          if (fundingRates.length > 0) {
            this.lastProcessedFRTimestamps.set(
              symbol,
              fundingRates[fundingRates.length - 1].timestamp,
            );
          }
        }
      }

      // ------------------------------------------------------------------
      // Step 5: Check exits (mirrors aggregate-engine.ts step 4c).
      // ------------------------------------------------------------------

      for (const awd of this.adapters) {
        const lastBarIndex = awd.candles.length - 1;

        if (!awd.adapter.isInPosition()) continue;

        const positions = this.portfolio.getPositionForSymbol(awd.config.symbol);
        const hasRealPosition =
          positions.longPosition !== null || positions.shortPosition !== null;
        if (!hasRealPosition) continue;

        if (awd.adapter.wantsExit(lastBarIndex)) {
          const closeCandle = awd.candles[lastBarIndex];
          const closePrice = closeCandle.close;
          const closeTimestamp = closeCandle.timestamp;

          if (positions.longPosition) {
            const trade = this.portfolio.closeLong(
              awd.config.symbol,
              'all',
              closePrice,
              closeTimestamp,
              FEE_RATE,
            );
            const paperTrade = await this.saveTrade(awd, trade, 'close_long', awd.accumulatedFunding);
            tradesClosed.push(paperTrade);
            awd.accumulatedFunding = 0;
            await paperDb.deletePaperPosition(this.sessionId, awd.config.symbol, 'long');
          }

          if (positions.shortPosition) {
            const trade = this.portfolio.closeShort(
              awd.config.symbol,
              'all',
              closePrice,
              closeTimestamp,
              FEE_RATE,
            );
            const paperTrade = await this.saveTrade(awd, trade, 'close_short', awd.accumulatedFunding);
            tradesClosed.push(paperTrade);
            awd.accumulatedFunding = 0;
            await paperDb.deletePaperPosition(this.sessionId, awd.config.symbol, 'short');
          }

          awd.adapter.confirmExit();
        }
      }

      // ------------------------------------------------------------------
      // Step 6: Collect entry signals (mirrors aggregate-engine.ts step 4d).
      // ------------------------------------------------------------------

      const signals: Array<{ signal: Signal; awd: AdapterWithConfig; barIndex: number }> = [];

      for (const awd of this.adapters) {
        const lastBarIndex = awd.candles.length - 1;

        if (awd.adapter.isInPosition()) continue;

        const signal = awd.adapter.getSignal(lastBarIndex);
        if (signal && signal.direction !== 'flat') {
          signals.push({ signal, awd, barIndex: lastBarIndex });
        }
      }

      // ------------------------------------------------------------------
      // Step 7: Select signals based on allocation mode
      // (mirrors aggregate-engine.ts step 4e).
      // ------------------------------------------------------------------

      const currentPositionCount = this.portfolio.getPositionCount();
      let selectedSignals: Array<{ signal: Signal; awd: AdapterWithConfig; barIndex: number }> = [];

      if (signals.length > 0) {
        signals.sort((a, b) => b.signal.weight - a.signal.weight);

        switch (this.config.allocationMode) {
          case 'single_strongest': {
            if (currentPositionCount === 0) {
              selectedSignals = [signals[0]];
            }
            break;
          }
          case 'top_n': {
            const availableSlots = Math.max(0, this.config.maxPositions - currentPositionCount);
            selectedSignals = signals.slice(0, availableSlots);
            break;
          }
          case 'weighted_multi': {
            const availableSlots = Math.max(0, this.config.maxPositions - currentPositionCount);
            selectedSignals = signals.slice(0, availableSlots);
            break;
          }
        }
      }

      // ------------------------------------------------------------------
      // Step 8: Execute selected signals (mirrors aggregate-engine.ts step 4f).
      // Snapshot cash before the loop so all allocations share the same base.
      // ------------------------------------------------------------------

      const cashSnapshot = this.portfolio.cash;
      const totalWeightSnapshot = selectedSignals.reduce(
        (sum, s) => sum + s.signal.weight,
        0,
      );

      for (const { signal, awd, barIndex } of selectedSignals) {
        const entryCandle = awd.candles[barIndex];
        const entryPrice = entryCandle.close;
        const entryTimestamp = entryCandle.timestamp;

        let capitalForTrade: number;
        if (this.config.allocationMode === 'weighted_multi' && selectedSignals.length > 1) {
          capitalForTrade =
            totalWeightSnapshot > 0
              ? (signal.weight / totalWeightSnapshot) * cashSnapshot * 0.9
              : (cashSnapshot * 0.9) / selectedSignals.length;
        } else if (this.config.allocationMode === 'top_n' && selectedSignals.length > 1) {
          capitalForTrade = (cashSnapshot * 0.9) / selectedSignals.length;
        } else {
          capitalForTrade = cashSnapshot * 0.9;
        }

        const amount = capitalForTrade / entryPrice;
        if (amount <= 0) continue;

        try {
          let trade: Trade;
          if (signal.direction === 'long') {
            trade = this.portfolio.openLong(
              awd.config.symbol,
              amount,
              entryPrice,
              entryTimestamp,
              FEE_RATE,
            );
          } else {
            trade = this.portfolio.openShort(
              awd.config.symbol,
              amount,
              entryPrice,
              entryTimestamp,
              FEE_RATE,
            );
          }

          const action = signal.direction === 'long' ? 'open_long' : 'open_short';
          const paperTrade = await this.saveTrade(awd, trade, action, 0);
          tradesOpened.push(paperTrade);

          // Confirm in adapter so shadow state stays in sync
          awd.adapter.confirmExecutionAtBar(signal.direction, barIndex);
          awd.accumulatedFunding = 0;

          // Persist position to DB
          // signal.direction is guaranteed to be 'long' | 'short' here because
          // 'flat' signals were filtered out before selectedSignals was built.
          await paperDb.savePaperPosition({
            sessionId: this.sessionId,
            symbol: awd.config.symbol,
            direction: signal.direction as 'long' | 'short',
            entryPrice,
            amount,
            entryTime: entryTimestamp,
            unrealizedPnl: 0,
            fundingAccumulated: 0,
          });
        } catch (err) {
          console.warn(
            `[PaperEngine ${this.sessionId}] Could not execute ${signal.direction} ` +
            `for ${signal.symbol}: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        }
      }

      // ------------------------------------------------------------------
      // Step 9: Save equity snapshot and update session.
      // ------------------------------------------------------------------

      this.tickCount++;
      this.lastTickAt = timestamp;

      const equity = this.portfolio.equity;
      const cash = this.portfolio.cash;
      const positionsValue = equity - cash;

      await paperDb.savePaperEquitySnapshot({
        sessionId: this.sessionId,
        timestamp,
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
      // Step 10: Update unrealized PnL for all open positions in DB.
      // ------------------------------------------------------------------

      const openPositions = await paperDb.getPaperPositions(this.sessionId);
      for (const pos of openPositions) {
        const posForSymbol = this.portfolio.getPositionForSymbol(pos.symbol);
        const actualPos =
          pos.direction === 'long' ? posForSymbol.longPosition : posForSymbol.shortPosition;
        if (actualPos) {
          await paperDb.savePaperPosition({
            ...pos,
            unrealizedPnl: actualPos.unrealizedPnl,
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
        timestamp,
      });

      const nextDelay = this.calculateNextTickDelay();
      this.emitEvent({
        type: 'tick_complete',
        sessionId: this.sessionId,
        tickNumber: this.tickCount,
        timestamp,
        nextTickAt: this._status === 'running' ? Date.now() + nextDelay : null,
      });

      // ------------------------------------------------------------------
      // Build and return tick result.
      // ------------------------------------------------------------------

      const result: TickResult = {
        tickNumber: this.tickCount,
        timestamp,
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

        // Create a minimal fake AdapterWithConfig for saveTrade
        const fakeAwd: AdapterWithConfig = adapterBySymbol.get(pos.symbol) ?? {
          adapter: undefined as unknown as SignalAdapter, // Not used in saveTrade
          config: this.config.subStrategies.find(s => s.symbol === pos.symbol) ??
            this.config.subStrategies[0],
          candles,
          accumulatedFunding: 0,
        };

        if (pos.direction === 'long') {
          const positions = this.portfolio.getPositionForSymbol(pos.symbol);
          if (!positions.longPosition) continue;

          const trade = this.portfolio.closeLong(
            pos.symbol,
            'all',
            closePrice,
            closeTimestamp,
            FEE_RATE,
          );
          await this.saveTrade(fakeAwd, trade, 'close_long', fakeAwd.accumulatedFunding);
          await paperDb.deletePaperPosition(this.sessionId, pos.symbol, 'long');
        } else {
          const positions = this.portfolio.getPositionForSymbol(pos.symbol);
          if (!positions.shortPosition) continue;

          const trade = this.portfolio.closeShort(
            pos.symbol,
            'all',
            closePrice,
            closeTimestamp,
            FEE_RATE,
          );
          await this.saveTrade(fakeAwd, trade, 'close_short', fakeAwd.accumulatedFunding);
          await paperDb.deletePaperPosition(this.sessionId, pos.symbol, 'short');
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
