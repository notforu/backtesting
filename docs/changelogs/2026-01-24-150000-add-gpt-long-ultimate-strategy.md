# Add GPT LONG ULTIMATE Strategy

**Date**: 2026-01-24 15:00
**Author**: dev-team

## Summary
Implemented GPT LONG ULTIMATE, a sophisticated multi-signal trend-following strategy that combines technical indicators with fractal-based structure analysis. This strategy uses a Pine Script-derived design combining Bollinger Bands RSI momentum, Klinger Volume Oscillator volume confirmation, and Williams Fractals for price structure identification.

## Added
- `strategies/gptLongUltimate.ts` - New multi-signal strategy implementation

## Changed
- Strategy system now supports complex indicator combinations (BB% RSI, KVO, fractals)

## Strategy Features

### Core Components
- **Trend Filters**: SMA(60) and EMA(120) for directional bias
- **Momentum**: Bollinger Bands % applied to RSI (BB% RSI) for overbought/oversold detection
- **Volume Confirmation**: Klinger Volume Oscillator (KVO) with fast/slow/signal line configuration
- **Structure Identification**: Williams Fractals for high/low identification
- **Trend Confirmation**: Fractal trend counting (3+ consecutive fractals = confirmed trend)

### Entry Logic
1. **Fractal Breakout**: Entry above/below fractal levels when:
   - Multiple signal confirmations align
   - Trend confirmation threshold met
   - BB% RSI and KVO confirm direction

2. **CHoCH (Change of Character)**: Trend reversal entries when fractal structure reverses

### Exit Logic
- Dynamic stop losses placed at 3rd most recent opposite fractal
- Percentage-based offset calculation (not fixed pips)
- Symmetric exit logic for long and short positions

### Configuration Parameters
- `positionSizePercent` - Position sizing (default: 2%)
- `breakoutOffsetPercent` - Breakout level offset (default: 0.3%)
- `smaLength` - Short-term trend SMA (default: 60)
- `emaLength` - Medium-term trend EMA (default: 120)
- `rsiLength` - RSI period (default: 14)
- `rsiBBLength` - Bollinger Bands period for RSI (default: 20)
- `kvoFast` - KVO fast length (default: 34)
- `kvoSlow` - KVO slow length (default: 55)
- `kvoSignal` - KVO signal length (default: 13)
- `fractalTrendCount` - Fractals for trend confirmation (default: 3)
- `lookbackStart` - Minimum bars back for conditions (default: 50)
- `lookbackEnd` - Maximum bars back (default: 500)
- `ma20Length` - Additional moving average (default: 20)
- `enableShorts` - Enable short selling (default: true)

### Key Design Principles
- Fully symmetric long/short logic (shorts can be toggled)
- All parameters configurable with sensible defaults
- Lookback range validation ensures adequate historical data
- Pine Script source compatibility for future updates

## Files Modified
- `strategies/gptLongUltimate.ts` - New strategy file (created)

## Context
The GPT LONG ULTIMATE strategy brings institutional-grade technical analysis to the backtesting platform. By combining multiple indicators and fractal-based structure analysis, it provides traders with a robust framework for identifying high-probability trade setups. The strategy's design allows for both long-biased and bidirectional trading depending on configuration, making it adaptable to different market conditions and trader preferences.

The symmetric implementation of entry and exit logic ensures consistency between long and short trades, reducing the chance of systematic errors favoring one direction over another.
