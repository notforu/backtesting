/**
 * Aggregate Backtesting Engine
 * Runs multiple sub-strategies with shared capital and signal-based allocation
 */

import { v4 as uuidv4 } from 'uuid';
import type { Candle, Trade, FundingRate, Timeframe, EquityPoint } from './types.js';
import type { AggregateBacktestConfig, AggregateBacktestResult, PerAssetResult, Signal, SubStrategyConfig } from './signal-types.js';
import { SignalAdapter } from './signal-adapter.js';
import { MultiSymbolPortfolio } from './multi-portfolio.js';
import { loadStrategy } from '../strategy/loader.js';
import { getCandles, getFundingRates, saveBacktestRun } from '../data/db.js';
import { calculateMetrics, generateEquityCurve, calculateRollingMetrics } from '../analysis/metrics.js';
import { DEFAULT_BYBIT_TAKER_FEE_RATE } from './constants.js';
import { validateFundingRateCoverage, validateCandleCoverage } from './funding-rate-validation.js';

interface AdapterWithData {
  adapter: SignalAdapter;
  config: SubStrategyConfig;
  candles: Candle[];
  fundingRates: FundingRate[];
  /** Map from candle timestamp to candle index for O(1) lookup */
  timestampToIndex: Map<number, number>;
  /** Accumulated funding income for the currently open position */
  accumulatedFunding: number;
}

export interface AggregateEngineConfig {
  saveResults?: boolean;
  enableLogging?: boolean;
  /** Override fee rate (default 0.00055 for Bybit taker) */
  feeRate?: number;
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  /**
   * Skip funding rate coverage validation per sub-strategy.
   * Use when running tests or scripts that operate on synthetic or partial data.
   * Defaults to false (validation is enforced).
   */
  skipFundingRateValidation?: boolean;
  /**
   * Skip candle coverage validation per sub-strategy.
   * Use when running tests or scripts that operate on synthetic or partial data.
   * Defaults to false (validation is enforced).
   */
  skipCandleValidation?: boolean;
  /**
   * Fraction of initialCapital to use per position in top_n and single_strongest modes.
   * For top_n: each position gets (initialCapital * positionSizeFraction) / maxPositions.
   * For single_strongest: all-in fraction is positionSizeFraction of available cash.
   * For weighted_multi: fraction applied to cash snapshot before weight-proportional split.
   * Defaults to 0.9 (90%).
   */
  positionSizeFraction?: number;
}

/**
 * Run an aggregate backtest with signal-based allocation across multiple sub-strategies
 */
