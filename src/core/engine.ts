/**
 * Backtesting Engine
 * Main orchestrator that runs backtests by coordinating all components
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BacktestConfig,
  BacktestResult,
  Candle,
  Trade,
  Order,
  Timeframe,
  FundingRate,
  TradeAction,
} from './types.js';
import { BacktestConfigSchema, timeframeToMs } from './types.js';
import { Portfolio } from './portfolio.js';
import { LeveragedPortfolio } from './leveraged-portfolio.js';
import { Broker, type BrokerConfig } from './broker.js';
import { loadStrategy } from '../strategy/loader.js';
import { validateStrategyParams, type StrategyContext, type LogEntry, type Strategy } from '../strategy/base.js';
import { CandleViewImpl, type PendingAction } from './candle-view.js';
import { calculateMetrics, generateEquityCurve, calculateRollingMetrics } from '../analysis/metrics.js';
import { getProvider } from '../data/providers/index.js';
import { getCandles, saveCandles, saveBacktestRun, getCandleDateRange, getFundingRates } from '../data/db.js';
import { DEFAULT_TAKER_FEE_RATE, DEFAULT_FUTURES_SLIPPAGE_PERCENT } from './constants.js';
import { validateFundingRateCoverage, validateCandleCoverage } from './funding-rate-validation.js';
import { checkSlTpTrigger, resolveAmbiguousExit, getSubTimeframe } from './intra-bar.js';

// ============================================================================
// Core backtest loop — pure, injectable, no DB / filesystem dependencies
// ============================================================================

/**
 * All inputs required to run the inner backtest loop.
 * Every external dependency (candles, funding rates, sub-candle resolution)
 * is passed in explicitly so the function has zero imports from ../data/.
 */
export interface CoreBacktestInput {
  /** Full backtest configuration (validated) */
  config: BacktestConfig;
  /** Candles for the backtest period (sorted ascending) */
  candles: Candle[];
  /** Pre-loaded, validated strategy instance */
  strategy: Strategy;
  /** Validated strategy parameters */
  params: Record<string, unknown>;
  /** Funding rates for the period (futures mode; empty array for spot) */
  fundingRates: FundingRate[];
  /** Broker fee/slippage configuration */
  brokerConfig: BrokerConfig;
  /** Leverage multiplier (1 = no leverage) */
  leverage: number;
  /** Starting capital */
  initialCapital: number;
  /** Whether to print log messages to console (default false) */
  enableLogging?: boolean;
  /**
   * Stop early if equity drops below this fraction of initial capital.
   * e.g. 0.3 = stop when equity < 30% of initialCapital.
   */
  earlyStopEquityFraction?: number;
  /** Progress callback invoked every 100 bars */
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  /**
   * Sub-candle timeframe for intra-bar SL/TP disambiguation.
   * - undefined → auto-detect from config.timeframe (default)
   * - null       → disable sub-candle resolution (always pessimistic)
   * - Timeframe  → use this specific sub-timeframe
   */
  intraBarTimeframe?: Timeframe | null;
  /**
   * Injectable sub-candle resolver.
   * Called when both SL and TP trigger on the same bar.
   * If not provided, the ambiguous case always uses pessimistic fill (SL wins).
   */
  subCandleResolver?: (barTimestamp: number, barDurationMs: number, subTimeframe: Timeframe) => Promise<Candle[]>;
}

/**
 * Raw output of the core backtest loop.
 * The caller (runBacktest) converts this to a full BacktestResult by computing
 * metrics, equity curve, and saving to DB.
 */
export interface CoreBacktestOutput {
  /** All trades executed during the backtest */
  trades: Trade[];
  /** Per-bar equity snapshots (parallel arrays) */
  equity: { timestamp: number; equity: number }[];
  /** Per-bar indicator values emitted via ctx.setIndicator() */
  indicators: Record<string, { timestamps: number[]; values: number[] }>;
  /** Total funding income (positive = received, negative = paid) */
  totalFundingIncome: number;
  /** Number of bars where engine-managed SL triggered */
  engineStopLossCount: number;
  /** Number of bars where engine-managed TP triggered */
  engineTakeProfitCount: number;
  /** Number of bars where both SL and TP triggered simultaneously */
  pessimisticSlTpCount: number;
  /** Number of bars where sub-candle resolution was used */
  subCandleResolvedCount: number;
  /** Total bars processed (may be less than candles.length if early-stopped) */
  barsProcessed: number;
}

