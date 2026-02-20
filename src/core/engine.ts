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
  TradeAction,
  FundingRate,
} from './types.js';
import { BacktestConfigSchema, timeframeToMs } from './types.js';
import { Portfolio } from './portfolio.js';
import { LeveragedPortfolio } from './leveraged-portfolio.js';
import { Broker, type BrokerConfig } from './broker.js';
import { loadStrategy } from '../strategy/loader.js';
import { validateStrategyParams, type StrategyContext, type LogEntry, type CandleView } from '../strategy/base.js';
import { calculateMetrics, generateEquityCurve, calculateRollingMetrics } from '../analysis/metrics.js';
import { getProvider } from '../data/providers/index.js';
import { getCandles, saveCandles, saveBacktestRun, getCandleDateRange, getFundingRates } from '../data/db.js';
import { saveResultToFile } from './result-storage.js';

/**
 * Forward-fill candles to ensure no gaps in the data
 * Useful for prediction markets where some periods may have no trades
 */
function forwardFillCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  if (candles.length <= 1) return candles;

  const timeframeMs = timeframeToMs(timeframe);
  const filled: Candle[] = [];

  let lastCandle = candles[0];
  let candleIndex = 0;
  const firstTs = candles[0].timestamp;
  const lastTs = candles[candles.length - 1].timestamp;

  for (let t = firstTs; t <= lastTs; t += timeframeMs) {
    if (candleIndex < candles.length && candles[candleIndex].timestamp === t) {
      filled.push(candles[candleIndex]);
      lastCandle = candles[candleIndex];
      candleIndex++;
    } else {
      filled.push({
        timestamp: t,
        open: lastCandle.close,
        high: lastCandle.close,
        low: lastCandle.close,
        close: lastCandle.close,
        volume: 0,
      });
    }
  }

  return filled;
}

/**
 * Memory-efficient view into candle array without copying
 */
class CandleViewImpl implements CandleView {
  constructor(
    private readonly candles: Candle[],
    private readonly endIndex: number
  ) {}

  get length(): number {
    return this.endIndex + 1;
  }

  at(index: number): Candle | undefined {
    if (index < 0 || index > this.endIndex) return undefined;
    return this.candles[index];
  }

  slice(start?: number, end?: number): Candle[] {
    const s = start ?? 0;
    const e = Math.min(end ?? this.length, this.length);
    return this.candles.slice(s, e);
  }

  closes(): number[] {
    const result = new Array(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].close;
    }
    return result;
  }

  volumes(): number[] {
    const result = new Array(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].volume;
    }
    return result;
  }

  highs(): number[] {
    const result = new Array(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].high;
    }
    return result;
  }

  lows(): number[] {
    const result = new Array(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].low;
    }
    return result;
  }
}

/**
 * Pending action from strategy
 */
interface PendingAction {
  action: TradeAction;
  amount: number | 'all';
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
 * Run a backtest with the given configuration
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
      slippagePercent: 0.05, // 0.05% default slippage for futures
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

  // 1. Load strategy
  log(`Loading strategy: ${validatedConfig.strategyName}`, Date.now());
  const strategy = await loadStrategy(validatedConfig.strategyName);

  // Validate and apply strategy parameters
  const params = validateStrategyParams(strategy, validatedConfig.params);
  log(`Strategy params: ${JSON.stringify(params)}`, Date.now());

  // 2. Fetch or load candles
  log(`Fetching candles for ${validatedConfig.symbol}`, Date.now());
  const candles = await fetchOrLoadCandles(
    validatedConfig.exchange,
    validatedConfig.symbol,
    validatedConfig.timeframe,
    validatedConfig.startDate,
    validatedConfig.endDate
  );

  if (candles.length === 0) {
    throw new Error(
      `No candles found for ${validatedConfig.symbol} from ${new Date(validatedConfig.startDate).toISOString()} to ${new Date(validatedConfig.endDate).toISOString()}`
    );
  }

  log(`Loaded ${candles.length} candles`, Date.now());

  // Load funding rates for futures mode
  let fundingRateMap: Map<number, FundingRate> | null = null;
  let allFundingRates: FundingRate[] = [];
  let totalFundingIncome = 0;

  if (validatedConfig.mode === 'futures') {
    log(`Loading funding rates for ${validatedConfig.symbol}`, Date.now());
    allFundingRates = await getFundingRates(
      validatedConfig.exchange,
      validatedConfig.symbol,
      validatedConfig.startDate,
      validatedConfig.endDate
    );
    log(`Loaded ${allFundingRates.length} funding rates`, Date.now());

    // Build map for O(1) lookup by timestamp
    fundingRateMap = new Map();
    for (const fr of allFundingRates) {
      fundingRateMap.set(fr.timestamp, fr);
    }
  }

  // 3. Get trading fees (skip API call if skipFeeFetch is set)
  let feeRate = options.broker?.feeRate ?? 0.001; // Default 0.1% taker fee