export async function runAggregateBacktest(
  config: AggregateBacktestConfig,
  engineConfig: AggregateEngineConfig = {},
): Promise<AggregateBacktestResult> {
  const { subStrategies, allocationMode, maxPositions, initialCapital, exchange } = config;
  const positionSizeFraction = engineConfig.positionSizeFraction ?? 0.9;
  // Defensively convert string dates to timestamps
  const startDate = typeof config.startDate === 'string' ? new Date(config.startDate).getTime() : config.startDate;
  const endDate = typeof config.endDate === 'string' ? new Date(config.endDate).getTime() : config.endDate;
  // engineConfig.feeRate takes priority; fall back to config.feeRate, then Bybit default
  const feeRate = engineConfig.feeRate ?? config.feeRate ?? DEFAULT_BYBIT_TAKER_FEE_RATE;
  const slippagePercent = config.slippagePercent ?? 0;
  const saveResults = engineConfig.saveResults ?? true;

  const log = (msg: string): void => {
    if (engineConfig.enableLogging) console.log(`[AggregateEngine] ${msg}`);
  };

  /**
   * Apply slippage to a fill price. Buys get a higher price, sells get lower.
   * slippagePercent is a percentage (e.g. 0.1 for 0.1%).
   */
  function applySlippage(price: number, side: 'buy' | 'sell'): number {
    if (slippagePercent === 0) return price;
    return side === 'buy'
      ? price * (1 + slippagePercent / 100)
      : price * (1 - slippagePercent / 100);
  }

  log(`Starting aggregate backtest: ${subStrategies.length} sub-strategies, mode=${allocationMode}`);

  // Load BTC daily candles for V3 regime filter (loaded once, shared across all V3 sub-strategies)
  let btcDailyCandles: Array<{ timestamp: number; close: number }> | null = null;

  async function loadBtcDailyCandles(): Promise<Array<{ timestamp: number; close: number }>> {
    if (btcDailyCandles !== null) return btcDailyCandles;

    // Try multiple exchange/symbol combos
    const candidates: Array<[string, string]> = [
      ['binance', 'BTC/USDT:USDT'],
      ['binance', 'BTC/USDT'],
      ['bybit', 'BTC/USDT:USDT'],
      ['bybit', 'BTC/USDT'],
    ];

    for (const [ex, sym] of candidates) {
      const candles = await getCandles(ex, sym, '1d', startDate - 300 * 24 * 60 * 60 * 1000, endDate);
      if (candles.length >= 200) {
        btcDailyCandles = candles.map(c => ({ timestamp: c.timestamp, close: c.close }));
        log(`Loaded ${btcDailyCandles.length} BTC daily candles for regime filter (${ex} ${sym})`);
        return btcDailyCandles;
      }
    }

    const isV3 = subStrategies.some(
      s => s.strategyName.includes('v3') || s.strategyName.includes('V3'),
    );
    if (isV3) {
      throw new Error(
        `Could not load BTC daily candles required for V3 regime filter. ` +
        `Cache BTC/USDT daily candles first using: ` +
        `npx tsx scripts/cache-candles.ts --exchange=binance --symbols=BTC/USDT --timeframes=1d --from=YYYY-MM-DD --to=YYYY-MM-DD`,
      );
    }
    btcDailyCandles = [];
    return btcDailyCandles;
  }

  // 1. Load strategies and create adapters
  const adaptersWithData: AdapterWithData[] = [];

  for (const subConfig of subStrategies) {
    const strategy = await loadStrategy(subConfig.strategyName);

    // Inject BTC daily candles for V3 regime filter
    if (strategy.name.includes('v3') || strategy.name.includes('V3') ||
        (subConfig.params?.useRegimeFilter === true)) {
      const btcCandles = await loadBtcDailyCandles();
      if (btcCandles.length > 0) {
        (strategy as any)._btcDailyCandles = btcCandles;
      }
    }

    const adapter = new SignalAdapter(strategy, subConfig.symbol, subConfig.timeframe, subConfig.params);

    // Load candles from DB
    const candles = await getCandles(
      subConfig.exchange || exchange,
      subConfig.symbol,
      subConfig.timeframe,
      startDate,
      endDate,
    );

    if (candles.length === 0) {
      throw new Error(
        `No candle data for ${subConfig.symbol} (${subConfig.timeframe}) on ${subConfig.exchange || exchange}. ` +
        `Cache candles first using: npx tsx scripts/cache-candles.ts --exchange=${subConfig.exchange || exchange} --symbols=${subConfig.symbol} --timeframes=${subConfig.timeframe} --from=YYYY-MM-DD --to=YYYY-MM-DD`,
      );
    }

    // Validate that we have sufficient candle coverage for the date range
    validateCandleCoverage(
      candles.length,
      subConfig.symbol,
      subConfig.exchange || exchange,
      subConfig.timeframe,
      startDate,
      endDate,
      engineConfig.skipCandleValidation,
    );

    // Load funding rates for futures mode
    let fundingRates: FundingRate[] = [];
    if (config.mode === 'futures') {
      fundingRates = await getFundingRates(
        subConfig.exchange || exchange,
        subConfig.symbol,
        startDate,
        endDate,
      );

      // Validate that we have sufficient funding rate coverage (throws if < 80%)
      validateFundingRateCoverage(
        fundingRates,
        subConfig.symbol,
        subConfig.exchange || exchange,
        startDate,
        endDate,
        engineConfig.skipFundingRateValidation,
      );
    }

    // Initialize adapter with candles and funding rates
    adapter.init(candles, fundingRates);

    // Build timestamp -> index map for O(1) candle lookups
    const timestampToIndex = new Map<number, number>();
    candles.forEach((c, i) => timestampToIndex.set(c.timestamp, i));

    adaptersWithData.push({
      adapter,
      config: subConfig,
      candles,
      fundingRates,
      timestampToIndex,
      accumulatedFunding: 0,
    });

    log(`Loaded ${subConfig.symbol}@${subConfig.timeframe}: ${candles.length} candles, ${fundingRates.length} FR`);
  }

  if (adaptersWithData.length === 0) {
    throw new Error('No valid sub-strategies loaded (all had empty candle data)');
  }

  // 2. Build unified timeline: union of all candle timestamps, sorted ascending
  const allTimestamps = new Set<number>();
  for (const awd of adaptersWithData) {
    for (const candle of awd.candles) {
      allTimestamps.add(candle.timestamp);
    }
  }
  const timeline = Array.from(allTimestamps).sort((a, b) => a - b);
  log(`Unified timeline: ${timeline.length} points`);

  // 3. Initialize shared portfolio
  const portfolio = new MultiSymbolPortfolio(initialCapital);
  const signalHistory: Signal[] = [];
  const allTrades: Trade[] = [];
  const equityTimestamps: number[] = [];
  const equityValues: number[] = [];

  // Per-asset trade tracking
  const perAssetTrades = new Map<string, Trade[]>();
  for (const awd of adaptersWithData) {
    perAssetTrades.set(awd.config.symbol, []);
  }

  // Build funding rate maps per symbol for O(1) lookup by timestamp
  const frMaps = new Map<string, Map<number, FundingRate>>();
  for (const awd of adaptersWithData) {
    const frMap = new Map<number, FundingRate>();
    for (const fr of awd.fundingRates) {
      frMap.set(fr.timestamp, fr);
    }
    frMaps.set(awd.config.symbol, frMap);
  }

  // Track total and per-symbol funding income
  let totalFundingIncome = 0;
  const perSymbolFunding = new Map<string, number>();

  // Track the capital allocated to each symbol (used as the per-asset equity base).
  // Populated when each trade is first opened so the base matches the actual allocation.
  const perSymbolAllocatedCapital = new Map<string, number>();

  // 4. Main loop over unified timeline
  for (let ti = 0; ti < timeline.length; ti++) {
    const timestamp = timeline[ti];

    // 4a. Update prices for all symbols that have a candle at this timestamp
    for (const awd of adaptersWithData) {
      const idx = awd.timestampToIndex.get(timestamp);
      if (idx !== undefined) {
        portfolio.updatePrice(awd.config.symbol, awd.candles[idx].close);
      }
    }

    // 4b. Process funding payments (futures mode only)
    if (config.mode === 'futures') {
      for (const awd of adaptersWithData) {
        const frMap = frMaps.get(awd.config.symbol);
        const fr = frMap?.get(timestamp);
        if (!fr) continue;

        const positions = portfolio.getPositionForSymbol(awd.config.symbol);

        // Determine mark price: use FR mark price if available, otherwise use candle close
        const candleIdx = awd.timestampToIndex.get(timestamp);
        const markPrice = fr.markPrice ?? (candleIdx !== undefined ? awd.candles[candleIdx].close : 0);
        if (markPrice === 0) continue;

        if (positions.longPosition) {
          // Long pays when funding rate is positive, receives when negative
          const payment = -positions.longPosition.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
          perSymbolFunding.set(awd.config.symbol, (perSymbolFunding.get(awd.config.symbol) ?? 0) + payment);
          awd.accumulatedFunding += payment;
        }

        if (positions.shortPosition) {
          // Short receives when funding rate is positive, pays when negative
          const payment = positions.shortPosition.amount * markPrice * fr.fundingRate;
          portfolio.applyFundingPayment(payment);
          totalFundingIncome += payment;
          perSymbolFunding.set(awd.config.symbol, (perSymbolFunding.get(awd.config.symbol) ?? 0) + payment);
          awd.accumulatedFunding += payment;
        }
      }
    }

    // 4c. Check exits first - for adapters that have a position and data at this bar
    for (const awd of adaptersWithData) {
      const idx = awd.timestampToIndex.get(timestamp);
      if (idx === undefined) continue;
      if (!awd.adapter.isInPosition()) continue;

      const positions = portfolio.getPositionForSymbol(awd.config.symbol);
      const hasRealPosition = positions.longPosition !== null || positions.shortPosition !== null;
      if (!hasRealPosition) continue;

      if (awd.adapter.wantsExit(idx)) {
        const candle = awd.candles[idx];

        if (positions.longPosition) {
          // Long exit is a sell — slippage reduces the fill price
          const exitPrice = applySlippage(candle.close, 'sell');
          const trade = portfolio.closeLong(awd.config.symbol, 'all', exitPrice, timestamp, feeRate);
          if (awd.accumulatedFunding !== 0) {
            trade.fundingIncome = awd.accumulatedFunding;
            awd.accumulatedFunding = 0;
          }
          allTrades.push(trade);
          perAssetTrades.get(awd.config.symbol)?.push(trade);
        }

        if (positions.shortPosition) {
          // Short exit is a buy — slippage increases the fill price
          const exitPrice = applySlippage(candle.close, 'buy');
          const trade = portfolio.closeShort(awd.config.symbol, 'all', exitPrice, timestamp, feeRate);
          if (awd.accumulatedFunding !== 0) {
            trade.fundingIncome = awd.accumulatedFunding;
            awd.accumulatedFunding = 0;
          }
          allTrades.push(trade);
          perAssetTrades.get(awd.config.symbol)?.push(trade);
        }

        awd.adapter.confirmExit();
      }
    }

    // 4d. Collect entry signals from adapters that have data at this timestamp and are not in position
    const signals: Array<{ signal: Signal; awd: AdapterWithData; barIndex: number }> = [];

    for (const awd of adaptersWithData) {
      const idx = awd.timestampToIndex.get(timestamp);
      if (idx === undefined) continue;
      if (awd.adapter.isInPosition()) continue;

      const signal = awd.adapter.getSignal(idx);
      if (signal && signal.direction !== 'flat') {
        signals.push({ signal, awd, barIndex: idx });
      }
    }

    // 4e. Select signals to execute based on allocation mode
    const currentPositionCount = portfolio.getPositionCount();
    let selectedSignals: Array<{ signal: Signal; awd: AdapterWithData; barIndex: number }> = [];

    if (signals.length > 0) {
      // Sort by weight descending so strongest signals are first
      signals.sort((a, b) => b.signal.weight - a.signal.weight);

      switch (allocationMode) {
        case 'single_strongest': {
          // Only trade if no positions are currently open
          if (currentPositionCount === 0) {
            selectedSignals = [signals[0]];
          }
          break;
        }
        case 'top_n': {
          const availableSlots = Math.max(0, maxPositions - currentPositionCount);
          selectedSignals = signals.slice(0, availableSlots);
          break;
        }
        case 'weighted_multi': {
          // Accept up to maxPositions signals, capital split proportional to weight
          const availableSlots = Math.max(0, maxPositions - currentPositionCount);
          selectedSignals = signals.slice(0, availableSlots);
          break;
        }
        default:
          throw new Error(`Unknown allocation mode: "${allocationMode}"`);
      }
    }

    // 4f. Execute selected signals against the shared portfolio
    // Snapshot cash BEFORE the loop so all allocations use the same base capital
    const cashSnapshot = portfolio.cash;
    const totalWeightSnapshot = selectedSignals.reduce((sum, s) => sum + s.signal.weight, 0);

    for (const { signal, awd, barIndex } of selectedSignals) {
      const candle = awd.candles[barIndex];
      // Long entry is a buy (slippage increases price), short entry is a sell (slippage decreases price)
      const entryPrice = signal.direction === 'long'
        ? applySlippage(candle.close, 'buy')
        : applySlippage(candle.close, 'sell');

      // Calculate how much capital to allocate to this trade
      let capitalForTrade: number;

      if (allocationMode === 'weighted_multi' && selectedSignals.length > 1) {
        // Proportional to signal weight, calculated from pre-loop cash snapshot
        // Fall back to equal split if total weight is zero (avoids NaN from division by zero)
        capitalForTrade = totalWeightSnapshot > 0
          ? (signal.weight / totalWeightSnapshot) * cashSnapshot * positionSizeFraction
          : (cashSnapshot * positionSizeFraction) / selectedSignals.length;
      } else if (allocationMode === 'top_n') {
        // Each position gets an equal fixed share of initial capital, regardless of when it opens.
        // Using initialCapital / maxPositions ensures symmetry even when positions open on different bars.
        capitalForTrade = (initialCapital * positionSizeFraction) / maxPositions;
      } else {
        // single_strongest or single signal: use positionSizeFraction of available cash
        capitalForTrade = cashSnapshot * positionSizeFraction;
      }

      const amount = capitalForTrade / entryPrice;
      if (amount <= 0) continue;

      try {
        let trade: Trade;
        if (signal.direction === 'long') {
          trade = portfolio.openLong(awd.config.symbol, amount, entryPrice, timestamp, feeRate);
        } else {
          trade = portfolio.openShort(awd.config.symbol, amount, entryPrice, timestamp, feeRate);
        }

        // Record the capital allocated to this symbol for per-asset equity base calculation.
        // Only set on the FIRST trade so re-entries don't override the original allocation.
        if (!perSymbolAllocatedCapital.has(awd.config.symbol)) {
          perSymbolAllocatedCapital.set(awd.config.symbol, capitalForTrade);
        }

        // Attach the nearest funding rate to the open trade (futures mode)
        if (awd.fundingRates.length > 0) {
          const nearestFR = awd.fundingRates.reduce((prev, curr) =>
            Math.abs(curr.timestamp - timestamp) < Math.abs(prev.timestamp - timestamp) ? curr : prev,
          );
          if (nearestFR) trade.fundingRate = nearestFR.fundingRate;
        }

        allTrades.push(trade);
        perAssetTrades.get(awd.config.symbol)?.push(trade);

        // Confirm execution in adapter so its shadow state stays in sync
        awd.adapter.confirmExecutionAtBar(signal.direction, barIndex);
        awd.accumulatedFunding = 0; // Reset accumulator for this new position

        signalHistory.push(signal);
      } catch (err) {
        // Insufficient funds or invalid state - skip this signal
        log(`Could not execute signal for ${signal.symbol}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    // 4g. Record equity snapshot for this timestamp
    equityTimestamps.push(timestamp);
    equityValues.push(portfolio.equity);

    // Report progress periodically
    if (engineConfig.onProgress && ti % 100 === 0) {
      engineConfig.onProgress({
        current: ti + 1,
        total: timeline.length,
        percent: ((ti + 1) / timeline.length) * 100,
      });
    }
  }

  // 5. Close any positions that remain open at end of backtest
  for (const awd of adaptersWithData) {
    const positions = portfolio.getPositionForSymbol(awd.config.symbol);
    if (positions.longPosition === null && positions.shortPosition === null) continue;

    const lastCandle = awd.candles[awd.candles.length - 1];

    if (positions.longPosition) {
      // Force-close long is a sell — slippage reduces the fill price
      const exitPrice = applySlippage(lastCandle.close, 'sell');
      const trade = portfolio.closeLong(awd.config.symbol, 'all', exitPrice, lastCandle.timestamp, feeRate);
      if (awd.accumulatedFunding !== 0) {
        trade.fundingIncome = awd.accumulatedFunding;
        awd.accumulatedFunding = 0;
      }
      allTrades.push(trade);
      perAssetTrades.get(awd.config.symbol)?.push(trade);
    }

    if (positions.shortPosition) {
      // Force-close short is a buy — slippage increases the fill price
      const exitPrice = applySlippage(lastCandle.close, 'buy');
      const trade = portfolio.closeShort(awd.config.symbol, 'all', exitPrice, lastCandle.timestamp, feeRate);
      if (awd.accumulatedFunding !== 0) {
        trade.fundingIncome = awd.accumulatedFunding;
        awd.accumulatedFunding = 0;
      }
      allTrades.push(trade);
      perAssetTrades.get(awd.config.symbol)?.push(trade);
    }
  }

  // Sort all trades by timestamp so metrics calculations are correct
  allTrades.sort((a, b) => a.timestamp - b.timestamp);

  // 6. Generate equity curve with drawdown annotations
  const equity = generateEquityCurve(equityTimestamps, equityValues, initialCapital);

  // 7. Determine dominant timeframe (most frequently used across sub-strategies)
  const tfCounts: Record<string, number> = {};
  for (const sub of subStrategies) {
    tfCounts[sub.timeframe] = (tfCounts[sub.timeframe] ?? 0) + 1;
  }
  const dominantTimeframe = Object.entries(tfCounts).sort((a, b) => b[1] - a[1])[0][0] as Timeframe;

  // 8. Calculate portfolio-level metrics
  const metrics = calculateMetrics(allTrades, equity, initialCapital, dominantTimeframe);
  const rollingMetrics = calculateRollingMetrics(allTrades, equity, initialCapital);

  if (config.mode === 'futures') {
    (metrics as Record<string, unknown>).totalFundingIncome = totalFundingIncome;
    (metrics as Record<string, unknown>).tradingPnl = metrics.totalReturn - totalFundingIncome;
  }

  // 9. Build per-asset results
  const perAssetResults: Record<string, PerAssetResult> = {};

  for (const awd of adaptersWithData) {
    const symbol = awd.config.symbol;
    const trades = perAssetTrades.get(symbol) ?? [];

    // Build a dense bar-by-bar equity curve for this asset.
    // Iterating candle-by-candle (instead of trade-by-trade) gives a continuous
    // equity series so that max drawdown and Sharpe are computed correctly.
    //
    // BUG 6 FIX: Use the actual capital allocated to this asset, not the full portfolio
    // capital. This prevents per-asset drawdown from being artificially small (e.g.
    // showing 15% drawdown when the asset lost 100% of its allocated capital).
    //
    // Priority: use tracked allocation from signal execution; fall back to
    // a proportional share of initial capital if the symbol had no trades.
    const fallbackPerAssetCapital = initialCapital / adaptersWithData.length;
    const perAssetCapital = perSymbolAllocatedCapital.get(symbol) ?? fallbackPerAssetCapital;

    const assetEquityTimestamps: number[] = [];
    const assetEquityValues: number[] = [];
    let realizedEquity = perAssetCapital;
    let currentPosition: { direction: 'long' | 'short'; entryPrice: number; amount: number } | null = null;
    let tradeIdx = 0;

    for (const candle of awd.candles) {
      // Apply all trades that occurred at this candle's timestamp before marking to market
      while (tradeIdx < trades.length && trades[tradeIdx].timestamp <= candle.timestamp) {
        const trade = trades[tradeIdx];
        if (trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT') {
          currentPosition = {
            direction: trade.action === 'OPEN_LONG' ? 'long' : 'short',
            entryPrice: trade.price,
            amount: trade.amount,
          };
          // BUG 7 FIX: Deduct the entry fee immediately when the position is opened.
          // Previously, only close trades updated realizedEquity, so the entry fee
          // was never reflected in the per-asset equity curve.
          realizedEquity -= (trade.fee ?? 0);
        } else {
          // Close trade — realize price PnL and funding income earned during the position
          if (trade.pnl !== undefined) {
            realizedEquity += trade.pnl;
          }
          if (trade.fundingIncome) {
            realizedEquity += trade.fundingIncome;
          }
          currentPosition = null;
        }
        tradeIdx++;
      }

      // Mark-to-market equity at this bar
      let equity: number;
      if (currentPosition) {
        const unrealizedPnl =
          currentPosition.direction === 'long'
            ? (candle.close - currentPosition.entryPrice) * currentPosition.amount
            : (currentPosition.entryPrice - candle.close) * currentPosition.amount;
        equity = realizedEquity + unrealizedPnl;
      } else {
        equity = realizedEquity;
      }

      assetEquityTimestamps.push(candle.timestamp);
      assetEquityValues.push(equity);
    }

    const assetEquity: EquityPoint[] = assetEquityTimestamps.length > 0
      ? generateEquityCurve(assetEquityTimestamps, assetEquityValues, perAssetCapital)
      : [];

    const assetMetrics = calculateMetrics(trades, assetEquity, perAssetCapital, awd.config.timeframe);
    const assetRolling = trades.length > 0
      ? calculateRollingMetrics(trades, assetEquity, perAssetCapital)
      : undefined;

    const symbolFunding = perSymbolFunding.get(symbol) ?? 0;
    const tradingPnl = assetMetrics.totalReturn - symbolFunding;

    perAssetResults[symbol] = {
      symbol,
      timeframe: awd.config.timeframe,
      trades,
      equity: assetEquity,
      metrics: {
        ...assetMetrics,
        totalFundingIncome: symbolFunding,
        tradingPnl,
      },
      rollingMetrics: assetRolling,
      fundingIncome: symbolFunding,
      tradingPnl,
      ...(awd.adapter.indicators ? { indicators: awd.adapter.indicators } : {}),
    };
  }

  // 10. Assemble the final result object
  const id = uuidv4();
  const result: AggregateBacktestResult = {
    id,
    config: {
      id,
      strategyName: 'aggregation',
      symbol: 'MULTI',
      timeframe: dominantTimeframe,
      startDate,
      endDate,
      initialCapital,
      exchange,
      params: {
        allocationMode,
        maxPositions,
        subStrategies: subStrategies.map(s => {
          // Use resolved params (defaults merged with user overrides) from the adapter
          const awd = adaptersWithData.find(
            a => a.config.symbol === s.symbol && a.config.timeframe === s.timeframe && a.config.strategyName === s.strategyName
          );
          if (!awd) {
            throw new Error(
              `Adapter not found for sub-strategy "${s.strategyName}" / ${s.symbol} @ ${s.timeframe}. ` +
              `This should never happen — all sub-strategies should have a corresponding adapter.`,
            );
          }
          return {
            strategyName: s.strategyName,
            symbol: s.symbol,
            timeframe: s.timeframe,
            params: awd.adapter.params,
            exchange: s.exchange,
          };
        }),
        assets: subStrategies.map(s => `${s.symbol}@${s.timeframe}`).join(','),
        perAssetSummary: Object.values(perAssetResults).map(r => ({
          symbol: r.symbol,
          timeframe: r.timeframe,
          sharpe: r.metrics.sharpeRatio,
          returnPct: r.metrics.totalReturnPercent,
          trades: r.metrics.totalTrades,
          fundingIncome: r.fundingIncome,
          tradingPnl: r.tradingPnl,
        })),
      },
      mode: config.mode ?? 'spot',
    },
    trades: allTrades,
    equity,
    metrics,
    rollingMetrics,
    createdAt: Date.now(),
    perAssetResults,
    signalHistory,
  };

  // 11. Persist results
  if (saveResults) {
    try {
      await saveBacktestRun(result);
      log('Results saved to database');
    } catch (err) {
      log(`Failed to save to database: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  log(`Aggregate backtest complete. ${allTrades.length} trades, return: ${metrics.totalReturnPercent.toFixed(2)}%`);

  return result;
}
