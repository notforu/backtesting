# Quant Agent Knowledge Base

**Document Purpose**: Comprehensive reference for quant agents (quant-lead, quant) developing and testing trading strategies.

---

## Table of Contents

1. [Strategy Interface](#strategy-interface)
2. [Technical Indicators](#technical-indicators)
3. [Trading Styles](#trading-styles)
4. [Risk Management](#risk-management)
5. [Scoring Formula](#scoring-formula)
6. [Quality Criteria](#quality-criteria)
7. [CLI Tools Reference](#cli-tools-reference)
8. [Example Strategy](#example-strategy)
9. [Data & Exchanges](#data--exchanges)
10. [Timeframe Flexibility](#timeframe-flexibility)
11. [Multi-Timeframe & Multi-Asset Architecture](#multi-timeframe--multi-asset-architecture)
12. [System Limitations & Extension Points](#system-limitations--extension-points)

---

## Strategy Interface

### Overview

All trading strategies must implement the `Strategy` interface from `/workspace/src/strategy/base.ts`.

### Strategy Interface Definition

```typescript
export interface Strategy {
  /**
   * Unique strategy name (used for identification)
   */
  name: string;

  /**
   * Human-readable description
   */
  description: string;

  /**
   * Strategy version (semver recommended)
   */
  version: string;

  /**
   * Parameter definitions for UI generation and validation
   */
  params: StrategyParam[];

  /**
   * Called once at the start of the backtest
   * Use for initialization (e.g., calculating indicators)
   */
  init?(context: StrategyContext): void;

  /**
   * Called for each candle in the backtest
   * This is where trading logic should be implemented
   */
  onBar(context: StrategyContext): void;

  /**
   * Called when an order is filled
   * Use for position tracking or adjustments
   */
  onOrderFilled?(context: StrategyContext, order: Order): void;

  /**
   * Called once at the end of the backtest
   * Use for cleanup or final calculations
   */
  onEnd?(context: StrategyContext): void;
}
```

### Strategy Parameter Definition

```typescript
export interface StrategyParam {
  /**
   * Parameter name (used as key in params object)
   */
  name: string;

  /**
   * Display label for the parameter
   */
  label?: string;

  /**
   * Parameter type: 'number' | 'string' | 'boolean' | 'select'
   */
  type: StrategyParamType;

  /**
   * Default value
   */
  default: unknown;

  /**
   * Minimum value (for number type)
   */
  min?: number;

  /**
   * Maximum value (for number type)
   */
  max?: number;

  /**
   * Step increment (for number type)
   */
  step?: number;

  /**
   * Available options (for select type)
   */
  options?: string[];

  /**
   * Human-readable description
   */
  description: string;
}
```

### StrategyContext API

The `StrategyContext` object is passed to every strategy function and provides:

#### Market Data
- **`candles: Candle[]`** - All candles up to current bar
- **`candleView: CandleView`** - Memory-efficient view (preferred for performance)
- **`currentIndex: number`** - Index of current candle
- **`currentCandle: Candle`** - Current candle object
- **`params: Record<string, unknown>`** - Strategy parameters

#### Portfolio State
- **`portfolio: PortfolioState`** - Current portfolio state
- **`balance: number`** - Available cash
- **`equity: number`** - Total equity (cash + position value)
- **`longPosition: Position | null`** - Current long position
- **`shortPosition: Position | null`** - Current short position

#### Trading Actions
- **`openLong(amount: number): void`** - Open long position
- **`closeLong(amount?: number): void`** - Close long position
- **`openShort(amount: number): void`** - Open short position
- **`closeShort(amount?: number): void`** - Close short position
- **`buy(amount: number): void`** - DEPRECATED, use `openLong`
- **`sell(amount: number): void`** - DEPRECATED, use `closeLong`

#### Utilities
- **`log(message: string): void`** - Log message for debugging

### CandleView Interface

Memory-efficient view into candle data (preferred over direct array access):

```typescript
export interface CandleView {
  readonly length: number;
  at(index: number): Candle | undefined;
  slice(start?: number, end?: number): Candle[];
  closes(): number[];      // All close prices up to current bar
  volumes(): number[];     // All volumes up to current bar
  highs(): number[];       // All high prices up to current bar
  lows(): number[];        // All low prices up to current bar
}
```

### Candle Structure

```typescript
export interface Candle {
  timestamp: number;  // Milliseconds since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;    // In base currency units
}
```

### Export Pattern

Strategies must be exported as **default export**:

```typescript
const myStrategy: Strategy = {
  name: 'my-strategy',
  // ... implementation
};

export default myStrategy;
```

---

## Technical Indicators

All indicators come from the `technicalindicators` library. Available in `src/quant/indicators.ts`:

### Trend Indicators

| Indicator | Purpose | Parameters | Output |
|-----------|---------|-----------|--------|
| **SMA** | Simple Moving Average | period: 5-200 (default: 20) | value |
| **EMA** | Exponential Moving Average | period: 5-200 (default: 20) | value |
| **MACD** | Moving Avg Convergence Divergence | fastPeriod: 8-20, slowPeriod: 20-35, signalPeriod: 5-15 | MACD, signal, histogram |
| **ADX** | Average Directional Index | period: 10-30 (default: 14) | adx, pdi, mdi |
| **Aroon** | Aroon Indicator | period: 10-50 (default: 25) | aroonUp, aroonDown |

### Momentum Indicators

| Indicator | Purpose | Parameters | Output |
|-----------|---------|-----------|--------|
| **RSI** | Relative Strength Index | period: 10-30 (default: 14) | rsi |
| **ROC** | Rate of Change | period: 10-30 (default: 12) | roc |
| **StochasticRSI** | RSI applied to Stochastic | rsiPeriod: 10-20, stochasticPeriod: 10-20, kPeriod: 3-7, dPeriod: 3-7 | k, d |
| **MFI** | Money Flow Index | period: 10-20 (default: 14) | mfi |
| **Stochastic** | Stochastic Oscillator | period: 10-20 (default: 14), signalPeriod: 3-7 (default: 3) | k, d |

### Volatility Indicators

| Indicator | Purpose | Parameters | Output |
|-----------|---------|-----------|--------|
| **ATR** | Average True Range | period: 10-30 (default: 14) | atr |
| **BollingerBands** | Bollinger Bands | period: 10-30 (default: 20), stdDev: 1.5-3 (default: 2) | upper, middle, lower |
| **Keltner Channels** | Keltner Channels | period: 10-30 (default: 20), multiplier: 1.5-3 (default: 2) | upper, middle, lower |
| **DonchianChannels** | Donchian Channels | period: 10-30 (default: 20) | upper, middle, lower |

### Volume Indicators

| Indicator | Purpose | Parameters | Output |
|-----------|---------|-----------|--------|
| **Volume** | Volume confirmation | period: 10-30 (default: 20) | volume |

---

## Trading Styles

### 1. Trend Following

**Description**: Capture sustained directional price movements.

**Primary Indicators**: SMA, EMA, MACD, ADX
**Filter Indicators**: ADX, Aroon
**Risk Management**: ATR

#### Entry Patterns
- **MA Crossover**: Enter when fast MA crosses above slow MA
- **ADX Breakout**: Enter when ADX > threshold with positive +DI
- **MACD Signal**: Enter on MACD bullish crossover

#### Exit Patterns
- **MA Cross Back**: Exit when fast MA crosses below slow MA
- **Trailing Stop**: Use ATR-based trailing stop
- **Profit Target**: Exit at fixed profit target

#### Typical Parameters
- Fast period: 5-20
- Slow period: 20-50
- ATR period: 10-20
- Stop loss: 2-3% ATR multiples
- Take profit: 5-15% target

---

### 2. Mean Reversion

**Description**: Profit from price returning to average after extreme moves.

**Primary Indicators**: RSI, BollingerBands, Stochastic
**Filter Indicators**: ADX, Volume
**Risk Management**: ATR

#### Entry Patterns
- **RSI Oversold**: Enter when RSI < 30
- **Bollinger Band Touch**: Enter when price touches lower band
- **Price Deviation**: Enter when price >> X% below SMA
- **Stochastic Oversold**: Enter when K and D both < 20

#### Exit Patterns
- **Mean Touch**: Exit when price returns to moving average
- **RSI Neutral**: Exit when RSI >= 50
- **Opposite Extreme**: Exit when RSI > 70 (overbought)
- **Time Limit**: Exit after max hold bars

#### Typical Parameters
- RSI period: 10-20
- Bollinger period: 15-25, stdDev: 1.5-2.5
- Stop loss: 2-3% fixed or ATR-based
- Hold period: 10-30 bars

---

### 3. Momentum

**Description**: Capitalize on strong price acceleration and directional momentum.

**Primary Indicators**: RSI, ROC, StochasticRSI, MFI
**Filter Indicators**: Volume, MACD
**Risk Management**: ATR

#### Entry Patterns
- **RSI Threshold**: Enter when RSI crosses above momentum level (e.g., 60)
- **ROC Acceleration**: Enter when ROC > threshold
- **Volume Surge**: Enter on price increase with high volume
- **StochRSI Momentum**: Enter when K crosses above D in bullish zone
- **MFI Strength**: Enter when MFI rising and > threshold

#### Exit Patterns
- **Momentum Fade**: Exit when RSI < fade level
- **Divergence**: Exit on bearish divergence (price HH, RSI LH)
- **Trailing Momentum Stop**: Tight ATR-based trailing stop

#### Typical Parameters
- RSI period: 10-14
- ROC period: 12-20
- Volume period: 20-30
- Stop loss: 1.5-2% (tight for momentum)
- Hold period: 5-20 bars

---

### 4. Breakout

**Description**: Capture explosive moves from consolidation or resistance.

**Primary Indicators**: DonchianChannels, BollingerBands, KeltnerChannels
**Filter Indicators**: Volume, ADX
**Risk Management**: ATR

#### Entry Patterns
- **Range Breakout**: Enter when price breaks above recent range high (Donchian)
- **Volume Breakout**: Enter on breakout with volume > 1.5x average
- **Volatility Expansion**: Enter on BB width expanding + price breakout
- **Keltner Breakout**: Enter on Keltner channel breakout

#### Exit Patterns
- **Failed Breakout**: Exit if price falls back below midline
- **Profit Target**: Exit at predetermined target
- **Trailing Stop**: Wide ATR trailing stop to capture full move
- **Volume Exhaustion**: Exit when volume dries up

#### Typical Parameters
- Donchian/BB period: 15-30
- Volume multiplier: 1.3-2.0x
- Stop loss: Just below breakout level (0.5-1% buffer)
- Take profit: 5-20% target

---

### 5. Volatility

**Description**: Profit from volatility regime changes and expansions.

**Primary Indicators**: ATR, BollingerBands, KeltnerChannels
**Filter Indicators**: Volume
**Risk Management**: ATR (dynamic scaling)

#### Entry Patterns
- **Volatility Contraction**: Enter after low volatility period
- **Regime Change**: Enter on volatility expansion with directional move
- **Bollinger Squeeze**: Enter on squeeze breakout
- **Keltner Expansion**: Enter on channel expansion

#### Exit Patterns
- **Volatility Peak**: Exit when ATR peaks
- **Regime Change Exit**: Exit on volatility shift
- **Bollinger Reversion**: Exit when price returns to middle
- **Time-Based Exit**: Exit after max hold (vol trades short-term)

#### Typical Parameters
- ATR period: 10-20
- Bollinger period: 15-25
- Contraction threshold: 0.6-0.8x average
- Hold period: 5-15 bars

---

## Risk Management

### Dynamic Stop Loss (Recommended)

Uses ATR to scale stops based on current volatility:

```typescript
const atrValues = calculateATR(candles, atrPeriod);
const currentATR = atrValues[atrValues.length - 1];
const stopDistance = currentATR * stopMultiplier;
const stopPrice = entryPrice - stopDistance;
```

**Typical Multipliers by Style**:
- Trend: 2.0-3.0x ATR
- Mean Reversion: 1.5-2.5x ATR
- Momentum: 1.0-2.0x ATR (tight)
- Breakout: 1.5-2.5x ATR
- Volatility: 1.5-3.0x ATR (dynamic)

### Fixed Percentage Stop Loss

Simpler approach for backtesting:

```typescript
const lossPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
if (lossPercent <= -stopLossPercent) {
  closeLong();
}
```

**Typical Ranges by Style**:
- Trend: 2-5%
- Mean Reversion: 1.5-3%
- Momentum: 1-2%
- Breakout: 1.5-3%
- Volatility: 2-4%

### Position Sizing

Default: Use 95% of available balance per trade.

```typescript
const positionValue = balance * 0.95;
const amount = positionValue / currentPrice;
```

For volatility adjustment:

```typescript
const volatilityAdjustment = averageATR / currentATR;
const adjustedSize = baseSize * volatilityAdjustment;
```

### Trailing Stops

Used for trend and breakout strategies to lock in profits:

```typescript
const trailDistance = currentATR * trailMultiplier;
const newStop = currentPrice - trailDistance;

if (newStop > trailingStop) {
  trailingStop = newStop;  // Only move up
}

if (currentPrice <= trailingStop) {
  closeLong();
}
```

**Typical Trail Multipliers**:
- Trend: 1.5-2.5x ATR
- Breakout: 2.0-3.0x ATR (wider to catch moves)
- Momentum: 0.5-1.5x ATR (tighter)

---

## Scoring Formula

### Overall Robustness Score

Combines multiple validation metrics into a single 0-100 score.

```
score = (
  0.30 * normalize(sharpeRatio, 0, 3) +
  0.20 * (1 - oosDegrade / 100) +
  0.20 * (multiAssetPassRate / 100) +
  0.15 * normalize(totalReturnPercent, 0, 100) +
  0.15 * (1 - maxDrawdownPercent / 30)
) * 100
```

### Weight Breakdown

| Component | Weight | Range | Notes |
|-----------|--------|-------|-------|
| Sharpe Ratio | 30% | 0-3 | Risk-adjusted returns (3+ = excellent) |
| OOS Degradation | 20% | 0-100% | Overfitting measure (lower = better) |
| Multi-Asset Pass Rate | 20% | 0-100% | Generalizability across symbols |
| Total Return | 15% | 0-100% | Absolute profitability (100%+ = excellent) |
| Max Drawdown | 15% | 0-30% | Risk control (30%+ = concerning) |

### Normalization Function

```typescript
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));  // Clamp to [0, 1]
}
```

### Component Calculations

**Sharpe Component**:
- Uses test Sharpe (from walk-forward) if available
- Falls back to optimization Sharpe otherwise
- Normalized to 0-3 range

**OOS Degradation Component**:
- `degradation = abs((trainSharpe - testSharpe) / trainSharpe * 100)`
- Formula: `max(0, 1 - degradation / 100)`
- Degradation >= 100% = score 0

**Multi-Asset Component**:
- `passRate = (symbolsPassed / totalSymbols) * 100`
- Score = passRate / 100
- Only available if multi-asset validation run

**Return Component**:
- Normalized to 0-100% range
- 100%+ return = perfect score

**Drawdown Component**:
- Formula: `max(0, 1 - maxDrawdown / 30)`
- 30% drawdown = score 0
- Higher drawdown penalizes heavily

---

## Quality Criteria

A strategy is considered **"promising"** if it meets ALL of these criteria:

### 1. Walk-Forward Out-of-Sample Sharpe > 0.5
- Test Sharpe (not training Sharpe) must exceed 0.5
- Indicates profitable on unseen data
- Threshold: 0.5 is minimum for consideration

### 2. Out-of-Sample Degradation < 30%
- `degradation = (trainSharpe - testSharpe) / trainSharpe * 100`
- Positive degradation indicates overfitting
- Must stay below 30% threshold
- Example: If train Sharpe = 1.0 and test Sharpe = 0.8, degradation = 20%

### 3. Multi-Asset Generalizability
- Must work on at least 2 major assets, OR
- Pass rate >= 40% across all tested symbols
- Prevents overfitting to single symbol

### 4. Sufficient Trade Count > 20
- Minimum 20 trades in test (OOS) period
- Ensures statistical significance
- Prevents luck-based results

### 5. Manageable Drawdown < 25%
- Maximum drawdown must stay below 25%
- Ensures capital preservation
- Higher drawdowns indicate excessive risk

### Status: "Promising" vs "Not Promising"

A strategy that meets all 5 criteria is marked **`isPromising: true`**.

Code location: `/workspace/src/quant/scoring.ts` - `isStrategyPromising()` function

---

## CLI Tools Reference

### 1. Strategy Validation

```bash
npx tsx src/cli/quant-validate.ts <file-path>
```

**Purpose**: Validate strategy code syntax and interface compliance

**Input**: Path to strategy file (`.ts`)

**Output (JSON to stdout)**:
```json
{
  "valid": true,
  "name": "sma-crossover",
  "version": "2.0.0",
  "params": [
    { "name": "fastPeriod", "type": "number", "default": 10 }
  ],
  "errors": []
}
```

---

### 2. Single Backtest

```bash
npx tsx src/cli/quant-backtest.ts \
  --strategy=NAME \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  [--timeframe=4h] \
  [--capital=10000] \
  [--param.key=value] \
  [--exchange=binance]
```

**Parameters**:
- `--strategy` (required): Strategy name
- `--symbol` (required): Trading pair (e.g., BTC/USDT)
- `--from` (required): Start date (YYYY-MM-DD or ISO)
- `--to` (required): End date (YYYY-MM-DD or ISO)
- `--timeframe` (optional): Candle timeframe, default: 1h
- `--capital` (optional): Initial capital, default: 10000
- `--param.key=value`: Override parameter (e.g., `--param.fastPeriod=15`)
- `--exchange` (optional): Exchange name, default: binance

**Output (JSON)**:
```json
{
  "id": "uuid",
  "config": {
    "strategyName": "sma-crossover",
    "symbol": "BTC/USDT",
    "timeframe": "4h",
    "startDate": 1704067200000,
    "endDate": 1717286400000,
    "initialCapital": 10000
  },
  "metrics": {
    "totalReturn": 2500,
    "totalReturnPercent": 25.0,
    "sharpeRatio": 1.45,
    "sortinoRatio": 2.10,
    "maxDrawdownPercent": -8.5,
    "profitFactor": 2.3,
    "totalTrades": 35,
    "winRate": 0.6,
    "avgWin": 125.5,
    "avgLoss": -75.2
  },
  "trades": [
    {
      "id": "trade-1",
      "action": "OPEN_LONG",
      "price": 45000,
      "amount": 0.22,
      "timestamp": 1704067200000,
      "balanceAfter": 10000
    }
  ],
  "equity": [
    { "timestamp": 1704067200000, "equity": 10000, "drawdown": 0 }
  ]
}
```

---

### 3. Walk-Forward Testing

```bash
npx tsx src/cli/quant-walk-forward.ts \
  --strategy=NAME \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-12-31 \
  [--timeframe=4h] \
  [--train-ratio=0.7] \
  [--optimize-for=sharpeRatio] \
  [--capital=10000] \
  [--max-combinations=500] \
  [--min-trades=10]
```

**Parameters**:
- `--strategy` (required): Strategy name
- `--symbol` (required): Trading pair
- `--from` (required): Start date
- `--to` (required): End date
- `--timeframe` (optional): Candle timeframe, default: 1h
- `--train-ratio` (optional): Train/test split, default: 0.7 (70% train)
- `--optimize-for` (optional): Metric to optimize - sharpeRatio, totalReturn, profitFactor, sortino, calmar. Default: sharpeRatio
- `--capital` (optional): Initial capital, default: 10000
- `--max-combinations` (optional): Max param combinations to test, default: 500
- `--min-trades` (optional): Minimum trades per test, default: 10

**Output (JSON)**:
```json
{
  "trainPeriod": {
    "start": 1704067200000,
    "end": 1734892800000
  },
  "trainMetrics": {
    "sharpeRatio": 1.8,
    "totalReturnPercent": 45.2,
    "maxDrawdownPercent": -12.5,
    "totalTrades": 42
  },
  "optimizedParams": {
    "fastPeriod": 12,
    "slowPeriod": 28
  },
  "testPeriod": {
    "start": 1734892800000,
    "end": 1767427200000
  },
  "testMetrics": {
    "sharpeRatio": 1.5,
    "totalReturnPercent": 38.1,
    "maxDrawdownPercent": -14.2,
    "totalTrades": 35
  },
  "oosDegrade": 16.7,
  "isRobust": true,
  "optimizationResult": {
    "bestParams": { "fastPeriod": 12, "slowPeriod": 28 },
    "bestMetrics": { "sharpeRatio": 1.8 },
    "totalCombinations": 156
  }
}
```

**Output Interpretation**:
- `oosDegrade`: Percentage performance loss on test data (overfitting measure)
- `isRobust`: true if degradation < 30% AND testSharpe > 0.5

---

### 4. Parameter Optimization

```bash
npx tsx src/cli/quant-optimize.ts \
  --strategy=NAME \
  --symbol=BTC/USDT \
  --from=2024-01-01 \
  --to=2024-06-01 \
  [--timeframe=4h] \
  [--optimize-for=sharpeRatio] \
  [--capital=10000] \
  [--max-combinations=500] \
  [--min-trades=10]
```

**Parameters**: Same as walk-forward (without train-ratio)

**Output (JSON)**:
```json
{
  "bestParams": {
    "fastPeriod": 12,
    "slowPeriod": 28
  },
  "bestMetrics": {
    "sharpeRatio": 1.8,
    "totalReturnPercent": 45.2,
    "maxDrawdownPercent": -12.5,
    "totalTrades": 42
  },
  "totalCombinations": 156,
  "testDuration": 3500,
  "optimizationHistory": [
    {
      "params": { "fastPeriod": 10, "slowPeriod": 20 },
      "metrics": { "sharpeRatio": 1.2 },
      "rank": 50
    }
  ]
}
```

---

### 5. Strategy Scoring

```bash
npx tsx src/cli/quant-score.ts \
  --walk-forward-file=<path-to-wf-result.json> \
  [--multi-asset-file=<path-to-ma-result.json>]
```

**Inputs**:
- `--walk-forward-file` (required): JSON from walk-forward test
- `--multi-asset-file` (optional): JSON from multi-asset validation

**Output (JSON)**:
```json
{
  "overallScore": 78,
  "components": {
    "sharpeScore": 0.85,    // Out of 1.0
    "oosScore": 0.92,
    "multiAssetScore": 0.80,
    "returnScore": 0.45,
    "drawdownScore": 0.88
  },
  "isPromising": true,
  "reasoning": {
    "sharpe": "Test Sharpe: 1.5 (good)",
    "oosDegrade": "16.7% (acceptable)",
    "multiAsset": "60% pass rate (promising)",
    "trades": "42 trades (sufficient)",
    "drawdown": "12.5% (well managed)"
  }
}
```

---

### CLI Usage Notes

**Logging**: All logging goes to **stderr**, JSON results go to **stdout** for easy piping.

```bash
# Redirect logs to file, keep JSON clean
npx tsx src/cli/quant-backtest.ts --strategy=sma --symbol=BTC/USDT --from=2024-01-01 --to=2024-06-01 > result.json 2> logs.txt
```

**Date Formats**:
- YYYY-MM-DD: 2024-01-15
- ISO 8601: 2024-01-15T00:00:00Z

**Parameter Overrides**:
```bash
--param.fastPeriod=15 --param.slowPeriod=35 --param.enableShorts=true
```

---

## Example Strategy

### SMA Crossover Strategy (Annotated)

Location: `/workspace/strategies/sma-crossover.ts`

```typescript
/**
 * SMA Crossover Strategy
 *
 * A classic trend-following strategy that generates signals based on
 * the crossover of two Simple Moving Averages (SMAs).
 *
 * Entry: Long when fast SMA crosses above slow SMA
 * Exit: Close long when fast SMA crosses below slow SMA
 */

import { SMA } from 'technicalindicators';
import type { Strategy, StrategyContext } from '../src/strategy/base.js';

/**
 * Helper function to calculate SMA values
 * Pads result with undefined values to align with candles array
 */
function calculateSMA(closes: number[], period: number): (number | undefined)[] {
  const result = SMA.calculate({
    values: closes,
    period: period,
  });

  // Align with original array by padding beginning
  const padding = new Array(period - 1).fill(undefined);
  return [...padding, ...result];
}

/**
 * Main strategy definition
 */
const smaCrossover: Strategy = {
  // Strategy metadata
  name: 'sma-crossover',
  description:
    'Trend-following strategy using Simple Moving Average crossovers.',
  version: '2.0.0',

  // Parameter definitions (used for optimization and UI)
  params: [
    {
      name: 'fastPeriod',
      label: 'Fast Period',
      type: 'number',
      default: 10,
      min: 2,
      max: 100,
      step: 1,
      description: 'Period for the fast-moving SMA',
    },
    {
      name: 'slowPeriod',
      label: 'Slow Period',
      type: 'number',
      default: 20,
      min: 5,
      max: 200,
      step: 1,
      description: 'Period for the slow-moving SMA',
    },
    {
      name: 'enableShorts',
      label: 'Enable Shorts',
      type: 'boolean',
      default: false,
      description: 'Open short positions on bearish crossover',
    },
  ],

  /**
   * Called once at strategy startup
   * Validate parameters and initialize state
   */
  init(context: StrategyContext): void {
    const { params } = context;
    const fastPeriod = params.fastPeriod as number;
    const slowPeriod = params.slowPeriod as number;

    // Validate parameter constraints
    if (fastPeriod >= slowPeriod) {
      throw new Error(
        `Fast period (${fastPeriod}) must be less than slow period (${slowPeriod})`
      );
    }

    context.log(
      `Initialized SMA Crossover with fast=${fastPeriod}, slow=${slowPeriod}`
    );
  },

  /**
   * Called on every candle
   * This is where trading logic runs
   */
  onBar(context: StrategyContext): void {
    const { candles, currentIndex, params, longPosition, shortPosition, balance } = context;

    const fastPeriod = params.fastPeriod as number;
    const slowPeriod = params.slowPeriod as number;
    const enableShorts = params.enableShorts as boolean;

    // Need minimum number of candles to calculate indicators
    if (currentIndex < slowPeriod) {
      return;
    }

    // Get close prices up to current (use candleView for efficiency)
    const closes = context.candleView.closes();

    // Calculate both SMAs
    const fastSMA = calculateSMA(closes, fastPeriod);
    const slowSMA = calculateSMA(closes, slowPeriod);

    // Get current and previous values
    const currentFast = fastSMA[fastSMA.length - 1];
    const currentSlow = slowSMA[slowSMA.length - 1];
    const prevFast = fastSMA[fastSMA.length - 2];
    const prevSlow = slowSMA[slowSMA.length - 2];

    // Validate we have valid values
    if (
      currentFast === undefined ||
      currentSlow === undefined ||
      prevFast === undefined ||
      prevSlow === undefined
    ) {
      return;
    }

    const currentPrice = context.currentCandle.close;

    /**
     * BULLISH SIGNAL: Fast SMA crosses above Slow SMA
     * Condition: prev state was fast <= slow, current state is fast > slow
     */
    if (prevFast <= prevSlow && currentFast > currentSlow) {
      // Close any short first
      if (shortPosition) {
        context.log(`Closing short, bullish crossover detected`);
        context.closeShort();
      }

      // Open long if not already in one
      if (!longPosition) {
        // Calculate position size: 95% of available balance
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN LONG: Fast SMA (${currentFast.toFixed(2)}) crossed above Slow SMA (${currentSlow.toFixed(2)})`
          );
          context.openLong(amount);
        }
      }
    }

    /**
     * BEARISH SIGNAL: Fast SMA crosses below Slow SMA
     * Condition: prev state was fast >= slow, current state is fast < slow
     */
    if (prevFast >= prevSlow && currentFast < currentSlow) {
      // Close any long position
      if (longPosition) {
        context.log(
          `CLOSE LONG: Fast SMA (${currentFast.toFixed(2)}) crossed below Slow SMA (${currentSlow.toFixed(2)})`
        );
        context.closeLong();
      }

      // Open short if enabled and not already in one
      if (enableShorts && !shortPosition) {
        const positionValue = balance * 0.95;
        const amount = positionValue / currentPrice;

        if (amount > 0) {
          context.log(
            `OPEN SHORT: Fast SMA crossed below Slow SMA`
          );
          context.openShort(amount);
        }
      }
    }
  },

  /**
   * Called at end of backtest
   * Clean up any remaining positions
   */
  onEnd(context: StrategyContext): void {
    const { longPosition, shortPosition } = context;

    if (longPosition) {
      context.log('Closing remaining long position');
      context.closeLong();
    }

    if (shortPosition) {
      context.log('Closing remaining short position');
      context.closeShort();
    }
  },
};

export default smaCrossover;
```

### Key Pattern Notes

1. **Parameter Validation**: Validate constraints in `init()`
2. **Early Return for Insufficient Data**: Always check if enough candles exist
3. **Use CandleView**: Prefer `context.candleView.closes()` over direct array access
4. **Crossover Detection**: Compare previous and current values
5. **Position Sizing**: Use percentage of available balance (95% typical)
6. **Cleanup**: Close remaining positions in `onEnd()`

---

## Data & Exchanges

### Available Exchanges

Via CCXT library. Common crypto exchanges:

- **Binance** (most liquid, default)
- **Bybit**
- **Coinbase**
- **OKX**
- **Kraken**
- **KuCoin**
- **Huobi**
- **Deribit**

### Timeframes

Supported candle intervals:

| Timeframe | Description | Use Case |
|-----------|-------------|----------|
| 1m | 1 minute | Scalping, ultra-high frequency |
| 5m | 5 minutes | Scalping, very high frequency |
| 15m | 15 minutes | Intraday, scalping |
| 30m | 30 minutes | Intraday |
| 1h | 1 hour | Intraday, day trading |
| 4h | 4 hours | Swing trading |
| 1d | 1 day | Position trading, swing |
| 1w | 1 week | Long-term, position trading |

### Data Availability

**Caching**: CCXT candles automatically cached in SQLite at `/data/backtesting.db`.

**Date Ranges**:
- **BTC/USDT**: Full history (2011+)
- **ETH/USDT**: Full history (2015+)
- **Alt coins**: Varies by listing date
- **Limit**: Some exchanges limit to last 1000 candles per request (handled transparently)

### CCXT Usage in init()

Strategies can fetch additional data in `init()`:

```typescript
init(context: StrategyContext): void {
  // Import CCXT inside init to avoid circular deps
  const ccxt = require('ccxt');
  const exchange = new ccxt.binance();

  // Fetch funding rates for futures
  const fundingRates = exchange.fetch_funding_history('BTC/USDT');

  // Fetch multi-timeframe data
  const hourlyCandles = exchange.fetch_ohlcv('ETH/USDT', '1h');

  // Cache this data for use in onBar
  context.log('Loaded additional data');
}
```

---

## Timeframe Flexibility

### Choosing Appropriate Timeframes

#### Scalping Strategies (Hold: seconds to minutes)
- **Timeframes**: 1m, 5m
- **Indicators**: Fast-moving (short periods), tick volume
- **Example**: Scalp on breakouts of 5m highs

#### Day Trading (Hold: minutes to hours)
- **Timeframes**: 15m, 30m, 1h
- **Indicators**: Medium-period (10-30 bars)
- **Example**: Mean reversion on 15m, exit same day

#### Swing Trading (Hold: hours to days)
- **Timeframes**: 4h, 1d
- **Indicators**: Medium-period (14-50 bars)
- **Example**: Trend following on 4h with 50/200 MA

#### Position Trading (Hold: weeks to months)
- **Timeframes**: 1d, 1w
- **Indicators**: Longer-period (50-200 bars)
- **Example**: Macro trends on weekly charts

### Multi-Timeframe Analysis

Current system limitation: Single timeframe per backtest.

**Workaround in init()**:

```typescript
init(context: StrategyContext): void {
  const ccxt = require('ccxt');
  const exchange = new ccxt.binance();

  // If running on 4h, also fetch daily for context
  const dailyCandles = exchange.fetch_ohlcv('BTC/USDT', '1d',
    undefined, 100);

  // Store daily trend for filtering
  this.dailyTrend = determineTrend(dailyCandles);

  context.log(`Daily trend: ${this.dailyTrend}`);
}

onBar(context: StrategyContext): void {
  // Use stored daily trend as filter for 4h trades
  if (this.dailyTrend === 'UP' && signal.isBullish) {
    context.openLong();
  }
}
```

### Optimal Timeframes by Style

| Style | Ideal | Alternative | Avoid |
|-------|-------|-------------|-------|
| Trend Following | 4h, 1d | 1h, 1w | 1m, 5m (noise) |
| Mean Reversion | 15m, 1h | 5m, 4h | 1w (slow revert) |
| Momentum | 1h, 4h | 15m, 1d | 1w (too slow) |
| Breakout | 4h, 1d | 1h, 15m | 1m (whipsaws) |
| Volatility | 15m, 1h | 5m, 4h | 1w (stale) |

---

## Multi-Timeframe & Multi-Asset Architecture

### Current System Capabilities

**Single-Symbol, Single-Timeframe**: Each backtest runs on one symbol at one timeframe.

### Multi-Timeframe Support

**Via init() Pre-Calculation**:

```typescript
init(context: StrategyContext): void {
  const ccxt = require('ccxt');
  const exchange = new ccxt.binance();

  // Download multiple timeframes
  const tf1h = exchange.fetch_ohlcv('BTC/USDT', '1h', undefined, 200);
  const tf4h = exchange.fetch_ohlcv('BTC/USDT', '4h', undefined, 200);
  const tf1d = exchange.fetch_ohlcv('BTC/USDT', '1d', undefined, 200);

  // Pre-compute indicators on each timeframe
  this.hourlyTrend = calculateTrend(tf1h);
  this.dailyTrend = calculateTrend(tf1d);

  // Use in onBar as filters/confirmations
  context.log('Multi-TF initialized');
}

onBar(context: StrategyContext): void {
  // Only take long trades if daily trend is up
  if (this.dailyTrend === 'UP' && hourlySignal) {
    context.openLong();
  }
}
```

**Limitations**: Signals are static (pre-calculated). Not live-updated as new bars come in.

### Multi-Asset Support

**Via init() for Cross-Asset Signals**:

```typescript
init(context: StrategyContext): void {
  const ccxt = require('ccxt');
  const exchange = new ccxt.binance();

  // Fetch BTC dominance (if on alt coin like ETH)
  const btcHistory = exchange.fetch_ohlcv('BTC/USDT', '1d', undefined, 100);
  this.btcTrend = calculateTrend(btcHistory);

  context.log(`BTC trend: ${this.btcTrend}`);
}

onBar(context: StrategyContext): void {
  // Only trade ETH if BTC is also in uptrend
  if (this.btcTrend === 'UP' && ethSignal) {
    context.openLong();
  }
}
```

**Current CLI Validation**: Multi-asset validation tool tests same strategy on multiple symbols:

```bash
npx tsx src/cli/quant-multi-asset.ts \
  --strategy=sma-crossover \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT \
  --from=2024-01-01 --to=2024-06-01
```

### Future Multi-Asset Portfolio System

Planned enhancement would allow:
- Single backtest running multiple symbols simultaneously
- Real-time position management across assets
- Cross-asset correlation and hedging
- Portfolio-level risk management

---

## System Limitations & Extension Points

### Current Limitations

1. **Single-Symbol Per Backtest**: Each run processes one symbol only
   - Workaround: Use init() to fetch and cache cross-asset signals
   - Future: Portfolio backtesting engine

2. **Single-Timeframe Per Backtest**: Each run uses one timeframe
   - Workaround: Use init() to pre-compute multi-TF indicators
   - Future: Live multi-timeframe calculation

3. **No Level 2 / Order Book Data**: Only OHLCV candles available
   - Workaround: Fetch from exchange API via init()
   - Future: Support for L2 snapshots

4. **No Alternative Data**: No sentiment, on-chain, funding rates
   - Workaround: External API calls in init()
   - Future: Data provider plugins

5. **No Portfolio-Level Risk**: Per-position risk only
   - Workaround: Manual tracking in strategy state
   - Future: Engine-level portfolio constraints

### Extension Points

#### Adding New Indicators

**Location**: `/workspace/src/quant/indicators.ts`

```typescript
// Add to indicatorRegistry
const MyIndicator: IndicatorConfig = {
  name: 'MyIndicator',
  description: 'Description here',
  paramRanges: {
    period: { min: 5, max: 100, step: 5, default: 20 },
    multiplier: { min: 1, max: 3, step: 0.5, default: 2 },
  },
  outputFields: ['signal', 'value'],
};

// Register in style
export const indicatorRegistry: Record<TradingStyle, StyleIndicators> = {
  trend: {
    primary: [..., MyIndicator],
    filters: [...],
    risk: [...],
  },
  // ...
};
```

#### Adding New Trading Style

**Location**: `/workspace/src/quant/templates/`

1. Create `my-style.ts`:
```typescript
import type { StyleTemplate } from './trend-following.js';

export const template: StyleTemplate = {
  style: 'myStyle',
  description: 'My custom style',
  entryPatterns: [...],
  exitPatterns: [...],
  riskManagement: [...],
};
```

2. Update `index.ts`:
```typescript
import { template as myTemplate } from './my-style.js';

export const templates: Record<TradingStyle, StyleTemplate> = {
  // ...
  myStyle: myTemplate,
};
```

3. Update core types `/workspace/src/core/types.ts`:
```typescript
export const TradingStyleSchema = z.enum([
  'trend', 'meanReversion', 'momentum', 'breakout', 'volatility', 'myStyle'
]);
```

#### Adding Alternative Data Sources

Use `init()` hook to fetch and cache:

```typescript
init(context: StrategyContext): void {
  // On-chain metrics
  fetch('https://api.glassnode.com/v1/metrics/...').then(data => {
    this.onChainMetrics = data;
  });

  // Sentiment
  fetch('https://api.santiment.net/..').then(data => {
    this.sentiment = data;
  });

  // Funding rates
  const fundingRates = fetchFundingRates('BTC/USDT');
  this.fundingTrend = analyzeFunding(fundingRates);
}
```

#### Custom Broker/Slippage Models

**Location**: `/workspace/src/core/broker.ts`

Current: Fixed slippage per trade type. Extensible via BrokerConfig:

```typescript
export interface BrokerConfig {
  buySlippage?: number;      // 0-1 range
  sellSlippage?: number;
  commission?: number;
  // Can add: volume-based slippage, market-impact model, etc.
}
```

#### Position-Tracking Hooks

Strategy can implement `onOrderFilled` to track position lifecycle:

```typescript
onOrderFilled(context: StrategyContext, order: Order): void {
  // Custom tracking
  if (order.side === 'buy') {
    this.entryPrice = order.filledPrice;
    this.entryTime = order.filledAt;
  }

  // Risk adjustments
  if (order.side === 'sell' && this.pnlPercent > 20) {
    // Tighten trailing stop, reduce size, etc.
  }
}
```

---

## Summary for Agents

### Quant-Lead Responsibilities
- Analyze market conditions and trading opportunities
- Design strategy hypotheses using trading styles and indicators
- Specify indicator parameters, entry/exit logic, risk rules
- Evaluate promisingness based on scoring criteria
- Plan multi-asset and walk-forward validation

### Quant Responsibilities
- Implement strategy code following Strategy interface
- Parameter optimization and walk-forward testing
- Multi-asset validation for generalizability
- Strategy scoring and promising assessment
- Use CLI tools for validation and testing

### Key Files to Reference
- Strategy interface: `/workspace/src/strategy/base.ts`
- Indicators registry: `/workspace/src/quant/indicators.ts`
- Trading templates: `/workspace/src/quant/templates/`
- Scoring logic: `/workspace/src/quant/scoring.ts`
- Walk-forward test: `/workspace/src/core/walk-forward.ts`
- Multi-asset validation: `/workspace/src/core/multi-asset-validation.ts`
- Example strategy: `/workspace/strategies/sma-crossover.ts`

---

**Document Version**: 1.0
**Last Updated**: 2025-02-03
**System Status**: Production Ready