  if (!options.skipFeeFetch) {
    log(`Fetching trading fees for ${validatedConfig.symbol}`, Date.now());
    const provider = getProvider(validatedConfig.exchange);
    try {
      const fees = await provider.fetchTradingFees(validatedConfig.symbol);
      // Use taker fee for market orders (default order type)
      feeRate = fees.taker;
      log(`Using exchange fee rate: ${(feeRate * 100).toFixed(3)}% (taker)`, Date.now());
    } catch {
      log(`Could not fetch fees, using default: ${(feeRate * 100).toFixed(3)}%`, Date.now());
    }
  }

  // 4. Initialize portfolio and broker with fetched fee rate
  const isPredictionMarket = ['polymarket', 'manifold'].includes(validatedConfig.exchange);

  const brokerConfig: BrokerConfig = {
    ...options.broker,
    feeRate,
    isPredictionMarket,
  };

  // Apply prediction market slippage defaults if no explicit slippage set
  if ((options.broker?.slippagePercent === undefined || options.broker?.slippagePercent === 0)
      && isPredictionMarket) {
    brokerConfig.slippagePercent = 1; // 1% default slippage for prediction markets (tight spreads on liquid CLOB)
  }

  const leverage = validatedConfig.leverage ?? 1;
  const portfolio = leverage > 1
    ? new LeveragedPortfolio(validatedConfig.initialCapital, validatedConfig.symbol, leverage, isPredictionMarket)
    : new Portfolio(validatedConfig.initialCapital, validatedConfig.symbol, isPredictionMarket);
  const broker = new Broker(portfolio, brokerConfig);

  log(`Using leverage: ${leverage}x`, Date.now());

  // 4. Track results
  const trades: Trade[] = [];
  const equityTimestamps: number[] = [];
  const equityValues: number[] = [];
  const filledOrders: Order[] = [];

  // Action queue for the strategy
  let pendingActions: PendingAction[] = [];

  // 5. Create strategy context factory
  const createContext = (currentIndex: number): StrategyContext => {
    const currentCandle = candles[currentIndex];
    const portfolioState = portfolio.getState();

    // Create context with lazy candles array getter
    const context: StrategyContext = {
      // Market data - candleView is memory efficient
      get candles(): Candle[] {
        // Only allocate array if explicitly accessed (legacy strategies)
        return candles.slice(0, currentIndex + 1);
      },
      candleView: new CandleViewImpl(candles, currentIndex),
      currentIndex,
      currentCandle,
      params,

      // Portfolio state (read-only)
      portfolio: portfolioState,
      balance: portfolioState.balance,
      equity: portfolioState.equity,
      longPosition: portfolioState.longPosition,
      shortPosition: portfolioState.shortPosition,

      // Funding rate data (futures mode)
      fundingRates: fundingRateMap ? allFundingRates : undefined,
      currentFundingRate: fundingRateMap ? (fundingRateMap.get(candles[currentIndex].timestamp) ?? null) : undefined,

      // Trading actions
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

      // Legacy actions (deprecated but supported for backwards compatibility)
      buy(amount: number): void {
        if (amount > 0) {
          pendingActions.push({ action: 'OPEN_LONG', amount });
        }
      },

      sell(amount: number): void {
        // Legacy sell closes long position
        if (amount > 0) {
          pendingActions.push({ action: 'CLOSE_LONG', amount });
        }
      },

      // Utilities
      log(message: string): void {
        log(`[Strategy] ${message}`, currentCandle.timestamp);
      },
    };

    return context;
  };

  // 6. Call strategy init
  if (strategy.init) {
    const initContext = createContext(0);
    strategy.init(initContext);
  }

  // 7. Main backtest loop
  const totalBars = candles.length;
  log(`Processing ${totalBars} bars`, Date.now());