/**
 * Run the core backtest loop with no external I/O.
 *
 * This function is the pure heart of the backtesting engine.
 * It accepts all data as inputs and returns raw loop outputs.
 * It has zero imports from ../data/ — fully unit-testable.
 */
export async function runCoreBacktestLoop(input: CoreBacktestInput): Promise<CoreBacktestOutput> {
  const {
    config,
    candles,
    strategy,
    params,
    fundingRates,
    brokerConfig,
    leverage,
    initialCapital,
    enableLogging = false,
    earlyStopEquityFraction,
    onProgress,
    subCandleResolver,
  } = input;

  // Resolve intraBarTimeframe: undefined → auto-detect, null → disabled, Timeframe → use as-is
  const intraBarTimeframe: Timeframe | null =
    input.intraBarTimeframe === undefined
      ? getSubTimeframe(config.timeframe as Timeframe)
      : input.intraBarTimeframe;

  // --- Internal log helper (no DB, just console) ---
  const log = (message: string, timestamp: number): void => {
    if (enableLogging) {
      console.log(`[${new Date(timestamp).toISOString()}] ${message}`);
    }
  };

  // --- Build funding rate map for O(1) lookup ---
  const fundingRateMap: Map<number, FundingRate> | null = fundingRates.length > 0
    ? new Map(fundingRates.map(fr => [fr.timestamp, fr]))
    : null;

  const isFuturesMode = config.mode === 'futures';

  // --- Portfolio + Broker ---
  const portfolio = leverage > 1
    ? new LeveragedPortfolio(initialCapital, config.symbol, leverage)
    : new Portfolio(initialCapital, config.symbol);
  const broker = new Broker(portfolio, brokerConfig);

  // --- Result accumulators ---
  const trades: Trade[] = [];
  const equityPoints: { timestamp: number; equity: number }[] = [];
  const filledOrders: Order[] = [];
  const indicators: Record<string, { timestamps: number[]; values: number[] }> = {};
  let barIndicators: Record<string, number> = {};

  // --- Per-position funding income accumulator ---
  const fundingByPositionId = new Map<string, number>();
  let totalFundingIncome = 0;

  // --- Pending action queue ---
  let pendingActions: PendingAction[] = [];

  // --- Engine-managed SL/TP state ---
  let activeStopLoss: number | null = null;
  let activeTakeProfit: number | null = null;
  let engineStopLossCount = 0;
  let engineTakeProfitCount = 0;
  let pessimisticSlTpCount = 0;
  let subCandleResolvedCount = 0;

  // --- Slippage helper for engine-managed SL/TP exits ---
  function applySlippageToExitPrice(price: number, side: 'long' | 'short'): number {
    const slippage = brokerConfig.slippagePercent ?? 0;
    if (slippage === 0) return price;
    // Closing a long = selling → adverse slippage goes down
    // Closing a short = buying → adverse slippage goes up
    return side === 'long'
      ? price * (1 - slippage / 100)
      : price * (1 + slippage / 100);
  }

  // --- Build reusable context ---
  const reusableCandleView = new CandleViewImpl(candles, 0);

  const ctx: StrategyContext = {
    get candles(): Candle[] {
      return candles.slice(0, ctx.currentIndex + 1);
    },
    candleView: reusableCandleView,
    currentIndex: 0,
    currentCandle: candles[0],
    params,

    portfolio: portfolio.getState(),
    balance: 0,
    equity: 0,
    longPosition: null,
    shortPosition: null,

    fundingRates: fundingRateMap ? fundingRates : undefined,
    currentFundingRate: undefined,

    openLong(amount: number): void {
      if (amount > 0) pendingActions.push({ action: 'OPEN_LONG', amount });
    },
    closeLong(amount?: number): void {
      pendingActions.push({ action: 'CLOSE_LONG', amount: amount ?? 'all' });
    },
    openShort(amount: number): void {
      if (amount > 0) pendingActions.push({ action: 'OPEN_SHORT', amount });
    },
    closeShort(amount?: number): void {
      pendingActions.push({ action: 'CLOSE_SHORT', amount: amount ?? 'all' });
    },
    buy(amount: number): void {
      if (amount > 0) pendingActions.push({ action: 'OPEN_LONG', amount });
    },
    sell(amount: number): void {
      if (amount > 0) pendingActions.push({ action: 'CLOSE_LONG', amount });
    },
    setStopLoss(price: number | null): void {
      activeStopLoss = price;
    },
    setTakeProfit(price: number | null): void {
      activeTakeProfit = price;
    },
    log(message: string): void {
      log(`[Strategy] ${message}`, ctx.currentCandle.timestamp);
    },
    setIndicator(name: string, value: number): void {
      barIndicators[name] = value;
    },
  };

  const updateContext = (currentIndex: number): void => {
    const portfolioState = portfolio.getState();
    ctx.currentIndex = currentIndex;
    ctx.currentCandle = candles[currentIndex];
    reusableCandleView.endIndex = currentIndex;
    ctx.portfolio = portfolioState;
    ctx.balance = portfolioState.balance;
    ctx.equity = portfolioState.equity;
    ctx.longPosition = portfolioState.longPosition;
    ctx.shortPosition = portfolioState.shortPosition;
    if (fundingRateMap) {
      ctx.currentFundingRate = fundingRateMap.get(candles[currentIndex].timestamp) ?? null;
    }
  };

  // --- Strategy init ---
  if (strategy.init) {
    updateContext(0);
    strategy.init(ctx);
  }

  // --- Main loop ---
  const totalBars = candles.length;
  log(`Processing ${totalBars} bars`, Date.now());

  let barsProcessed = 0;

  for (let i = 0; i < totalBars; i++) {
    const candle = candles[i];
    barsProcessed++;

    // Update portfolio price
    portfolio.updatePrice(candle.close);

    // Check for liquidation (only for leveraged portfolios)
    if (portfolio instanceof LeveragedPortfolio && portfolio.wasLiquidated) {
      const liqTrade = portfolio.getLiquidationTrade();
      if (liqTrade) {
        trades.push(liqTrade);
        log(`LIQUIDATION: Position closed at ${candle.close}`, candle.timestamp);
      }
    }

    // Process funding payments (futures mode)
    if (fundingRateMap && isFuturesMode) {
      const fr = fundingRateMap.get(candle.timestamp);
      if (fr) {
        const longPos = portfolio.longPosition;
        const shortPos = portfolio.shortPosition;

        if (longPos) {
          const markPrice = fr.markPrice ?? candle.close;
          const payment = -longPos.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
          fundingByPositionId.set(longPos.id, (fundingByPositionId.get(longPos.id) ?? 0) + payment);
        }

        if (shortPos) {
          const markPrice = fr.markPrice ?? candle.close;
          const payment = shortPos.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
          fundingByPositionId.set(shortPos.id, (fundingByPositionId.get(shortPos.id) ?? 0) + payment);
        }
      }
    }

    // Reset per-bar state
    pendingActions = [];
    barIndicators = {};

    // -------------------------------------------------------------------------
    // STEP A: Engine-managed SL/TP check BEFORE strategy processes this bar
    // -------------------------------------------------------------------------
    const hasLong = portfolio.hasLongPosition;
    const hasShort = portfolio.hasShortPosition;
    const hasPosition = hasLong || hasShort;
    const hasSlTp = activeStopLoss !== null || activeTakeProfit !== null;

    if (hasPosition && hasSlTp) {
      const side = hasLong ? 'long' : 'short';
      const { slTriggered, tpTriggered } = checkSlTpTrigger(
        candle,
        side,
        activeStopLoss,
        activeTakeProfit,
      );

      let engineExitPrice: number | null = null;
      let engineExitReason: 'stop_loss' | 'take_profit' | null = null;

      if (slTriggered && tpTriggered) {
        // Ambiguous: both triggered on same bar
        let subCandles: Candle[] = [];
        if (intraBarTimeframe !== null && subCandleResolver) {
          const barDurationMs = timeframeToMs(config.timeframe as Timeframe);
          subCandles = await subCandleResolver(candle.timestamp, barDurationMs, intraBarTimeframe);
          if (subCandles.length > 0) subCandleResolvedCount++;
        }

        const exitResult = resolveAmbiguousExit(
          subCandles,
          side,
          activeStopLoss!,
          activeTakeProfit!,
        );
        engineExitPrice = exitResult.exitPrice;
        engineExitReason = exitResult.exitType;
        pessimisticSlTpCount++;
      } else if (slTriggered) {
        engineExitPrice = activeStopLoss!;
        engineExitReason = 'stop_loss';
      } else if (tpTriggered) {
        engineExitPrice = activeTakeProfit!;
        engineExitReason = 'take_profit';
      }

      if (engineExitReason === 'stop_loss') engineStopLossCount++;
      else if (engineExitReason === 'take_profit') engineTakeProfitCount++;

      if (engineExitPrice !== null && engineExitReason !== null) {
        const fillPrice = applySlippageToExitPrice(engineExitPrice, side);
        const feeRateVal = brokerConfig.feeRate ?? 0;

        let engineTrade: Trade;
        if (hasLong) {
          const pos = portfolio.longPosition!;
          engineTrade = portfolio.closeLong(pos.amount, fillPrice, candle.timestamp, feeRateVal);
        } else {
          const pos = portfolio.shortPosition!;
          engineTrade = portfolio.closeShort(pos.amount, fillPrice, candle.timestamp, feeRateVal);
        }

        engineTrade.exitReason = engineExitReason;

        if (engineTrade.closedPositionId && fundingByPositionId.has(engineTrade.closedPositionId)) {
          engineTrade.fundingIncome = fundingByPositionId.get(engineTrade.closedPositionId)!;
          fundingByPositionId.delete(engineTrade.closedPositionId);
        }

        if (fundingRates.length > 0) {
          const nearest = findNearestFundingRate(fundingRates, candle.timestamp);
          if (nearest) engineTrade.fundingRate = nearest.fundingRate;
        }

        trades.push(engineTrade);

        activeStopLoss = null;
        activeTakeProfit = null;

        if (strategy.onOrderFilled) {
          const syntheticOrder: Order = {
            id: uuidv4(),
            symbol: config.symbol,
            side: side === 'long' ? 'sell' : 'buy',
            type: 'market',
            amount: engineTrade.amount,
            status: 'filled',
            createdAt: candle.timestamp,
            filledAt: candle.timestamp,
            filledPrice: fillPrice,
          };
          filledOrders.push(syntheticOrder);
        }

        updateContext(i);

        if (strategy.onOrderFilled) {
          const engineOrder = filledOrders[filledOrders.length - 1];
          strategy.onOrderFilled(ctx, engineOrder);
        }
      }
    }

    // -------------------------------------------------------------------------
    // STEP B: Normal strategy processing
    // -------------------------------------------------------------------------
    updateContext(i);
    strategy.onBar(ctx);

    // When strategy closes a position, clear active SL/TP
    if ((hasLong && !portfolio.hasLongPosition) || (hasShort && !portfolio.hasShortPosition)) {
      activeStopLoss = null;
      activeTakeProfit = null;
    }

    // Flush per-bar indicators
    for (const [name, value] of Object.entries(barIndicators)) {
      if (!indicators[name]) {
        indicators[name] = { timestamps: [], values: [] };
      }
      indicators[name].timestamps.push(candle.timestamp);
      indicators[name].values.push(value);
    }
    barIndicators = {};

    // Process strategy actions
    for (const pendingAction of pendingActions) {
      const amount = pendingAction.amount === 'all'
        ? getPositionAmount(portfolio, pendingAction.action)
        : pendingAction.amount;

      if (amount > 0) {
        broker.createOrder(
          {
            symbol: config.symbol,
            action: pendingAction.action,
            type: 'market',
            amount,
          },
          candle.timestamp
        );
      }
    }

    // Process pending orders
    const { orders: processedOrders, trades: newTrades } = broker.processPendingOrders(candle);
    filledOrders.push(...processedOrders);

    // Attach nearest funding rate to each new trade (futures mode only)
    if (fundingRates.length > 0) {
      for (const trade of newTrades) {
        const nearest = findNearestFundingRate(fundingRates, trade.timestamp);
        if (nearest) trade.fundingRate = nearest.fundingRate;
      }
    }

    // Attach funding income to close trades
    for (const trade of newTrades) {
      if (trade.closedPositionId && fundingByPositionId.has(trade.closedPositionId)) {
        trade.fundingIncome = fundingByPositionId.get(trade.closedPositionId)!;
        fundingByPositionId.delete(trade.closedPositionId);
      }
    }

    trades.push(...newTrades);

    // Call onOrderFilled for each filled order
    if (strategy.onOrderFilled) {
      for (const order of processedOrders.filter((o) => o.status === 'filled')) {
        strategy.onOrderFilled(ctx, order);
      }
    }

    // Record equity point
    equityPoints.push({ timestamp: candle.timestamp, equity: portfolio.equity });

    // Early termination check (every 100 bars)
    if (i % 100 === 0 && earlyStopEquityFraction !== undefined) {
      if (portfolio.equity < initialCapital * earlyStopEquityFraction) {
        log(
          `Early termination: equity ${portfolio.equity.toFixed(2)} dropped below ${(earlyStopEquityFraction * 100).toFixed(0)}% of initial capital`,
          candle.timestamp,
        );
        break;
      }
    }

    // Report progress
    if (onProgress && i % 100 === 0) {
      onProgress({
        current: i + 1,
        total: totalBars,
        percent: ((i + 1) / totalBars) * 100,
      });
    }
  }

  // --- Strategy onEnd ---
  if (strategy.onEnd) {
    pendingActions = [];
    updateContext(totalBars - 1);
    strategy.onEnd(ctx);

    for (const pendingAction of pendingActions) {
      const amount = pendingAction.amount === 'all'
        ? getPositionAmount(portfolio, pendingAction.action)
        : pendingAction.amount;

      if (amount > 0) {
        broker.createOrder(
          {
            symbol: config.symbol,
            action: pendingAction.action,
            type: 'market',
            amount,
          },
          candles[totalBars - 1].timestamp
        );
      }
    }

    const { orders: finalOrders, trades: finalTrades } = broker.processPendingOrders(
      candles[totalBars - 1]
    );
    filledOrders.push(...finalOrders);

    if (fundingRates.length > 0) {
      for (const trade of finalTrades) {
        const nearest = findNearestFundingRate(fundingRates, trade.timestamp);
        if (nearest) trade.fundingRate = nearest.fundingRate;
      }
    }

    for (const trade of finalTrades) {
      if (trade.closedPositionId && fundingByPositionId.has(trade.closedPositionId)) {
        trade.fundingIncome = fundingByPositionId.get(trade.closedPositionId)!;
        fundingByPositionId.delete(trade.closedPositionId);
      }
    }

    trades.push(...finalTrades);
  }

  return {
    trades,
    equity: equityPoints,
    indicators,
    totalFundingIncome,
    engineStopLossCount,
    engineTakeProfitCount,
    pessimisticSlTpCount,
    subCandleResolvedCount,
    barsProcessed,
  };
}

