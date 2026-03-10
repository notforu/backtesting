/**
 * Shared CandleView implementation and PendingAction interface.
 * Used by both engine.ts and signal-adapter.ts to avoid duplication.
 */

import type { Candle, TradeAction } from './types.js';
import type { CandleView } from '../strategy/base.js';

/**
 * Memory-efficient view into a candle array without copying.
 * Exposes a slice of the array up to `endIndex` (inclusive).
 * The `endIndex` field is mutable so the same instance can be reused
 * across bars in the engine without re-allocation.
 */
export class CandleViewImpl implements CandleView {
  endIndex: number;

  constructor(
    private readonly candles: Candle[],
    endIndex: number
  ) {
    this.endIndex = endIndex;
  }

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
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].close;
    }
    return result;
  }

  volumes(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].volume;
    }
    return result;
  }

  highs(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].high;
    }
    return result;
  }

  lows(): number[] {
    const result = new Array<number>(this.length);
    for (let i = 0; i <= this.endIndex; i++) {
      result[i] = this.candles[i].low;
    }
    return result;
  }
}

/**
 * A pending trade action captured from a strategy's onBar() call.
 */
export interface PendingAction {
  action: TradeAction;
  amount: number | 'all';
}