  for (let i = 0; i < totalBars; i++) {
    const candle = candles[i];

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
    if (fundingRateMap && validatedConfig.mode === 'futures') {
      const fr = fundingRateMap.get(candle.timestamp);
      if (fr) {
        const longPos = portfolio.longPosition;
        const shortPos = portfolio.shortPosition;

        if (longPos) {
          // Long pays when rate positive, receives when negative
          const markPrice = fr.markPrice ?? candle.close;
          const payment = -longPos.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
        }

        if (shortPos) {
          // Short receives when rate positive, pays when negative
          const markPrice = fr.markPrice ?? candle.close;
          const payment = shortPos.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
        }
      }
    }

    // Reset pending actions for this bar
    pendingActions = [];

    // Create context and call strategy
    const context = createContext(i);
    strategy.onBar(context);

    // Process strategy actions
    for (const pendingAction of pendingActions) {
      const amount = pendingAction.amount === 'all'
        ? getPositionAmount(portfolio, pendingAction.action)
        : pendingAction.amount;

      if (amount > 0) {
        broker.createOrder(
          {
            symbol: validatedConfig.symbol,
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
    if (allFundingRates.length > 0) {
      for (const trade of newTrades) {
        const nearest = allFundingRates.reduce((prev, curr) =>
          Math.abs(curr.timestamp - trade.timestamp) < Math.abs(prev.timestamp - trade.timestamp) ? curr : prev
        );
        trade.fundingRate = nearest.fundingRate;
      }
    }

    trades.push(...newTrades);

    // Call onOrderFilled for each filled order
    if (strategy.onOrderFilled) {
      for (const order of processedOrders.filter((o) => o.status === 'filled')) {
        strategy.onOrderFilled(context, order);
      }
    }

    // Record equity point
    equityTimestamps.push(candle.timestamp);
    equityValues.push(portfolio.equity);

    // Report progress
    if (options.onProgress && i % 100 === 0) {
      options.onProgress({
        current: i + 1,
        total: totalBars,
        percent: ((i + 1) / totalBars) * 100,
      });
    }
  }

  // 8. Call strategy onEnd
  if (strategy.onEnd) {
    pendingActions = [];
    const endContext = createContext(totalBars - 1);
    strategy.onEnd(endContext);

    // Process any final actions
    for (const pendingAction of pendingActions) {
      const amount = pendingAction.amount === 'all'
        ? getPositionAmount(portfolio, pendingAction.action)
        : pendingAction.amount;

      if (amount > 0) {
        broker.createOrder(
          {
            symbol: validatedConfig.symbol,
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

    // Attach nearest funding rate to each final trade (futures mode only)
    if (allFundingRates.length > 0) {
      for (const trade of finalTrades) {
        const nearest = allFundingRates.reduce((prev, curr) =>
          Math.abs(curr.timestamp - trade.timestamp) < Math.abs(prev.timestamp - trade.timestamp) ? curr : prev
        );
        trade.fundingRate = nearest.fundingRate;
      }
    }

    trades.push(...finalTrades);
  }

  // 9. Generate equity curve with drawdown
  const equity = generateEquityCurve(
    equityTimestamps,
    equityValues,
    validatedConfig.initialCapital
  );

  // 10. Calculate metrics
  log(`Calculating metrics from ${trades.length} trades`, Date.now());
  const metrics = calculateMetrics(trades, equity, validatedConfig.initialCapital, validatedConfig.timeframe);
  const rollingMetrics = calculateRollingMetrics(trades, equity, validatedConfig.initialCapital);

  // Add funding income metrics for futures mode
  if (validatedConfig.mode === 'futures') {
    (metrics as Record<string, unknown>).totalFundingIncome = totalFundingIncome;
    (metrics as Record<string, unknown>).tradingPnl = metrics.totalReturn - totalFundingIncome;
  }

  // 11. Build result
  const result: BacktestResult = {
    id: validatedConfig.id,
    config: validatedConfig,
    trades,
    equity,
    metrics,
    rollingMetrics,
    createdAt: Date.now(),
  };

  // 12. Save to database
  if (options.saveResults) {
    log('Saving results to database', Date.now());
    await saveBacktestRun(result);
  }

  // 13. Save to filesystem (always, regardless of saveResults flag)
  try {
    const filepath = saveResultToFile(result);
    log(`Results saved to ${filepath}`, Date.now());
  } catch (err) {
    // Don't fail the backtest if file save fails
    console.error('Failed to save result to file:', err);
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

  // Determine if cache is sufficient:
  // - For prediction markets (polymarket, manifold), data only exists from market creation
  //   to present. The requested startDate/endDate may be outside this range.
  //   Accept cached data if it's recent (within 7 days of now).
  // - For regular exchanges, require full coverage of requested range.
  const isPredictionMarket = ['polymarket', 'manifold'].includes(exchange);
  const hasCachedData = cachedRange.start !== null && cachedRange.end !== null;
  const hasFullCoverage = hasCachedData &&
    cachedRange.start! <= startDate &&
    cachedRange.end! >= endDate;
  const hasSufficientPMCoverage = hasCachedData && isPredictionMarket &&
    cachedRange.end! >= Date.now() - 7 * 24 * 60 * 60 * 1000; // cached data is recent (within 7 days of now)

  if (hasFullCoverage) {
    console.log('Using cached candles');
    candles = await getCandles(exchange, symbol, timeframe, startDate, endDate);
  } else if (hasSufficientPMCoverage) {
    // PM markets: use cached data even if requested range extends beyond available data
    console.log(`Using cached candles (PM market, data from ${new Date(cachedRange.start!).toISOString().slice(0, 10)})`);
    candles = await getCandles(exchange, symbol, timeframe, cachedRange.start!, Math.min(endDate, Date.now()));
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

  // Apply forward-fill for prediction market exchanges
  if (['polymarket', 'manifold'].includes(exchange)) {
    candles = forwardFillCandles(candles, timeframe);
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