/**
 * Engine configuration options
 */
export interface EngineConfig {
  /**
   * Broker configuration (slippage, commission)
   */
  broker?: BrokerConfig;

  /**
   * Whether to save results to database
   */
  saveResults?: boolean;

  /**
   * Whether to log strategy messages
   */
  enableLogging?: boolean;

  /**
   * Skip fetching trading fees from exchange (use default/provided feeRate)
   * Useful for optimization to avoid API calls
   */
  skipFeeFetch?: boolean;

  /**
   * Progress callback for long-running backtests
   */
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;

  /**
   * Stop backtest early if equity drops below this fraction of initial capital (e.g., 0.3 = -70%)
   * Useful for optimizer to skip clearly bad parameter sets quickly
   */
  earlyStopEquityFraction?: number;

  /**
   * Pre-loaded candles to use instead of fetching from DB
   * Allows optimizer to load candles once and reuse across all combinations
   */
  preloadedCandles?: Candle[];

  /**
   * Pre-loaded funding rates for futures mode
   * Allows optimizer to load funding rates once and reuse across all combinations
   */
  preloadedFundingRates?: FundingRate[];

  /**
   * Pre-loaded strategy instance to skip dynamic import overhead
   * Allows optimizer to load the strategy once and reuse across all combinations
   */
  preloadedStrategy?: import('../strategy/base.js').Strategy;

