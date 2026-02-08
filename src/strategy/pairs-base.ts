/**
 * Base interface for pairs trading strategies
 */
import type { Candle, Position, Order } from '../core/types.js';
import type { CandleView, StrategyParam } from './base.js';

/**
 * Context provided to pairs strategies on each bar
 */
export interface PairsStrategyContext {
  symbolA: string;
  symbolB: string;
  candleA: Candle;
  candleB: Candle;
  candleViewA: CandleView;
  candleViewB: CandleView;
  currentIndex: number;
  params: Record<string, unknown>;
  balance: number;
  equity: number;
  longPositionA: Position | null;
  shortPositionA: Position | null;
  longPositionB: Position | null;
  shortPositionB: Position | null;
  leverage: number;

  openLongA(amount: number): void;
  closeLongA(amount?: number): void;
  openShortA(amount: number): void;
  closeShortA(amount?: number): void;
  openLongB(amount: number): void;
  closeLongB(amount?: number): void;
  openShortB(amount: number): void;
  closeShortB(amount?: number): void;

  log(message: string): void;
}

/**
 * Base interface for pairs trading strategies
 */
export interface PairsStrategy {
  name: string;
  description: string;
  version: string;
  params: StrategyParam[];
  isPairs: true;

  init?(context: PairsStrategyContext): void;
  onBar(context: PairsStrategyContext): void;
  onOrderFilled?(context: PairsStrategyContext, order: Order): void;
  onEnd?(context: PairsStrategyContext): void;
}
