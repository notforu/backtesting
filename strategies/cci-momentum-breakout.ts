import { CCI, SMA, ADX, ATR } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

interface IndicatorState {
  cciStream: InstanceType<typeof CCI>;
  smaStream: InstanceType<typeof SMA>;
  adxStream: InstanceType<typeof ADX>;
  atrStream: InstanceType<typeof ATR>;

  // Cached values for crossover detection (need current + previous)
  cciValues: number[];
  smaValues: number[];
  adxValues: number[];
  atrValues: number[];

  processedBars: number;
}

const cciMomentumBreakout: Strategy = {
  name: 'cci-momentum-breakout',
  description:
    'Momentum breakout strategy using CCI (Commodity Channel Index) for momentum acceleration detection with dual-threshold entries: +100/-100 breakouts and zero-line crossovers. Filtered by SMA trend direction and ADX trend strength. Uses ATR trailing stop.',
  version: '1.0.0',

  params: [
    {
      name: 'cciPeriod',
      label: 'CCI Period',
      type: 'number',
      default: 25,
      min: 10,
      max: 30,
      step: 5,
      description: 'CCI calculation period',
    },
    {
      name: 'cciBreakoutLevel',
      label: 'CCI Breakout Level',
      type: 'number',
      default: 120,
      min: 80,
      max: 120,
      step: 20,
      description: 'CCI level for momentum breakout entry (positive for longs, negative for shorts)',
    },
    {
      name: 'cciExitLevel',
      label: 'CCI Exit Level',
      type: 'number',
      default: 30,
      min: 30,
      max: 70,
      step: 20,
      description: 'CCI level for reversal exit (opposite sign from entry)',
    },
    {
      name: 'smaPeriod',
      label: 'SMA Period',
      type: 'number',
      default: 50,
      min: 30,
      max: 70,
      step: 10,
      description: 'SMA trend direction filter period',
    },
    {
      name: 'adxPeriod',
      label: 'ADX Period',
      type: 'number',
      default: 15,
      min: 10,
      max: 20,
      step: 5,
      description: 'ADX calculation period for trend strength',
    },
    {
      name: 'adxThreshold',
      label: 'ADX Threshold',
      type: 'number',
      default: 30,
      min: 15,
      max: 30,
      step: 5,
      description: 'Minimum ADX value for trend strength confirmation',
    },
    {
      name: 'atrPeriod',
      label: 'ATR Period',
      type: 'number',
      default: 10,
      min: 10,
      max: 20,
      step: 5,
      description: 'ATR period for trailing stop calculation',
    },
    {
      name: 'trailMultiplier',
      label: 'Trail Multiplier',
      type: 'number',
      default: 2.5,
      min: 1.5,
      max: 3.0,
      step: 0.5,
      description: 'ATR multiplier for trailing stop distance',
    },
    {
      name: 'maxHoldBars',
      label: 'Max Hold Bars',
      type: 'number',
      default: 40,
      min: 30,
      max: 70,
      step: 10,
      description: 'Maximum number of bars to hold a position',
    },
    {
      name: 'enableZeroCross',
      label: 'Enable Zero Cross',
      type: 'boolean',
      default: true,
      description: 'Enable zero-line crossover entries (Mode 2) in addition to breakout entries',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: true,
      description: 'Enable short positions on bearish CCI signals',
    },
  ],

  init(context: StrategyContext): void {
    const { params } = context;
    const cciPeriod = params.cciPeriod as number;
    const smaPeriod = params.smaPeriod as number;
    const adxPeriod = params.adxPeriod as number;
    const atrPeriod = params.atrPeriod as number;

    // Initialize streaming indicator instances
    const state: IndicatorState = {
      cciStream: new CCI({ period: cciPeriod, high: [], low: [], close: [] }),
      smaStream: new SMA({ period: smaPeriod, values: [] }),
      adxStream: new ADX({ period: adxPeriod, high: [], low: [], close: [] }),
      atrStream: new ATR({ period: atrPeriod, high: [], low: [], close: [] }),

      cciValues: [],
      smaValues: [],
      adxValues: [],
      atrValues: [],

      processedBars: 0,
    };

    (this as any)._state = state;
    (this as any)._entryBar = 0;
    (this as any)._trailingStop = 0;

    context.log(
      `Initialized CCI Momentum Breakout (streaming): CCI(${cciPeriod}), SMA(${smaPeriod}), ADX(${adxPeriod})>=${params.adxThreshold}, Trail=${params.trailMultiplier}x ATR, ZeroCross=${params.enableZeroCross}`
    );
  },

  onBar(context: StrategyContext): void {
    const {
      currentIndex,
      currentCandle,
      params,
      longPosition,
      shortPosition,
      balance,
    } = context;

    const state = (this as any)._state as IndicatorState;
    if (!state) return;

    // Extract parameters
    const cciBreakoutLevel = params.cciBreakoutLevel as number;
    const cciExitLevel = params.cciExitLevel as number;
    const adxThreshold = params.adxThreshold as number;
    const trailMultiplier = params.trailMultiplier as number;
    const maxHoldBars = params.maxHoldBars as number;
    const enableZeroCross = params.enableZeroCross as boolean;
    const enableShorts = params.enableShorts as boolean;

    const currentPrice = currentCandle.close;
    const high = currentCandle.high;
    const low = currentCandle.low;

    // --- Feed current candle to all streaming indicators (O(1) per indicator) ---

    // CCI - nextValue takes CandleData with high, low, close
    const cciVal = state.cciStream.nextValue({ high, low, close: currentPrice } as any);
    if (cciVal !== undefined) {
      state.cciValues.push(cciVal);
    }

    // SMA
    const smaVal = state.smaStream.nextValue(currentPrice);
    if (smaVal !== undefined) {
      state.smaValues.push(smaVal);
    }

    // ADX
    const adxVal = state.adxStream.nextValue({ high, low, close: currentPrice });
    if (adxVal && adxVal.adx !== undefined) {
      state.adxValues.push(adxVal.adx);
    }

    // ATR
    const atrVal = state.atrStream.nextValue({ high, low, close: currentPrice });
    if (atrVal !== undefined) {
      state.atrValues.push(atrVal);
    }

    state.processedBars++;

    // --- Check we have enough data for crossover detection (need current + previous) ---
    if (
      state.cciValues.length < 2 ||
      state.smaValues.length < 1 ||
      state.adxValues.length < 1 ||
      state.atrValues.length < 1
    ) {
      return;
    }

    // --- Read current and previous indicator values ---
    const currentCci = state.cciValues[state.cciValues.length - 1];
    const prevCci = state.cciValues[state.cciValues.length - 2];
    const currentSma = state.smaValues[state.smaValues.length - 1];
    const currentAdx = state.adxValues[state.adxValues.length - 1];
    const currentAtr = state.atrValues[state.atrValues.length - 1];

    // Detect CCI crossovers
    // Mode 1: Breakout crossovers
    const bullishBreakout = prevCci <= cciBreakoutLevel && currentCci > cciBreakoutLevel;
    const bearishBreakout = prevCci >= -cciBreakoutLevel && currentCci < -cciBreakoutLevel;

    // Mode 2: Zero-line crossovers
    const bullishZeroCross = prevCci <= 0 && currentCci > 0;
    const bearishZeroCross = prevCci >= 0 && currentCci < 0;

    // CCI reversal exits
    const cciReversalBearish = prevCci >= -cciExitLevel && currentCci < -cciExitLevel;
    const cciReversalBullish = prevCci <= cciExitLevel && currentCci > cciExitLevel;

    // Trend filters
    const isBullishTrend = currentPrice > currentSma;
    const isBearishTrend = currentPrice < currentSma;
    const hasTrendStrength = currentAdx >= adxThreshold;

    // === EXIT LOGIC (check exits BEFORE entries) ===

    if (longPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves UP for longs)
      const newTrailLevel = currentPrice - currentAtr * trailMultiplier;
      if (newTrailLevel > (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop (highest priority)
      if (currentPrice <= (this as any)._trailingStop) {
        context.log(`TRAILING STOP: Price ${currentPrice.toFixed(2)} <= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeLong();
        return;
      }

      // 2. CCI Reversal Exit (CCI drops below -exitLevel)
      if (cciReversalBearish) {
        context.log(`CCI REVERSAL EXIT: CCI=${currentCci.toFixed(1)} crossed below -${cciExitLevel}`);
        context.closeLong();
        return;
      }

      // 3. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT: Held for ${barsHeld} bars (max: ${maxHoldBars})`);
        context.closeLong();
        return;
      }
    }

    if (shortPosition) {
      const entryBar = (this as any)._entryBar || 0;
      const barsHeld = currentIndex - entryBar;

      // Update trailing stop (only moves DOWN for shorts)
      const newTrailLevel = currentPrice + currentAtr * trailMultiplier;
      if (newTrailLevel < (this as any)._trailingStop) {
        (this as any)._trailingStop = newTrailLevel;
      }

      // 1. Trailing Stop
      if (currentPrice >= (this as any)._trailingStop) {
        context.log(`TRAILING STOP (SHORT): Price ${currentPrice.toFixed(2)} >= Stop ${((this as any)._trailingStop).toFixed(2)}`);
        context.closeShort();
        return;
      }

      // 2. CCI Reversal Exit (CCI rises above +exitLevel)
      if (cciReversalBullish) {
        context.log(`CCI REVERSAL EXIT (SHORT): CCI=${currentCci.toFixed(1)} crossed above +${cciExitLevel}`);
        context.closeShort();
        return;
      }

      // 3. Time-based exit
      if (barsHeld >= maxHoldBars) {
        context.log(`TIME EXIT (SHORT): Held for ${barsHeld} bars`);
        context.closeShort();
        return;
      }
    }

    // === ENTRY LOGIC (only if not in a position) ===

    if (!longPosition && !shortPosition && hasTrendStrength) {
      // === LONG ENTRIES ===
      if (isBullishTrend) {
        // Mode 1: CCI breakout above +breakoutLevel
        const mode1Long = bullishBreakout;

        // Mode 2: CCI zero-line crossover (if enabled)
        const mode2Long = enableZeroCross && bullishZeroCross;

        if (mode1Long || mode2Long) {
          const positionValue = balance * 0.95;
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            const mode = mode1Long ? `Breakout (+${cciBreakoutLevel})` : 'Zero Cross';
            context.log(
              `OPEN LONG [${mode}]: CCI=${currentCci.toFixed(1)}, ADX=${currentAdx.toFixed(1)}, Price ${currentPrice.toFixed(2)} > SMA ${currentSma.toFixed(2)}`
            );
            (this as any)._entryBar = currentIndex;
            (this as any)._trailingStop = currentPrice - currentAtr * trailMultiplier;
            context.openLong(amount);
          }
        }
      }

      // === SHORT ENTRIES ===
      if (enableShorts && isBearishTrend) {
        // Mode 1: CCI breakout below -breakoutLevel
        const mode1Short = bearishBreakout;

        // Mode 2: CCI zero-line crossover (if enabled)
        const mode2Short = enableZeroCross && bearishZeroCross;

        if (mode1Short || mode2Short) {
          const positionValue = balance * 0.95;
          const amount = positionValue / currentPrice;

          if (amount > 0) {
            const mode = mode1Short ? `Breakout (-${cciBreakoutLevel})` : 'Zero Cross';
            context.log(
              `OPEN SHORT [${mode}]: CCI=${currentCci.toFixed(1)}, ADX=${currentAdx.toFixed(1)}, Price ${currentPrice.toFixed(2)} < SMA ${currentSma.toFixed(2)}`
            );
            (this as any)._entryBar = currentIndex;
            (this as any)._trailingStop = currentPrice + currentAtr * trailMultiplier;
            context.openShort(amount);
          }
        }
      }
    }
  },

  onEnd(context: StrategyContext): void {
    if (context.longPosition) {
      context.log('Closing remaining long position at end of backtest');
      context.closeLong();
    }
    if (context.shortPosition) {
      context.log('Closing remaining short position at end of backtest');
      context.closeShort();
    }
  },
};

export default cciMomentumBreakout;