  /**
   * Strategy config ID to link the saved run to a strategy_configs row.
   * When provided, the run is saved with this ID in strategy_config_id.
   */
  strategyConfigId?: string;

  /**
   * Skip funding rate coverage validation.
   * Use when running tests or scripts that operate on synthetic or partial data.
   * Defaults to false (validation is enforced).
   */
  skipFundingRateValidation?: boolean;
  /**
   * Skip candle coverage validation.
   * Use when running tests or scripts that operate on synthetic or partial data.
   * Defaults to false (validation is enforced).
   */
  skipCandleValidation?: boolean;

  /**
   * Sub-candle timeframe for intra-bar SL/TP resolution.
   * Only used when both SL and TP trigger on the same bar.
   * Default: auto-detected from main timeframe (e.g., 4h → 5m).
   * Set to null to disable sub-candle fetching (always pessimistic fill).
   */
  intraBarTimeframe?: Timeframe | null;
}

/**
 * Default engine configuration
 */
const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  broker: {
    slippagePercent: 0, // No slippage by default (matches optimizer behavior)
    commissionPercent: 0,
    feeRate: 0, // Will be overridden by fetched exchange fees
  },
  saveResults: true,
  enableLogging: true,
};

/**
 * Binary search for nearest funding rate to a given timestamp.
 * Assumes rates are sorted ascending by timestamp.
 */
