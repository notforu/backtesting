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
} from './types.js';
import { BacktestConfigSchema } from './types.js';
import { Portfolio } from './portfolio.js';
import { Broker, type BrokerConfig } from './broker.js';
import { loadStrategy } from '../strategy/loader.js';
import { validateStrategyParams, type StrategyContext, type LogEntry, type CandleView } from '../strategy/base.js';
import { calculateMetrics, generateEquityCurve } from '../analysis/metrics.js';
import { getProvider } from '../data/providers/index.js';
import { getCandles, saveCandles, saveBacktestRun, getCandleDateRange } from '../data/db.js';

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
    slippagePercent: 0.05,
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
  const brokerConfig: BrokerConfig = {
    ...options.broker,
    feeRate,
  };
  const portfolio = new Portfolio(validatedConfig.initialCapital, validatedConfig.symbol);
  const broker = new Broker(portfolio, brokerConfig);

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
  const metrics = calculateMetrics(trades, equity, validatedConfig.initialCapital);

  // 11. Build result
  const result: BacktestResult = {
    id: validatedConfig.id,
    config: validatedConfig,
    trades,
    equity,
    metrics,
    createdAt: Date.now(),
  };

  // 12. Save to database
  if (options.saveResults) {
    log('Saving results to database', Date.now());
    saveBacktestRun(result);
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
  // Check what we have in cache
  const cachedRange = getCandleDateRange(exchange, symbol, timeframe);

  // If we have complete coverage, use cache
  if (
    cachedRange.start !== null &&
    cachedRange.end !== null &&
    cachedRange.start <= startDate &&
    cachedRange.end >= endDate
  ) {
    console.log('Using cached candles');
    return getCandles(exchange, symbol, timeframe, startDate, endDate);
  }

  // Fetch from exchange
  console.log('Fetching candles from exchange...');
  const provider = getProvider(exchange);
  const candles = await provider.fetchCandles(
    symbol,
    timeframe,
    new Date(startDate),
    new Date(endDate)
  );

  // Cache the fetched candles
  if (candles.length > 0) {
    console.log(`Caching ${candles.length} candles`);
    saveCandles(candles, exchange, symbol, timeframe);
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
