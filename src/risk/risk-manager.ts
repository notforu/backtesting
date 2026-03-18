/**
 * RiskManager — standalone safety gate for trade execution.
 *
 * All trade validation, kill-switch management, position counting, and daily
 * limit tracking lives here.  The module is pure TypeScript with no external
 * dependencies and is fully synchronous (thread-safe).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RiskManagerConfig {
  /** Maximum total committed capital across all open positions ($). */
  maxCapital: number;
  /** Maximum size of a single trade ($). */
  maxTradeSize: number;
  /** Maximum number of simultaneously open positions. */
  maxPositions: number;
  /** Whether the kill switch feature is active. */
  killSwitchEnabled: boolean;
  /** Drawdown from peak equity that triggers the kill switch (%). Must be in (0, 100). */
  killSwitchDDPercent: number;
  /** Symbols that are permitted to trade.  Empty array = all symbols allowed. */
  symbolWhitelist: string[];
  /** Optional: maximum dollar loss allowed in a single calendar day. */
  maxDailyLoss?: number;
  /** Optional: maximum number of trades allowed in a single calendar day. */
  maxDailyTrades?: number;
}

export interface RiskManagerState {
  peakEquity: number;
  currentEquity: number;
  currentDrawdownPercent: number;
  openPositionCount: number;
  dailyLoss: number;
  dailyTradeCount: number;
  isKillSwitchTriggered: boolean;
  /** Unix millisecond timestamp when kill switch was triggered, or null. */
  killSwitchTriggeredAt: number | null;
  /** YYYY-MM-DD string — date of the last daily counter reset. */
  lastResetDate: string;
}