function findNearestFundingRate(rates: FundingRate[], timestamp: number): FundingRate | undefined {
  if (rates.length === 0) return undefined;
  let lo = 0;
  let hi = rates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid].timestamp < timestamp) lo = mid + 1;
    else hi = mid;
  }
  // Check lo and lo-1 for nearest
  if (lo > 0 && Math.abs(rates[lo - 1].timestamp - timestamp) < Math.abs(rates[lo].timestamp - timestamp)) {
    return rates[lo - 1];
  }
  return rates[lo];
}

/**
 * Run a backtest with the given configuration.
 *
 * Acts as an orchestrator:
 * 1. Validates config
 * 2. Loads strategy / candles / funding rates / fees
 * 3. Builds CoreBacktestInput (with real subCandleResolver)
 * 4. Calls runCoreBacktestLoop()
 * 5. Converts CoreBacktestOutput → BacktestResult (metrics, equity curve)
 * 6. Saves to DB if requested
 *
 * The public API is unchanged (backward compatible).
 *
 * @param config - Backtest configuration
 * @param engineConfig - Engine options
 * @returns Backtest result with metrics and trades
 */
export async function runBacktest(
  config: BacktestConfig,
  engineConfig: EngineConfig = {}
): Promise<BacktestResult> {
  // Merge with defaults
  const options = { ...DEFAULT_ENGINE_CONFIG, ...engineConfig };

  // Validate configuration
  const validatedConfig = BacktestConfigSchema.parse(config);

  // Apply default futures slippage only when caller has not explicitly set slippagePercent
  if (validatedConfig.mode === 'futures' && engineConfig.broker?.slippagePercent === undefined) {
    options.broker = {
      ...options.broker,
      slippagePercent: DEFAULT_FUTURES_SLIPPAGE_PERCENT,
    };
  }

  // Ensure we have an ID
  if (!validatedConfig.id) {
    validatedConfig.id = uuidv4();
  }

  // Log collection
  const logs: LogEntry[] = [];

  const log = (message: string, timestamp: number): void => {
    if (options.enableLogging) {
      logs.push({ timestamp, message });
      console.log(`[${new Date(timestamp).toISOString()}] ${message}`);
    }
  };

  log(`Starting backtest: ${validatedConfig.strategyName}`, Date.now());

  // 1. Load strategy (use pre-loaded instance if provided to avoid import() overhead)
  log(`Loading strategy: ${validatedConfig.strategyName}`, Date.now());
  const strategy = options.preloadedStrategy ?? await loadStrategy(validatedConfig.strategyName);

  // Validate and apply strategy parameters
  const params = validateStrategyParams(strategy, validatedConfig.params);
  log(`Strategy params: ${JSON.stringify(params)}`, Date.now());

  // 2. Fetch or load candles (use pre-loaded if provided)
  let candles: Candle[];
  if (options.preloadedCandles) {
    log(`Using ${options.preloadedCandles.length} pre-loaded candles`, Date.now());
    candles = options.preloadedCandles;
  } else {
    log(`Fetching candles for ${validatedConfig.symbol}`, Date.now());
    candles = await fetchOrLoadCandles(
      validatedConfig.exchange,
      validatedConfig.symbol,
      validatedConfig.timeframe,
      validatedConfig.startDate,
      validatedConfig.endDate
    );
  }

  if (candles.length === 0) {
    throw new Error(
      `No candles found for ${validatedConfig.symbol} from ${new Date(validatedConfig.startDate).toISOString()} to ${new Date(validatedConfig.endDate).toISOString()}`
    );
  }

  // Validate that we have sufficient candle coverage for the date range
  validateCandleCoverage(
    candles.length,
    validatedConfig.symbol,
    validatedConfig.exchange,
    validatedConfig.timeframe,
    validatedConfig.startDate,
    validatedConfig.endDate,
    options.skipCandleValidation,
  );

  log(`Loaded ${candles.length} candles`, Date.now());

  // 3. Load funding rates for futures mode (use pre-loaded if provided)
  let allFundingRates: FundingRate[] = [];

  if (validatedConfig.mode === 'futures') {
    if (options.preloadedFundingRates) {
      log(`Using ${options.preloadedFundingRates.length} pre-loaded funding rates`, Date.now());
      allFundingRates = options.preloadedFundingRates;
    } else {
      log(`Loading funding rates for ${validatedConfig.symbol}`, Date.now());
      allFundingRates = await getFundingRates(
        validatedConfig.exchange,
        validatedConfig.symbol,
        validatedConfig.startDate,
        validatedConfig.endDate
      );
      log(`Loaded ${allFundingRates.length} funding rates`, Date.now());
    }

    // Validate that we have sufficient funding rate coverage (throws if < 80%)
    validateFundingRateCoverage(
      allFundingRates,
      validatedConfig.symbol,
      validatedConfig.exchange,
      validatedConfig.startDate,
      validatedConfig.endDate,
      options.skipFundingRateValidation,
    );
  }

  // 4. Get trading fees (skip API call if skipFeeFetch is set)
  let feeRate = options.broker?.feeRate ?? DEFAULT_TAKER_FEE_RATE;

  if (!options.skipFeeFetch) {
    log(`Fetching trading fees for ${validatedConfig.symbol}`, Date.now());
    const provider = getProvider(validatedConfig.exchange);
    try {
      const fees = await provider.fetchTradingFees(validatedConfig.symbol);
      feeRate = fees.taker;
      log(`Using exchange fee rate: ${(feeRate * 100).toFixed(3)}% (taker)`, Date.now());
    } catch {
      log(`Could not fetch fees, using default: ${(feeRate * 100).toFixed(3)}%`, Date.now());
    }
  }

  const brokerConfig: BrokerConfig = {
    ...options.broker,
    feeRate,
  };

  const leverage = validatedConfig.leverage ?? 1;
  log(`Using leverage: ${leverage}x`, Date.now());

  // 5. Build the injectable sub-candle resolver (wraps DB + exchange fetch)
  const subCandleFetchedRanges = new Set<string>();

  async function fetchSubCandlesForBar(
    barTimestamp: number,
    barDurationMs: number,
    subTimeframe: Timeframe,
  ): Promise<Candle[]> {
    const rangeKey = `${subTimeframe}:${barTimestamp}`;
    if (subCandleFetchedRanges.has(rangeKey)) {
      return getCandles(
        validatedConfig.exchange,
        validatedConfig.symbol,
        subTimeframe,
        barTimestamp,
        barTimestamp + barDurationMs - 1,
      );
    }

    const dbCandles = await getCandles(
      validatedConfig.exchange,
      validatedConfig.symbol,
      subTimeframe,
      barTimestamp,
      barTimestamp + barDurationMs - 1,
    );

    if (dbCandles.length > 0) {
      subCandleFetchedRanges.add(rangeKey);
      return dbCandles;
    }

    try {
      const provider = getProvider(validatedConfig.exchange);
      const fetched = await provider.fetchCandles(
        validatedConfig.symbol,
        subTimeframe,
        new Date(barTimestamp),
        new Date(barTimestamp + barDurationMs - 1),
      );

      if (fetched.length > 0) {
        await saveCandles(fetched, validatedConfig.exchange, validatedConfig.symbol, subTimeframe);
      }

      subCandleFetchedRanges.add(rangeKey);
      return fetched;
    } catch {
      subCandleFetchedRanges.add(rangeKey);
      return [];
    }
  }

  // 6. Run the pure core loop
  log(`Processing ${candles.length} bars`, Date.now());
  const loopOutput = await runCoreBacktestLoop({
    config: validatedConfig,
    candles,
    strategy,
    params,
    fundingRates: allFundingRates,
    brokerConfig,
    leverage,
    initialCapital: validatedConfig.initialCapital,
    enableLogging: options.enableLogging,
    earlyStopEquityFraction: options.earlyStopEquityFraction,
    onProgress: options.onProgress,
    intraBarTimeframe: options.intraBarTimeframe,
    subCandleResolver: fetchSubCandlesForBar,
  });

  const {
    trades,
    equity: equityPoints,
    indicators,
    totalFundingIncome,
    engineStopLossCount,
    engineTakeProfitCount,
    pessimisticSlTpCount,
  } = loopOutput;

  // 7. Generate equity curve with drawdown
  const equityTimestamps = equityPoints.map(p => p.timestamp);
  const equityValues = equityPoints.map(p => p.equity);

  const equity = generateEquityCurve(
    equityTimestamps,
    equityValues,
    validatedConfig.initialCapital
  );

  // 8. Calculate metrics
  log(`Calculating metrics from ${trades.length} trades`, Date.now());
  const metrics = calculateMetrics(trades, equity, validatedConfig.initialCapital, validatedConfig.timeframe);
  const rollingMetrics = calculateRollingMetrics(trades, equity, validatedConfig.initialCapital);

  // Add funding income metrics for futures mode
  if (validatedConfig.mode === 'futures') {
    (metrics as Record<string, unknown>).totalFundingIncome = totalFundingIncome;
    (metrics as Record<string, unknown>).tradingPnl = metrics.totalReturn - totalFundingIncome;
  }

  // Add engine-managed SL/TP counters (only populated when strategy uses setStopLoss/setTakeProfit)
  if (engineStopLossCount > 0 || engineTakeProfitCount > 0 || pessimisticSlTpCount > 0) {
    (metrics as Record<string, unknown>).engineStopLossCount = engineStopLossCount;
    (metrics as Record<string, unknown>).engineTakeProfitCount = engineTakeProfitCount;
    (metrics as Record<string, unknown>).pessimisticSlTpCount = pessimisticSlTpCount;
  }

  // 9. Build result
  const result: BacktestResult = {
    id: validatedConfig.id,
    config: { ...validatedConfig, params },
    trades,
    equity,
    metrics,
    rollingMetrics,
    ...(Object.keys(indicators).length > 0 ? { indicators } : {}),
    createdAt: Date.now(),
  };

  // 10. Save to database
  if (options.saveResults) {
    log('Saving results to database', Date.now());
    await saveBacktestRun(result, undefined, options.strategyConfigId);
  }

  log(`Backtest complete. Total return: ${metrics.totalReturnPercent.toFixed(2)}%`, Date.now());

  return result;
}

