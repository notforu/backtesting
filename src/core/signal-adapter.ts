/**
 * SignalAdapter - Wraps any Strategy into a SignalProvider
 *
 * The adapter creates a "shadow" StrategyContext that captures trade intent
 * without executing real trades on a real portfolio. Trading actions emitted
 * by the strategy (openLong, openShort, etc.) are intercepted and interpreted
 * as Signals that the aggregate engine can accept or reject.
 *
 * Shadow state management:
 * - If the engine accepts a signal, call confirmExecution() or confirmExecutionAtBar()
 *   to update the shadow position so the strategy's internal logic (stop-loss,
 *   take-profit, holding period) sees a realistic position.
 * - If the engine rejects the signal, the shadow stays unchanged and the strategy
 *   will re-evaluate on the next bar.
 * - Call confirmExit() when the engine closes the position externally.
 * - Call resetShadow() to clear shadow state unconditionally.
 */

import type { Strategy, StrategyContext, CandleView } from '../strategy/base.js';
import type { Candle, FundingRate, Position, Timeframe } from './types.js';
import type { Signal, SignalProvider, SignalDirection, WeightContext, WeightCalculator } from './signal-types.js';
import { getWeightCalculator } from './weight-calculators.js';
import { validateStrategyParams } from '../strategy/base.js';

// ============================================================================
// CandleView implementation (memory-efficient, same pattern as engine.ts)
// ============================================================================

class CandleViewImpl implements CandleView {
  constructor(private readonly candles: Candle[], private readonly endIndex: number) {}

  get length(): number {
    return this.endIndex + 1;
  }

  at(index: number): Candle | undefined {
    if (index < 0 || index > this.endIndex) return undefined;
    return this.candles[index];
  }

  slice(start?: number, end?: number): Candle[] {
    return this.candles.slice(start ?? 0, Math.min(end ?? this.length, this.length));
  }

  closes(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) result[i] = this.candles[i].close;
    return result;
  }

  volumes(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) result[i] = this.candles[i].volume;
    return result;
  }

  highs(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) result[i] = this.candles[i].high;
    return result;
  }

  lows(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) result[i] = this.candles[i].low;
    return result;
  }
}

// ============================================================================
// Internal types
// ============================================================================

interface PendingAction {
  action: 'OPEN_LONG' | 'CLOSE_LONG' | 'OPEN_SHORT' | 'CLOSE_SHORT';
  amount: number | 'all';
}

// ============================================================================
// SignalAdapter
// ============================================================================

export class SignalAdapter implements SignalProvider {
  // SignalProvider identity fields
  readonly key: string;
  readonly strategyName: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;

  private readonly strategy: Strategy;
  private readonly params: Record<string, unknown>;
  private readonly weightCalculator: WeightCalculator;

  // Candle and funding-rate data loaded during init()
  private candles: Candle[] = [];
  private fundingRates: FundingRate[] = [];
  private fundingRateMap: Map<number, FundingRate> = new Map();

  // Shadow portfolio state - tracks what the strategy *thinks* its portfolio
  // looks like so internal logic (stop-loss, take-profit, holding period) works
  // correctly even though no real orders are placed.
  private shadowLongPosition: Position | null = null;
  private shadowShortPosition: Position | null = null;
  private readonly shadowCash: number = 10_000; // Virtual cash for shadow sizing

  // Actions collected during a single onBar() call
  private pendingActions: PendingAction[] = [];

  // Track the last bar index processed by wantsExit() so that getSignal()
  // on the same bar after confirmExit() does not call onBar() a second time.
  private lastWantsExitBarIndex: number = -1;
  // Pending actions saved from the wantsExit() call for reuse in getSignal()
  private lastWantsExitActions: PendingAction[] = [];

  private initialized: boolean = false;

  constructor(
    strategy: Strategy,
    symbol: string,
    timeframe: Timeframe,
    params: Record<string, unknown> = {},
  ) {
    this.strategy = strategy;
    this.strategyName = strategy.name;
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.params = validateStrategyParams(strategy, params);
    this.key = `${strategy.name}:${symbol}:${timeframe}`;
    this.weightCalculator = getWeightCalculator(strategy.name);
  }

  // --------------------------------------------------------------------------
  // SignalProvider.init
  // --------------------------------------------------------------------------

  init(candles: Candle[], fundingRates?: FundingRate[]): void {
    this.candles = candles;
    this.fundingRates = fundingRates ?? [];

    // Build a timestamp → FundingRate lookup for O(1) access per bar
    this.fundingRateMap = new Map();
    for (const fr of this.fundingRates) {
      this.fundingRateMap.set(fr.timestamp, fr);
    }

    // Give the strategy a chance to initialise (e.g. pre-compute indicators)
    if (this.strategy.init) {
      const context = this.createShadowContext(0);
      this.strategy.init(context);
    }

    this.initialized = true;
  }

