# Dynamic Per-Bar Strategy Indicators + Real FR Threshold Display

**Date**: 2026-03-10 14:30
**Author**: orchestrator

## Summary

Implemented a generic `setIndicator()` mechanism allowing strategies to output custom per-bar data to the frontend, and used it to display dynamic FR threshold lines on the chart. The FR Spike V2 strategy now emits real `frShortThreshold` and `frLongThreshold` values each bar, replacing static horizontal lines that didn't match the actual percentile-based entry logic. This eliminates confusion where FR crossed a displayed line but no trade opened because the threshold was calculated differently.

## Problem Statement

The chart displayed static horizontal threshold lines derived from strategy parameters, but FR Spike V2 uses dynamic percentile-based thresholds when `usePercentile=true` (the default). The visual mismatch caused confusion:
- User sees FR line cross the displayed threshold
- No trade opens because actual threshold is different
- User doesn't understand why the signal didn't trigger

Solution: Allow strategies to emit per-bar computed values and render them dynamically on the chart.

## Changed

- **Backend backtest engine** now collects per-bar indicator values from `setIndicator()` calls
- **Chart component** now renders dynamic threshold lines from indicator data
- **FR Spike V2 strategy** emits computed thresholds each bar
- **Indicator data flows through** backtest results from engine → API → frontend

## Added

- `StrategyContext.setIndicator(name, value)` method in base strategy interface
- `indicators` field in BacktestResult (map of symbol → map of indicator name → array of values)
- Dynamic LineSeries rendering in Chart component for FR threshold visualization
- Fallback to static lines when indicator data is not available

## Fixed

- Chart now displays actual entry thresholds instead of static parameter values
- FR Spike V2 threshold visualization now accurate to real percentile calculations
- Eliminated visual mismatch that caused confusion about when trades should open

## Files Modified

**Backend:**
- `src/strategy/base.ts` — Added `setIndicator(name: string, value: number): void` to StrategyContext interface
- `src/core/types.ts` — Added optional `indicators?: Record<string, number[]>` field to BacktestResult
- `src/core/engine.ts` — Implemented per-bar indicator collection (staging each bar, flushing per-asset indicators on completion)
- `strategies/funding-rate-spike-v2.ts` — Calls `setIndicator('frShortThreshold', ...)` and `setIndicator('frLongThreshold', ...)` on each bar

**Frontend:**
- `src/web/types.ts` — Updated BacktestResult and PerAssetResult types to include optional `indicators` field
- `src/web/components/Chart/Chart.tsx` — Added rendering of dynamic LineSeries for FR thresholds; falls back to static horizontal lines when indicator data absent
- `src/web/App.tsx` — Passes `indicators` prop to Chart component in both single-asset and multi-asset modes

## Context

This feature enables transparency in strategy execution. For FR Spike V2, it solves a specific UX problem where the displayed thresholds didn't match reality. More broadly, the mechanism supports any custom per-bar metric a strategy wants to visualize (signal strength, moving averages, volatility bands, etc.), making backtest results more interpretable.

The implementation keeps indicator data optional to maintain backward compatibility with existing strategies that don't use it.