/**
 * Get the position amount for a close action
 */
function getPositionAmount(portfolio: Portfolio, action: TradeAction): number {
  switch (action) {
    case 'CLOSE_LONG':
      return portfolio.longPosition?.amount ?? 0;
    case 'CLOSE_SHORT':
      return portfolio.shortPosition?.amount ?? 0;
    default:
      return 0;
  }
}

/**
 * Fetch candles from exchange or load from cache
 */
async function fetchOrLoadCandles(
  exchange: string,
  symbol: string,
  timeframe: Timeframe,
  startDate: number,
  endDate: number
): Promise<Candle[]> {
  let candles: Candle[];

  // Check what we have in cache
  const cachedRange = await getCandleDateRange(exchange, symbol, timeframe);

  const hasCachedData = cachedRange.start !== null && cachedRange.end !== null;
  const hasFullCoverage = hasCachedData &&
    cachedRange.start! <= startDate &&
    cachedRange.end! >= endDate;

  if (hasFullCoverage) {
    console.log('Using cached candles');
    candles = await getCandles(exchange, symbol, timeframe, startDate, endDate);
  } else {
    // Fetch from exchange
    console.log('Fetching candles from exchange...');
    const provider = getProvider(exchange);
    candles = await provider.fetchCandles(
      symbol,
      timeframe,
      new Date(startDate),
      new Date(endDate)
    );

    // Cache the fetched candles
    if (candles.length > 0) {
      console.log(`Caching ${candles.length} candles`);
      await saveCandles(candles, exchange, symbol, timeframe);
    }
  }

  return candles;
}

/**
 * Create a backtest configuration with defaults
 */
export function createBacktestConfig(
  overrides: Partial<BacktestConfig> & {
    strategyName: string;
    symbol: string;
    startDate: number;
    endDate: number;
  }
): BacktestConfig {
  return {
    id: uuidv4(),
    timeframe: '1h',
    initialCapital: 10000,
    exchange: 'binance',
    params: {},
    ...overrides,
  };
}

/**
 * Validate a backtest configuration without running it
 */
export async function validateBacktestConfig(config: BacktestConfig): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    BacktestConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof Error) {
      errors.push(`Invalid config: ${error.message}`);
    }
    return { valid: false, errors };
  }

  // Check if strategy exists
  try {
    const strategy = await loadStrategy(config.strategyName);
    validateStrategyParams(strategy, config.params);
  } catch (error) {
    if (error instanceof Error) {
      errors.push(`Strategy error: ${error.message}`);
    }
    return { valid: false, errors };
  }

  // Check date range
  if (config.startDate >= config.endDate) {
    errors.push('Start date must be before end date');
  }

  // Check capital
  if (config.initialCapital <= 0) {
    errors.push('Initial capital must be positive');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
