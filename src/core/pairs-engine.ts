/**
 * Pairs Trading Backtest Engine
 * Manages backtesting for pairs trading strategies with two symbols
 */

import { v4 as uuidv4 } from 'uuid';
import type { Candle, Trade, Timeframe, PairsBacktestConfig, PairsBacktestResult, SpreadDataPoint } from './types.js';
import { timeframeToMs } from './types.js';
import { PairsPortfolio } from './pairs-portfolio.js';
import type { PairsStrategy, PairsStrategyContext } from '../strategy/pairs-base.js';
import { validateStrategyParams, type CandleView } from '../strategy/base.js';
import { calculateMetrics, generateEquityCurve, calculateRollingMetrics } from '../analysis/metrics.js';
import { getProvider } from '../data/providers/index.js';
import { getCandles, saveCandles, getCandleDateRange, saveBacktestRun } from '../data/db.js';
import type { EngineConfig } from './engine.js';
import { loadStrategy } from '../strategy/loader.js';
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
  type: 'openLongA' | 'closeLongA' | 'openShortA' | 'closeShortA' | 'openLongB' | 'closeLongB' | 'openShortB' | 'closeShortB';
  amount?: number;
}

/**
 * Default engine configuration for pairs trading
 */
const DEFAULT_PAIRS_ENGINE_CONFIG: EngineConfig = {
  broker: {
    slippagePercent: 0,
    commissionPercent: 0,
    feeRate: 0,
  },
  saveResults: true,
  enableLogging: true,
};

/**
 * Apply slippage to a price based on trade direction
 */
function applySlippage(price: number, side: 'buy' | 'sell', slippagePct: number, isPredictionMarket: boolean = false): number {
  if (slippagePct === 0) return price;
  let slippedPrice = side === 'buy' ? price * (1 + slippagePct / 100) : price * (1 - slippagePct / 100);
  if (isPredictionMarket) {
    slippedPrice = Math.max(0.001, Math.min(0.999, slippedPrice));
  }
  return slippedPrice;
}

/**
 * Run a pairs trading backtest
 */