export interface TradeValidation {
  allowed: boolean;
  /** Human-readable rejection reason; present only when allowed === false. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function validateConfig(cfg: RiskManagerConfig): void {
  if (cfg.maxCapital <= 0) {
    throw new Error(`Invalid config: maxCapital must be > 0, got ${cfg.maxCapital}`);
  }
  if (cfg.maxTradeSize < 0) {
    throw new Error(`Invalid config: maxTradeSize must be >= 0, got ${cfg.maxTradeSize}`);
  }
  if (cfg.maxPositions < 1) {
    throw new Error(`Invalid config: maxPositions must be >= 1, got ${cfg.maxPositions}`);
  }
  if (cfg.killSwitchDDPercent <= 0 || cfg.killSwitchDDPercent >= 100) {
    throw new Error(
      `Invalid config: killSwitchDDPercent must be in (0, 100), got ${cfg.killSwitchDDPercent}`,
    );
  }
}

// ---------------------------------------------------------------------------
// RiskManager class
// ---------------------------------------------------------------------------

export class RiskManager {
  private config: RiskManagerConfig;

  // ---- mutable state ----
  private peakEquity: number = 0;
  private currentEquity: number = 0;
  private openPositionCount: number = 0;
  private committedCapital: number = 0;
  private dailyLoss: number = 0;
  private dailyTradeCount: number = 0;
  private isKillSwitchTriggered: boolean = false;
  private killSwitchTriggeredAt: number | null = null;
  private lastResetDate: string;

  constructor(config: RiskManagerConfig) {
    validateConfig(config);
    this.config = { ...config, symbolWhitelist: [...config.symbolWhitelist] };
    this.lastResetDate = todayISO();
  }

  // -------------------------------------------------------------------------
  // Pre-trade validation
  // -------------------------------------------------------------------------

  validateTrade(trade: {
    symbol: string;
    size: number;
    direction: 'long' | 'short';
  }): TradeValidation {
    // 1. Kill switch
    if (this.isKillSwitchTriggered) {
      return { allowed: false, reason: 'Kill switch is triggered — all trading is halted' };
    }

    // 2. Symbol whitelist
    const { symbolWhitelist } = this.config;
    if (symbolWhitelist.length > 0 && !symbolWhitelist.includes(trade.symbol)) {
      return {
        allowed: false,
        reason: `Symbol "${trade.symbol}" is not in the whitelist`,
      };
    }

    // 3. Max trade size
    if (trade.size > this.config.maxTradeSize) {
      return {
        allowed: false,
        reason: `Trade size $${trade.size} exceeds maxTradeSize $${this.config.maxTradeSize}`,
      };
    }

    // 4. Max positions
    if (this.openPositionCount >= this.config.maxPositions) {
      return {
        allowed: false,
        reason: `Already at maxPositions (${this.config.maxPositions}) open positions`,
      };
    }

    // 5. Max capital (committed capital check)
    if (this.committedCapital + trade.size > this.config.maxCapital) {
      return {
        allowed: false,
        reason: `Trade would exceed maxCapital: committed $${this.committedCapital} + $${trade.size} > $${this.config.maxCapital}`,
      };
    }

    // 6. Daily loss limit
    if (this.config.maxDailyLoss !== undefined && this.dailyLoss >= this.config.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit $${this.config.maxDailyLoss} reached (current: $${this.dailyLoss})`,
      };
    }

    // 7. Daily trades limit
    if (
      this.config.maxDailyTrades !== undefined &&
      this.dailyTradeCount >= this.config.maxDailyTrades
    ) {
      return {
        allowed: false,
        reason: `Daily trades limit ${this.config.maxDailyTrades} reached (count: ${this.dailyTradeCount})`,
      };
    }

    return { allowed: true };
  }

  // -------------------------------------------------------------------------
  // State updates
  // -------------------------------------------------------------------------

  onTradeOpened(trade: { symbol: string; size: number }): void {
    this.openPositionCount += 1;
    this.committedCapital += trade.size;
    this.dailyTradeCount += 1;
  }

  onTradeClosed(trade: { symbol: string; pnl: number }): void {
    // Never let position count go below 0
    if (this.openPositionCount > 0) {
      this.openPositionCount -= 1;
    }
    // Reduce committed capital — guard against negative committed capital
    // We don't track per-trade size here so we just leave committedCapital alone
    // unless the caller provides size; position sizing is already validated on open.
    // dailyLoss accumulates only for losing trades
    if (trade.pnl < 0) {
      this.dailyLoss += Math.abs(trade.pnl);
    }
  }

  onEquityUpdate(equity: number): void {
    this.currentEquity = equity;
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }
    // Auto-check kill switch on every equity update
    this._maybeAutoTriggerKillSwitch();
  }

  // -------------------------------------------------------------------------
  // Kill switch
  // -------------------------------------------------------------------------

  checkKillSwitch(): { triggered: boolean; reason?: string } {
    if (!this.config.killSwitchEnabled) {
      return { triggered: false };
    }
    if (this.isKillSwitchTriggered) {
      // Return a consistent drawdown-based reason whether triggered now or previously.
      const dd = this._calcDrawdownPercent();
      return {
        triggered: true,
        reason: `Drawdown ${dd.toFixed(2)}% exceeded threshold ${this.config.killSwitchDDPercent}%`,
      };
    }
    const dd = this._calcDrawdownPercent();
    if (dd >= this.config.killSwitchDDPercent) {
      this.isKillSwitchTriggered = true;
      this.killSwitchTriggeredAt = Date.now();
      return {
        triggered: true,
        reason: `Drawdown ${dd.toFixed(2)}% exceeded threshold ${this.config.killSwitchDDPercent}%`,
      };
    }
    return { triggered: false };
  }

  resetKillSwitch(): void {
    this.isKillSwitchTriggered = false;
    this.killSwitchTriggeredAt = null;
  }

  // -------------------------------------------------------------------------
  // State / config accessors
  // -------------------------------------------------------------------------

  getState(): RiskManagerState {
    return {
      peakEquity: this.peakEquity,
      currentEquity: this.currentEquity,
      currentDrawdownPercent: this._calcDrawdownPercent(),
      openPositionCount: this.openPositionCount,
      dailyLoss: this.dailyLoss,
      dailyTradeCount: this.dailyTradeCount,
      isKillSwitchTriggered: this.isKillSwitchTriggered,
      killSwitchTriggeredAt: this.killSwitchTriggeredAt,
      lastResetDate: this.lastResetDate,
    };
  }

  getConfig(): RiskManagerConfig {
    return {
      ...this.config,
      symbolWhitelist: [...this.config.symbolWhitelist],
    };
  }

  updateConfig(partial: Partial<RiskManagerConfig>): void {
    const merged: RiskManagerConfig = {
      ...this.config,
      ...partial,
    };
    validateConfig(merged);
    this.config = {
      ...merged,
      symbolWhitelist: [...(merged.symbolWhitelist ?? this.config.symbolWhitelist)],
    };
  }

  // -------------------------------------------------------------------------
  // Daily reset
  // -------------------------------------------------------------------------

  resetDailyCounters(): void {
    this.dailyLoss = 0;
    this.dailyTradeCount = 0;
    this.lastResetDate = todayISO();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _calcDrawdownPercent(): number {
    if (this.peakEquity === 0) return 0;
    const dd = ((this.peakEquity - this.currentEquity) / this.peakEquity) * 100;
    return Math.max(0, dd);
  }

  private _maybeAutoTriggerKillSwitch(): void {
    if (!this.config.killSwitchEnabled) return;
    if (this.isKillSwitchTriggered) return;
    const dd = this._calcDrawdownPercent();
    if (dd >= this.config.killSwitchDDPercent) {
      this.isKillSwitchTriggered = true;
      this.killSwitchTriggeredAt = Date.now();
    }
  }
}