  // --------------------------------------------------------------------------
  // SignalProvider.getSignal
  // --------------------------------------------------------------------------

  /**
   * Run the strategy's onBar() for the given bar index and interpret the first
   * emitted action as a Signal.
   *
   * Only entry actions (OPEN_LONG / OPEN_SHORT) are returned as signals.
   * Exit actions are handled via wantsExit() instead.
   *
   * Returns null when:
   * - The adapter is not yet initialised
   * - barIndex is out of range
   * - The strategy emits no actions
   * - The strategy emits only close actions
   */
  getSignal(barIndex: number): Signal | null {
    if (!this.initialized || barIndex >= this.candles.length) return null;

    // If wantsExit() was already called for this bar, reuse its pending actions
    // instead of calling onBar() again (prevents double-execution on exit bars).
    if (barIndex === this.lastWantsExitBarIndex) {
      this.pendingActions = [...this.lastWantsExitActions];
      // Reset so subsequent calls on the same bar don't reuse stale actions
      this.lastWantsExitBarIndex = -1;
      this.lastWantsExitActions = [];
    } else {
      this.pendingActions = [];
      const context = this.createShadowContext(barIndex);
      this.strategy.onBar(context);
    }

    if (this.pendingActions.length === 0) return null;

    // Take the first action only
    const action = this.pendingActions[0];

    let direction: SignalDirection;
    if (action.action === 'OPEN_LONG') {
      direction = 'long';
    } else if (action.action === 'OPEN_SHORT') {
      direction = 'short';
    } else {
      // Close actions are exits, not new entry signals
      return null;
    }

    const candle = this.candles[barIndex];

    // Build the weight context from available funding-rate data up to this bar
    const recentFR = this.fundingRates.filter(fr => fr.timestamp <= candle.timestamp);
    const currentFR = this.fundingRateMap.get(candle.timestamp);

    const weightContext: WeightContext = {
      currentFundingRate: currentFR?.fundingRate,
      fundingRates: recentFR,
      currentPrice: candle.close,
      barIndex,
      symbol: this.symbol,
    };

    const weight = this.weightCalculator.calculateWeight(weightContext);

    return {
      symbol: this.symbol,
      direction,
      weight,
      strategyName: this.strategyName,
      timestamp: candle.timestamp,
    };
  }

  // --------------------------------------------------------------------------
  // SignalProvider.isInPosition
  // --------------------------------------------------------------------------

  isInPosition(): boolean {
    return this.shadowLongPosition !== null || this.shadowShortPosition !== null;
  }

  // --------------------------------------------------------------------------
  // SignalProvider.wantsExit
  // --------------------------------------------------------------------------

  /**
   * Run the strategy's onBar() for the given bar index and check whether it
   * emits any close action.
   *
   * Returns false when the adapter has no open shadow position or is not
   * initialised.
   *
   * NOTE: This runs onBar() independently of getSignal(). The engine should
   * call wantsExit() first and act on exits before calling getSignal() for
   * new entry signals on the same bar.
   */
  wantsExit(barIndex: number): boolean {
    if (!this.isInPosition()) return false;
    if (!this.initialized || barIndex >= this.candles.length) return false;

    this.pendingActions = [];
    const context = this.createShadowContext(barIndex);
    this.strategy.onBar(context);

    // Save the bar index and actions so getSignal() on the same bar can reuse
    // them instead of calling onBar() a second time.
    this.lastWantsExitBarIndex = barIndex;
    this.lastWantsExitActions = [...this.pendingActions];

    return this.pendingActions.some(
      a => a.action === 'CLOSE_LONG' || a.action === 'CLOSE_SHORT',
    );
  }

  // --------------------------------------------------------------------------
  // SignalProvider.confirmExecution
  // --------------------------------------------------------------------------

  /**
   * Called by the engine after it successfully executes a signal. Updates the
   * shadow position using the most recent candle's close price as entry price.
   */
  confirmExecution(direction: SignalDirection): void {
    const currentPrice =
      this.candles.length > 0 ? this.candles[this.candles.length - 1].close : 0;

    if (direction === 'long') {
      this.shadowLongPosition = {
        id: `shadow-${Date.now()}`,
        symbol: this.symbol,
        side: 'long',
        amount: 1,
        entryPrice: currentPrice,
        entryTime: Date.now(),
        unrealizedPnl: 0,
      };
    } else if (direction === 'short') {
      this.shadowShortPosition = {
        id: `shadow-${Date.now()}`,
        symbol: this.symbol,
        side: 'short',
        amount: 1,
        entryPrice: currentPrice,
        entryTime: Date.now(),
        unrealizedPnl: 0,
      };
    }
    // 'flat' direction is a no-op (used to signal exit confirmation; use confirmExit() instead)
  }