export async function runPairsBacktest(
  config: PairsBacktestConfig,
  engineConfig: EngineConfig = {}
): Promise<PairsBacktestResult> {
  // Merge with defaults
  const options = { ...DEFAULT_PAIRS_ENGINE_CONFIG, ...engineConfig };

  // Ensure we have an ID
  if (!config.id) {
    config.id = uuidv4();
  }

  // Log collection
  const log = (message: string): void => {
    if (options.enableLogging) {
      console.log(`[Pairs] ${message}`);
    }
  };

  log(`Starting pairs backtest: ${config.strategyName}`);

  // 1. Load strategy
  log(`Loading strategy: ${config.strategyName}`);
  const strategyModule = await loadStrategy(config.strategyName);

  // Check if it's a pairs strategy
  const strategy = strategyModule as unknown as PairsStrategy;
  if (!strategy.isPairs) {
    throw new Error(`Strategy "${config.strategyName}" is not a pairs strategy`);
  }

  // Validate and apply strategy parameters
  const params = validateStrategyParams(strategyModule, config.params);
  log(`Strategy params: ${JSON.stringify(params)}`);

  // 2. Fetch candles for both symbols
  log(`Fetching candles for ${config.symbolA} and ${config.symbolB}`);
  const [candlesA, candlesB] = await Promise.all([
    fetchOrLoadCandles(
      config.exchange,
      config.symbolA,
      config.timeframe,
      config.startDate,
      config.endDate
    ),
    fetchOrLoadCandles(
      config.exchange,
      config.symbolB,
      config.timeframe,
      config.startDate,
      config.endDate
    ),
  ]);

  if (candlesA.length === 0 || candlesB.length === 0) {
    throw new Error('No candles found for one or both symbols');
  }

  // 3. Align candles by timestamp (inner join)
  const alignedCandles = alignCandlesByTimestamp(candlesA, candlesB);
  if (alignedCandles.length === 0) {
    throw new Error('No overlapping timestamps between symbols');
  }

  log(`Aligned ${alignedCandles.length} candle pairs`);

  // 4. Get trading fees (use average of both symbols or skip)
  let feeRate = options.broker?.feeRate ?? 0.001;
  if (!options.skipFeeFetch) {
    log('Fetching trading fees');
    const provider = getProvider(config.exchange);
    try {
      const [feesA, feesB] = await Promise.all([
        provider.fetchTradingFees(config.symbolA),
        provider.fetchTradingFees(config.symbolB),
      ]);
      // Use average taker fee
      feeRate = (feesA.taker + feesB.taker) / 2;
      log(`Using average fee rate: ${(feeRate * 100).toFixed(3)}%`);
    } catch {
      log(`Could not fetch fees, using default: ${(feeRate * 100).toFixed(3)}%`);
    }
  }

  // 5. Initialize pairs portfolio with prediction market detection
  const leverage = config.leverage ?? 1;
  const isPredictionMarket = ['polymarket', 'manifold'].includes(config.exchange);

  // Prediction market slippage default
  // Check for both undefined and explicit 0 (default) to apply PM slippage
  const configuredSlippage = options.broker?.slippagePercent;
  const slippagePercent = (configuredSlippage === undefined || configuredSlippage === 0)
    ? (isPredictionMarket ? 1 : 0)
    : configuredSlippage;

  const portfolio = new PairsPortfolio(
    config.initialCapital,
    config.symbolA,
    config.symbolB,
    leverage,
    isPredictionMarket
  );

  log(`Using leverage: ${leverage}x`);
  if (slippagePercent > 0) {
    log(`Using slippage: ${slippagePercent}%`);
  }

  // 6. Track results
  const trades: Trade[] = [];
  const equityTimestamps: number[] = [];
  const equityValues: number[] = [];
  const spreadData: SpreadDataPoint[] = [];

  // Calculate spread statistics for z-score
  const spreads = alignedCandles.map(({ candleA, candleB }) => candleA.close - candleB.close);
  const spreadMean = spreads.reduce((sum, s) => sum + s, 0) / spreads.length;
  const spreadStd = Math.sqrt(
    spreads.reduce((sum, s) => sum + Math.pow(s - spreadMean, 2), 0) / spreads.length
  );

  // Action queue
  let pendingActions: PendingAction[] = [];

  // 7. Create strategy context factory
  const createContext = (currentIndex: number): PairsStrategyContext => {
    const { candleA, candleB } = alignedCandles[currentIndex];
    const portfolioState = portfolio.getState();

    // Unpack aligned candles
    const allCandlesA = alignedCandles.map(p => p.candleA);
    const allCandlesB = alignedCandles.map(p => p.candleB);

    const context: PairsStrategyContext = {
      symbolA: config.symbolA,
      symbolB: config.symbolB,
      candleA,
      candleB,
      candleViewA: new CandleViewImpl(allCandlesA, currentIndex),
      candleViewB: new CandleViewImpl(allCandlesB, currentIndex),
      currentIndex,
      params,
      balance: portfolioState.balance,
      equity: portfolioState.equity,
      longPositionA: portfolioState.longPositionA,
      shortPositionA: portfolioState.shortPositionA,
      longPositionB: portfolioState.longPositionB,
      shortPositionB: portfolioState.shortPositionB,
      leverage,

      openLongA(amount: number): void {
        if (amount > 0) pendingActions.push({ type: 'openLongA', amount });
      },
      closeLongA(amount?: number): void {
        pendingActions.push({ type: 'closeLongA', amount });
      },
      openShortA(amount: number): void {
        if (amount > 0) pendingActions.push({ type: 'openShortA', amount });
      },
      closeShortA(amount?: number): void {
        pendingActions.push({ type: 'closeShortA', amount });
      },
      openLongB(amount: number): void {
        if (amount > 0) pendingActions.push({ type: 'openLongB', amount });
      },
      closeLongB(amount?: number): void {
        pendingActions.push({ type: 'closeLongB', amount });
      },
      openShortB(amount: number): void {
        if (amount > 0) pendingActions.push({ type: 'openShortB', amount });
      },
      closeShortB(amount?: number): void {
        pendingActions.push({ type: 'closeShortB', amount });
      },

      log(message: string): void {
        log(`[Strategy] ${message}`);
      },
    };

    return context;
  };

  // 8. Call strategy init
  if (strategy.init) {
    const initContext = createContext(0);
    strategy.init(initContext);
  }

  // 9. Main backtest loop
  const totalBars = alignedCandles.length;
  log(`Processing ${totalBars} bars`);

  for (let i = 0; i < totalBars; i++) {
    const { candleA, candleB } = alignedCandles[i];

    // Update portfolio prices
    portfolio.updatePrices(candleA.close, candleB.close);

    // Reset pending actions
    pendingActions = [];

    // Create context and call strategy
    const context = createContext(i);
    strategy.onBar(context);

    // Process strategy actions
    for (const action of pendingActions) {
      try {
        let trade: Trade | undefined;
        let originalPrice: number;
        let slippedPrice: number;

        switch (action.type) {
          case 'openLongA':
            originalPrice = candleA.close;
            slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
            trade = portfolio.openLongA(action.amount!, slippedPrice, candleA.timestamp, feeRate);
            if (trade && slippedPrice !== originalPrice) {
              trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
            }
            break;
          case 'closeLongA': {
            const amount = action.amount ?? portfolio.longPositionA?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleA.close;
              slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
              trade = portfolio.closeLongA(amount === portfolio.longPositionA?.amount ? 'all' : amount, slippedPrice, candleA.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'openShortA':
            originalPrice = candleA.close;
            slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
            trade = portfolio.openShortA(action.amount!, slippedPrice, candleA.timestamp, feeRate);
            if (trade && slippedPrice !== originalPrice) {
              trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
            }
            break;
          case 'closeShortA': {
            const amount = action.amount ?? portfolio.shortPositionA?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleA.close;
              slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
              trade = portfolio.closeShortA(amount === portfolio.shortPositionA?.amount ? 'all' : amount, slippedPrice, candleA.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'openLongB':
            originalPrice = candleB.close;
            slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
            trade = portfolio.openLongB(action.amount!, slippedPrice, candleB.timestamp, feeRate);
            if (trade && slippedPrice !== originalPrice) {
              trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
            }
            break;
          case 'closeLongB': {
            const amount = action.amount ?? portfolio.longPositionB?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleB.close;
              slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
              trade = portfolio.closeLongB(amount === portfolio.longPositionB?.amount ? 'all' : amount, slippedPrice, candleB.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'openShortB':
            originalPrice = candleB.close;
            slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
            trade = portfolio.openShortB(action.amount!, slippedPrice, candleB.timestamp, feeRate);
            if (trade && slippedPrice !== originalPrice) {
              trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
            }
            break;
          case 'closeShortB': {
            const amount = action.amount ?? portfolio.shortPositionB?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleB.close;
              slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
              trade = portfolio.closeShortB(amount === portfolio.shortPositionB?.amount ? 'all' : amount, slippedPrice, candleB.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
        }

        if (trade) {
          trades.push(trade);
        }
      } catch (error) {
        if (error instanceof Error) {
          log(`Error processing action ${action.type}: ${error.message}`);
        }
      }
    }

    // Record equity point
    equityTimestamps.push(candleA.timestamp);
    equityValues.push(portfolio.equity);

    // Record spread data
    const spread = candleA.close - candleB.close;
    const zScore = spreadStd > 0 ? (spread - spreadMean) / spreadStd : 0;
    spreadData.push({
      timestamp: candleA.timestamp,
      spread,
      zScore,
    });

    // Report progress
    if (options.onProgress && i % 100 === 0) {
      options.onProgress({
        current: i + 1,
        total: totalBars,
        percent: ((i + 1) / totalBars) * 100,
      });
    }
  }

  // 10. Call strategy onEnd
  if (strategy.onEnd) {
    pendingActions = [];
    const endContext = createContext(totalBars - 1);
    strategy.onEnd(endContext);

    // Process any final actions
    const { candleA, candleB } = alignedCandles[totalBars - 1];
    for (const action of pendingActions) {
      try {
        let trade: Trade | undefined;
        let originalPrice: number;
        let slippedPrice: number;

        switch (action.type) {
          case 'closeLongA': {
            const amount = action.amount ?? portfolio.longPositionA?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleA.close;
              slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
              trade = portfolio.closeLongA('all', slippedPrice, candleA.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'closeShortA': {
            const amount = action.amount ?? portfolio.shortPositionA?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleA.close;
              slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
              trade = portfolio.closeShortA('all', slippedPrice, candleA.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'closeLongB': {
            const amount = action.amount ?? portfolio.longPositionB?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleB.close;
              slippedPrice = applySlippage(originalPrice, 'sell', slippagePercent, isPredictionMarket);
              trade = portfolio.closeLongB('all', slippedPrice, candleB.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
          case 'closeShortB': {
            const amount = action.amount ?? portfolio.shortPositionB?.amount ?? 0;
            if (amount > 0) {
              originalPrice = candleB.close;
              slippedPrice = applySlippage(originalPrice, 'buy', slippagePercent, isPredictionMarket);
              trade = portfolio.closeShortB('all', slippedPrice, candleB.timestamp, feeRate);
              if (trade && slippedPrice !== originalPrice) {
                trade.slippage = Math.abs(slippedPrice - originalPrice) * trade.amount;
              }
            }
            break;
          }
        }

        if (trade) {
          trades.push(trade);
        }
      } catch (error) {
        if (error instanceof Error) {
          log(`Error processing final action ${action.type}: ${error.message}`);
        }
      }
    }
  }

  // 11. Generate equity curve
  const equity = generateEquityCurve(
    equityTimestamps,
    equityValues,
    config.initialCapital
  );

  // 12. Calculate metrics
  log(`Calculating metrics from ${trades.length} trades`);
  const metrics = calculateMetrics(trades, equity, config.initialCapital, config.timeframe);
  const rollingMetrics = calculateRollingMetrics(trades, equity, config.initialCapital);

  // 13. Build result
  const result: PairsBacktestResult = {
    id: config.id,
    config,
    trades,
    equity,
    metrics,
    rollingMetrics,
    candlesA: alignedCandles.map(p => p.candleA),
    candlesB: alignedCandles.map(p => p.candleB),
    spreadData,
    createdAt: Date.now(),
  };

  log(`Backtest complete. Total return: ${metrics.totalReturnPercent.toFixed(2)}%`);

  // Save to database (preserve pairs config with symbolA/symbolB)
  if (options.saveResults) {
    log('Saving pairs results to database');
    // Save with original pairs config, adding 'symbol' for summary display
    const saveConfig = {
      ...config,
      symbol: `${config.symbolA} / ${config.symbolB}`,
    };
    saveBacktestRun({
      id: result.id,
      config: saveConfig as any,
      trades: result.trades,
      equity: result.equity,
      metrics: result.metrics,
      rollingMetrics: result.rollingMetrics,
      createdAt: result.createdAt,
    });
  }

  // Save to filesystem (always, regardless of saveResults flag)
  try {
    const filepath = saveResultToFile(result);
    log(`Results saved to ${filepath}`);
  } catch (err) {
    console.error('Failed to save result to file:', err);
  }

  return result;
}

/**
 * Align candles from two symbols by timestamp (inner join)
 */
function alignCandlesByTimestamp(
  candlesA: Candle[],
  candlesB: Candle[]
): Array<{ candleA: Candle; candleB: Candle }> {
  const mapB = new Map<number, Candle>();
  for (const candle of candlesB) {
    mapB.set(candle.timestamp, candle);
  }

  const aligned: Array<{ candleA: Candle; candleB: Candle }> = [];
  for (const candleA of candlesA) {
    const candleB = mapB.get(candleA.timestamp);
    if (candleB) {
      aligned.push({ candleA, candleB });
    }
  }

  return aligned;
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
  const cachedRange = getCandleDateRange(exchange, symbol, timeframe);

  // If we have complete coverage, use cache
  if (
    cachedRange.start !== null &&
    cachedRange.end !== null &&
    cachedRange.start <= startDate &&
    cachedRange.end >= endDate
  ) {
    console.log(`Using cached candles for ${symbol}`);
    candles = getCandles(exchange, symbol, timeframe, startDate, endDate);
  } else {
    // Fetch from exchange
    console.log(`Fetching candles from exchange for ${symbol}...`);
    const provider = getProvider(exchange);
    candles = await provider.fetchCandles(
      symbol,
      timeframe,
      new Date(startDate),
      new Date(endDate)
    );

    // Cache the fetched candles
    if (candles.length > 0) {
      console.log(`Caching ${candles.length} candles for ${symbol}`);
      saveCandles(candles, exchange, symbol, timeframe);
    }
  }

  // Apply forward-fill for prediction market exchanges
  if (['polymarket', 'manifold'].includes(exchange)) {
    candles = forwardFillCandles(candles, timeframe);
  }

  return candles;
}