  /**
   * Variant of confirmExecution that uses the close price of a specific bar
   * as the entry price. Preferred when the engine knows the exact execution bar.
   */
  confirmExecutionAtBar(direction: SignalDirection, barIndex: number): void {
    if (barIndex >= this.candles.length) return;
    const candle = this.candles[barIndex];

    if (direction === 'long') {
      this.shadowLongPosition = {
        id: `shadow-${barIndex}`,
        symbol: this.symbol,
        side: 'long',
        amount: 1,
        entryPrice: candle.close,
        entryTime: candle.timestamp,
        unrealizedPnl: 0,
      };
    } else if (direction === 'short') {
      this.shadowShortPosition = {
        id: `shadow-${barIndex}`,
        symbol: this.symbol,
        side: 'short',
        amount: 1,
        entryPrice: candle.close,
        entryTime: candle.timestamp,
        unrealizedPnl: 0,
      };
    }
  }

  // --------------------------------------------------------------------------
  // SignalProvider.resetShadow
  // --------------------------------------------------------------------------

  /** Unconditionally clears both shadow positions. */
  resetShadow(): void {
    this.shadowLongPosition = null;
    this.shadowShortPosition = null;
  }

  // --------------------------------------------------------------------------
  // Additional helpers
  // --------------------------------------------------------------------------

  /** Confirm that the engine closed the position. Clears shadow positions. */
  confirmExit(): void {
    this.shadowLongPosition = null;
    this.shadowShortPosition = null;
  }

  // --------------------------------------------------------------------------
  // Private: shadow context factory
  // --------------------------------------------------------------------------

  private createShadowContext(barIndex: number): StrategyContext {
    const candle = this.candles[barIndex];
    const price = candle.close;

    // Compute a simple shadow equity figure so strategies that size positions
    // relative to equity see a plausible number.
    let shadowEquity = this.shadowCash;
    if (this.shadowLongPosition) {
      shadowEquity += this.shadowLongPosition.amount * price;
    }
    if (this.shadowShortPosition) {
      // Unrealised PnL on a short = (entry - current) * amount
      shadowEquity +=
        (this.shadowShortPosition.entryPrice - price) * this.shadowShortPosition.amount;
    }

    const recentFR = this.fundingRates.filter(fr => fr.timestamp <= candle.timestamp);
    const currentFR = this.fundingRateMap.get(candle.timestamp) ?? null;

    // Snapshot shadow positions for the context (avoid aliasing)
    const longSnap = this.shadowLongPosition ? { ...this.shadowLongPosition } : null;
    const shortSnap = this.shadowShortPosition ? { ...this.shadowShortPosition } : null;

    // Capture instance fields for use inside closures (avoid this-alias)
    const adapterCandles = this.candles;
    const pendingActions = this.pendingActions;

    const context: StrategyContext = {
      // ----- Market data -----
      get candles(): Candle[] {
        // Return a slice so the strategy cannot mutate the internal array
        return adapterCandles.slice(0, barIndex + 1);
      },
      candleView: new CandleViewImpl(adapterCandles, barIndex),
      currentIndex: barIndex,
      currentCandle: candle,
      params: this.params,

      // ----- Portfolio state -----
      portfolio: {
        cash: this.shadowCash,
        balance: this.shadowCash,
        equity: shadowEquity,
        longPosition: longSnap,
        shortPosition: shortSnap,
      },
      balance: this.shadowCash,
      equity: shadowEquity,
      longPosition: longSnap,
      shortPosition: shortSnap,

      // ----- Funding rate data (futures mode) -----
      fundingRates: recentFR.length > 0 ? recentFR : undefined,
      currentFundingRate: currentFR,

      // ----- Trading actions - captured into pendingActions -----
      openLong(amount: number): void {
        if (amount > 0) {
          pendingActions.push({ action: 'OPEN_LONG', amount });
        }
      },
      closeLong(amount?: number): void {
        pendingActions.push({ action: 'CLOSE_LONG', amount: amount ?? 'all' });
      },
      openShort(amount: number): void {
        if (amount > 0) {
          pendingActions.push({ action: 'OPEN_SHORT', amount });
        }
      },
      closeShort(amount?: number): void {
        pendingActions.push({ action: 'CLOSE_SHORT', amount: amount ?? 'all' });
      },

      // ----- Legacy actions -----
      buy(amount: number): void {
        if (amount > 0) pendingActions.push({ action: 'OPEN_LONG', amount });
      },
      sell(amount: number): void {
        if (amount > 0) pendingActions.push({ action: 'CLOSE_LONG', amount });
      },

      // ----- Utilities -----
      log(_message: string): void {
        // Silent in shadow mode - strategy logs are discarded to avoid noise
      },
    };

    return context;
  }
}
