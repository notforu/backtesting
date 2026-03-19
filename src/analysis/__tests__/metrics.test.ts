/**
 * Unit tests for the metrics calculation module
 * Covers: calculateMetrics, generateEquityCurve, calculateRollingMetrics,
 *         calculateRiskMetrics — including all edge cases.
 */

import { describe, it, expect } from 'vitest';
import { calculateMetrics, generateEquityCurve, calculateRollingMetrics, calculateRiskMetrics } from '../metrics.js';
import type { Trade, EquityPoint } from '../../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _tradeIdCounter = 0;
let _positionIdCounter = 0;

function resetCounters(): void {
  _tradeIdCounter = 0;
  _positionIdCounter = 0;
}

/**
 * Build a matched open+close trade pair.
 * entryTime and exitTime are absolute timestamps in milliseconds.
 */
function makeTradePair(opts: {
  symbol?: string;
  side: 'long' | 'short';
  amount: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  fee?: number;
  slippage?: number;
}): Trade[] {
  const {
    symbol = 'BTC/USDT',
    side,
    amount,
    entryPrice,
    exitPrice,
    entryTime,
    exitTime,
    fee,
    slippage,
  } = opts;

  const positionId = `pos-${++_positionIdCounter}`;
  const openAction = side === 'long' ? 'OPEN_LONG' : 'OPEN_SHORT';
  const closeAction = side === 'long' ? 'CLOSE_LONG' : 'CLOSE_SHORT';
  const grossPnl = side === 'long'
    ? (exitPrice - entryPrice) * amount
    : (entryPrice - exitPrice) * amount;
  const pnl = grossPnl - (fee ?? 0);
  const pnlPercent = side === 'long'
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;

  const openTrade: Trade = {
    id: positionId,
    symbol,
    action: openAction,
    price: entryPrice,
    amount,
    timestamp: entryTime,
    balanceAfter: 10_000,
    fee: fee ? fee / 2 : undefined,
  };

  const closeTrade: Trade = {
    id: `close-${++_tradeIdCounter}`,
    symbol,
    action: closeAction,
    price: exitPrice,
    amount,
    timestamp: exitTime,
    pnl,
    pnlPercent,
    closedPositionId: positionId,
    balanceAfter: 10_000 + pnl,
    fee: fee ? fee / 2 : undefined,
    slippage,
  };

  return [openTrade, closeTrade];
}

/**
 * Build equity points from a flat array of [timestamp, equity] tuples.
 * drawdown is computed relative to a peak starting at the first equity value.
 */
function makeEquity(points: [number, number][]): EquityPoint[] {
  let peak = points[0][1];
  return points.map(([timestamp, equity]) => {
    if (equity > peak) peak = equity;
    const drawdown = ((peak - equity) / peak) * 100;
    return { timestamp, equity, drawdown };
  });
}

// ---------------------------------------------------------------------------
// calculateMetrics — zero trades
// ---------------------------------------------------------------------------

describe('calculateMetrics — zero trades', () => {
  it('returns safe zero defaults when trades array is empty', () => {
    const metrics = calculateMetrics([], [], 10_000);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.totalReturn).toBe(0);
    expect(metrics.totalReturnPercent).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.maxDrawdownPercent).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.sortinoRatio).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.avgWin).toBe(0);
    expect(metrics.avgLoss).toBe(0);
    expect(metrics.expectancy).toBe(0);
    expect(metrics.largestWin).toBe(0);
    expect(metrics.largestLoss).toBe(0);
    expect(metrics.exposureTime).toBe(0);
    expect(metrics.totalFees).toBe(0);
    expect(metrics.totalSlippage).toBe(0);
  });

  it('returns safe zeros when only OPEN trades exist (no close trades)', () => {
    const openOnly: Trade[] = [
      { id: 'p1', symbol: 'BTC/USDT', action: 'OPEN_LONG', price: 10_000, amount: 0.5, timestamp: 1000, balanceAfter: 5_000 },
    ];
    const metrics = calculateMetrics(openOnly, [], 10_000);
    expect(metrics.totalTrades).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — totalReturn / totalReturnPercent
// ---------------------------------------------------------------------------

describe('calculateMetrics — totalReturn / totalReturnPercent', () => {
  beforeEach(() => resetCounters());

  it('calculates positive total return from equity curve', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_020]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalReturn).toBeCloseTo(20, 6);
    expect(metrics.totalReturnPercent).toBeCloseTo(0.2, 6);
  });

  it('calculates negative total return (loss scenario)', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 80, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_980]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalReturn).toBeCloseTo(-20, 6);
    expect(metrics.totalReturnPercent).toBeCloseTo(-0.2, 6);
  });

  it('returns zero totalReturn when equity is flat', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 100, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalReturn).toBeCloseTo(0, 6);
    expect(metrics.totalReturnPercent).toBeCloseTo(0, 6);
  });

  it('uses last equity point for final equity value', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 130, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_010], [4000, 10_030]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalReturn).toBeCloseTo(30, 6);
  });

  it('uses initialCapital when equity array is empty', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 });
    const metrics = calculateMetrics(trades, [], 10_000);
    // finalEquity defaults to initialCapital → totalReturn = 0
    expect(metrics.totalReturn).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — maxDrawdown / maxDrawdownPercent
// ---------------------------------------------------------------------------

describe('calculateMetrics — maxDrawdown / maxDrawdownPercent', () => {
  beforeEach(() => resetCounters());

  it('returns zero drawdown for monotonically increasing equity', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [1500, 10_200], [2000, 10_500]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.maxDrawdown).toBeCloseTo(0, 6);
    expect(metrics.maxDrawdownPercent).toBeCloseTo(0, 6);
  });

  it('calculates single drawdown correctly', () => {
    // peak = 10200, trough = 9800 → drawdown = 400 → 400/10200 ≈ 3.92%
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 3000 });
    const equity = makeEquity([[1000, 10_000], [1500, 10_200], [2000, 9_800], [3000, 10_100]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.maxDrawdown).toBeCloseTo(400, 4);
    expect(metrics.maxDrawdownPercent).toBeCloseTo((400 / 10_200) * 100, 4);
  });

  it('picks the largest of multiple drawdowns', () => {
    // First dip: 10000→9500 = 500 (5%)
    // Second dip from 11000→10000 = 1000 (9.09%) — this is the max
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 95, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 95, exitPrice: 100, entryTime: 3000, exitTime: 5000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [1500, 9_500], [2000, 10_000],
      [2500, 11_000], [3000, 10_000], [4000, 11_500],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.maxDrawdown).toBeCloseTo(1_000, 4);
  });

  it('considers initialCapital as starting peak', () => {
    // If equity starts below initial capital, that's a drawdown from the start
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 9_800], [2000, 9_900]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    // peak starts at initialCapital=10000; first point 9800 → drawdown = 200 (2%)
    expect(metrics.maxDrawdown).toBeCloseTo(200, 4);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — winRate
// ---------------------------------------------------------------------------

describe('calculateMetrics — winRate', () => {
  beforeEach(() => resetCounters());

  it('returns 100% when all trades are winning', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 120, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_010], [4000, 10_020]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBeCloseTo(100, 6);
  });

  it('returns 0% when all trades are losing', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 90, exitPrice: 80, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 9_990], [3000, 9_990], [4000, 9_980]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBeCloseTo(0, 6);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(2);
  });

  it('returns 50% for equal wins and losses', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 100, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_010], [4000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBeCloseTo(50, 6);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(1);
  });

  it('single winning trade = 100% win rate', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBe(100);
    expect(metrics.totalTrades).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — profitFactor
// ---------------------------------------------------------------------------

describe('calculateMetrics — profitFactor', () => {
  beforeEach(() => resetCounters());

  it('calculates profit factor correctly', () => {
    // grossProfit = 20, grossLoss = 10 → PF = 2
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 120, exitPrice: 110, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.profitFactor).toBeCloseTo(2, 6);
  });

  it('returns Infinity when there are no losses (all winners)', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_020]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.profitFactor).toBe(Infinity);
  });

  it('returns 0 when all trades are losing and gross profit is zero', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_990]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.profitFactor).toBe(0);
  });

  it('returns 0 when no close trades', () => {
    const metrics = calculateMetrics([], [], 10_000);
    expect(metrics.profitFactor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — avgWin / avgLoss
// ---------------------------------------------------------------------------

describe('calculateMetrics — avgWin / avgLoss', () => {
  beforeEach(() => resetCounters());

  it('calculates avgWin correctly', () => {
    // wins: +20, +30 → avg = 25
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 130, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_050]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgWin).toBeCloseTo(25, 6);
  });

  it('calculates avgLoss correctly (absolute value)', () => {
    // losses: -10, -20 → avg = 15
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 80, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 9_990], [3000, 9_990], [4000, 9_970]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgLoss).toBeCloseTo(15, 6);
  });

  it('returns 0 avgWin when no winning trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_990]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgWin).toBe(0);
  });

  it('returns 0 avgLoss when no losing trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgLoss).toBe(0);
  });

  it('calculates avgWin using only winning trades count (not total trades)', () => {
    // 2 wins (+20, +30) and 1 loss (-10) → 3 total trades but winCount=2
    // avgWin correct: (20+30)/2 = 25  (NOT (20+30)/3 = 16.67)
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 130, entryTime: 3000, exitTime: 4000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 5000, exitTime: 6000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_020], [3000, 10_020],
      [4000, 10_050], [5000, 10_050], [6000, 10_040],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(2);
    expect(metrics.avgWin).toBeCloseTo(25, 6); // (20+30)/2 = 25, not 16.67
  });

  it('calculates avgLoss using only losing trades count (not total trades)', () => {
    // 1 win (+20) and 2 losses (-10, -20) → 3 total trades but lossCount=2
    // avgLoss correct: (10+20)/2 = 15  (NOT (10+20)/3 = 10)
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 3000, exitTime: 4000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 80, entryTime: 5000, exitTime: 6000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_020], [3000, 10_020],
      [4000, 10_010], [5000, 10_010], [6000, 9_990],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.losingTrades).toBe(2);
    expect(metrics.avgLoss).toBeCloseTo(15, 6); // (10+20)/2 = 15, not 10
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — expectancy
// ---------------------------------------------------------------------------

describe('calculateMetrics — expectancy', () => {
  beforeEach(() => resetCounters());

  it('calculates positive expectancy (total return / total trades)', () => {
    // totalReturn from equity: 20; 2 trades → expectancy = 10
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 115, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 105, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_015], [3000, 10_015], [4000, 10_020]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.expectancy).toBeCloseTo(10, 6);
  });

  it('returns 0 expectancy when no close trades', () => {
    const metrics = calculateMetrics([], [], 10_000);
    expect(metrics.expectancy).toBe(0);
  });

  it('calculates expectancy using total trades count (not just winners)', () => {
    // 2 wins (+15, +5) and 1 loss (-10) → totalReturn=10, totalTrades=3, winCount=2
    // Correct expectancy: 10/3 ≈ 3.33  (NOT 10/2 = 5)
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 115, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 105, entryTime: 3000, exitTime: 4000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 5000, exitTime: 6000 }),
    ];
    // totalReturn is derived from equity: 10000 + 15 + 5 - 10 = 10010
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_015], [3000, 10_015],
      [4000, 10_020], [5000, 10_020], [6000, 10_010],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(2);
    // totalReturn = 10010 - 10000 = 10
    // expectancy = 10 / 3 ≈ 3.33, not 10 / 2 = 5
    expect(metrics.expectancy).toBeCloseTo(10 / 3, 4);
    expect(metrics.expectancy).not.toBeCloseTo(5, 1); // would be 5 if dividing by winCount
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — largestWin / largestLoss
// ---------------------------------------------------------------------------

describe('calculateMetrics — largestWin / largestLoss', () => {
  beforeEach(() => resetCounters());

  it('identifies the largest winning trade', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 115, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 130, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_015], [3000, 10_015], [4000, 10_045]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.largestWin).toBeCloseTo(30, 6);
  });

  it('identifies the largest losing trade (most negative)', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 70, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 9_990], [3000, 9_990], [4000, 9_960]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.largestLoss).toBeCloseTo(-30, 6);
  });

  it('returns 0 largestWin when no winning trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_990]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.largestWin).toBe(0);
  });

  it('returns 0 largestLoss when no losing trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.largestLoss).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — sharpeRatio
// ---------------------------------------------------------------------------

describe('calculateMetrics — sharpeRatio', () => {
  beforeEach(() => resetCounters());

  it('returns 0 when equity has fewer than 2 points', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sharpeRatio).toBe(0);
  });

  it('returns 0 when all returns are identical (zero std dev)', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 3000, exitTime: 4000 }),
    ];
    // Flat equity → zero variance in returns
    const equity = makeEquity([[1000, 10_000], [2000, 10_000], [3000, 10_000], [4000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sharpeRatio).toBe(0);
  });

  it('is positive for consistently profitable equity curve', () => {
    resetCounters();
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 120, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_100], [3000, 10_200], [4000, 10_300],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
  });

  it('applies the annualization factor for the given timeframe', () => {
    resetCounters();
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 105, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 108, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_005], [3000, 10_010], [4000, 10_018]]);

    const sharpeDefault = calculateMetrics(trades, equity, 10_000).sharpeRatio;
    const sharpe1d = calculateMetrics(trades, equity, 10_000, '1d').sharpeRatio;

    // Both use 365 for '1d' but default uses 252 → they should differ
    expect(sharpeDefault).not.toBeCloseTo(sharpe1d, 3);
  });

  it('calculates exact Sharpe ratio value using (mean/stdDev)*sqrt(factor)', () => {
    // Equity with known variability so we can verify the exact annualization formula.
    // Equity: 10000, 10100, 10050, 10200, 10150, 10300
    // Returns: +1%, -0.495%, +1.4925%, -0.4902%, +1.4778%
    // Expected: annualizedReturn = mean*252, annualizedStdDev = stdDev*sqrt(252)
    // Sharpe = annualizedReturn / annualizedStdDev = (mean/stdDev) * sqrt(252)
    resetCounters();
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000],
      [2000, 10_100],
      [3000, 10_050],
      [4000, 10_200],
      [5000, 10_150],
      [6000, 10_300],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    // Manually compute expected Sharpe with correct formula
    const returns = [
      (10_100 - 10_000) / 10_000,
      (10_050 - 10_100) / 10_100,
      (10_200 - 10_050) / 10_050,
      (10_150 - 10_200) / 10_200,
      (10_300 - 10_150) / 10_150,
    ];
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    const expectedSharpe = (mean / stdDev) * Math.sqrt(252);

    // The correct Sharpe should be close to the expected value (around 9.3)
    // If annualization uses / instead of * for stdDev, result would be 252x larger (~2354)
    expect(metrics.sharpeRatio).toBeCloseTo(expectedSharpe, 3);
    expect(metrics.sharpeRatio).toBeLessThan(100); // A 252x mutation would produce ~2354
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — sortinoRatio
// ---------------------------------------------------------------------------

describe('calculateMetrics — sortinoRatio', () => {
  beforeEach(() => resetCounters());

  it('returns 0 when equity has fewer than 2 points', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sortinoRatio).toBe(0);
  });

  it('is capped at 10 when there are no negative returns and mean > 0', () => {
    resetCounters();
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 120, entryTime: 3000, exitTime: 4000 }),
    ];
    // Strictly increasing equity — no negative returns
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_100], [3000, 10_200], [4000, 10_300],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sortinoRatio).toBe(10);
  });

  it('is positive for profitable equity with some down days', () => {
    resetCounters();
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 110, exitPrice: 115, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [1500, 10_050], [2000, 9_980], [2500, 10_100], [3000, 10_150], [4000, 10_200],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.sortinoRatio).toBeGreaterThan(0);
  });

  it('uses downside deviation (not full std dev) — Sortino > Sharpe for skewed returns', () => {
    // Returns: +1%, -0.5%, +2%, -0.3%, +1.5%, +0.8%
    // With only 2 negative returns out of 6, downside deviation < full std dev
    // so Sortino should be meaningfully higher than Sharpe ratio.
    // Correct Sortino ≈ 28.9; if wrong denominator (full std dev) used → ≈ 12.1
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 7000 });
    const equity = makeEquity([
      [1000, 10_000],
      [2000, 10_100],
      [3000, 10_049.5],
      [4000, 10_250.49],
      [5000, 10_219.74],
      [6000, 10_373.03],
      [7000, 10_456.02],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    // Manually compute expected Sortino (using downside deviation only)
    const returns = [
      (10_100 - 10_000) / 10_000,
      (10_049.5 - 10_100) / 10_100,
      (10_250.49 - 10_049.5) / 10_049.5,
      (10_219.74 - 10_250.49) / 10_250.49,
      (10_373.03 - 10_219.74) / 10_219.74,
      (10_456.02 - 10_373.03) / 10_373.03,
    ];
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    const downsideVariance = negativeReturns.reduce((s, r) => s + r * r, 0) / negativeReturns.length;
    const downsideDeviation = Math.sqrt(downsideVariance);
    const expectedSortino = (mean / downsideDeviation) * Math.sqrt(252);

    // Correct sortino should be ~28.9 (not ~12.1 which is Sharpe-like using full std dev)
    expect(metrics.sortinoRatio).toBeCloseTo(expectedSortino, 2);
    expect(metrics.sortinoRatio).toBeGreaterThan(20); // Guards against using full std dev (~12)
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — avgTradeDuration
// ---------------------------------------------------------------------------

describe('calculateMetrics — avgTradeDuration', () => {
  beforeEach(() => resetCounters());

  it('calculates average duration of matched open/close pairs', () => {
    // Trade 1: 2000ms, Trade 2: 4000ms → avg = 3000
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 3000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 5000, exitTime: 9000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [3000, 10_010], [5000, 10_010], [9000, 10_020]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgTradeDuration).toBeCloseTo(3_000, 6);
  });

  it('returns 0 when no trades have matching open/close pairs', () => {
    const metrics = calculateMetrics([], [], 10_000);
    expect(metrics.avgTradeDuration).toBe(0);
  });

  it('returns 0 for a trade opened and closed at the same timestamp', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 100, entryTime: 1000, exitTime: 1000 });
    const equity = makeEquity([[1000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.avgTradeDuration).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — exposureTime
// ---------------------------------------------------------------------------

describe('calculateMetrics — exposureTime', () => {
  beforeEach(() => resetCounters());

  it('returns 0 when there are no trades', () => {
    const metrics = calculateMetrics([], makeEquity([[1000, 10_000], [5000, 10_000]]), 10_000);
    expect(metrics.exposureTime).toBe(0);
  });

  it('returns 0 when equity has fewer than 2 points', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.exposureTime).toBe(0);
  });

  it('returns 100% when fully invested for the entire window', () => {
    // total window: 1000ms, position held for 1000ms → 100%
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.exposureTime).toBeCloseTo(100, 6);
  });

  it('returns 50% when in market for half the window', () => {
    // total: 4000ms; position: 2000ms (50%)
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 2000, exitTime: 4000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_000], [4000, 10_010], [5000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.exposureTime).toBeCloseTo(50, 6);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — totalFees / totalSlippage
// ---------------------------------------------------------------------------

describe('calculateMetrics — totalFees / totalSlippage', () => {
  beforeEach(() => resetCounters());

  it('sums fees across all trades (open and close)', () => {
    // open fee = 1, close fee = 0.5 → total = 1.5
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000, fee: 1.5 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_008.5]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalFees).toBeCloseTo(1.5, 6); // 0.75 + 0.75 (split 50/50 in helper)
  });

  it('returns 0 totalFees when no fees are set on trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalFees).toBe(0);
  });

  it('sums slippage from close trades', () => {
    const [open, close] = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000, slippage: 0.5 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics([open, close], equity, 10_000);
    expect(metrics.totalSlippage).toBeCloseTo(0.5, 6);
  });

  it('returns 0 totalSlippage when no slippage set', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalSlippage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — short trades
// ---------------------------------------------------------------------------

describe('calculateMetrics — short trades', () => {
  beforeEach(() => resetCounters());

  it('records a profitable short trade as a win', () => {
    // Short: entry 100, exit 90 → profit = 10
    const trades = makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBeCloseTo(100, 6);
    expect(metrics.winningTrades).toBe(1);
  });

  it('records a losing short trade as a loss', () => {
    // Short: entry 100, exit 110 → loss = -10
    const trades = makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_990]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.winRate).toBeCloseTo(0, 6);
    expect(metrics.losingTrades).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — totalTrades / winningTrades / losingTrades counts
// ---------------------------------------------------------------------------

describe('calculateMetrics — trade count accuracy', () => {
  beforeEach(() => resetCounters());

  it('only counts CLOSE trades in totalTrades', () => {
    // 2 round trips = 2 open + 2 close → totalTrades should be 2
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_010], [4000, 10_000]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalTrades).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateEquityCurve
// ---------------------------------------------------------------------------

describe('generateEquityCurve', () => {
  it('generates equity curve with correct length', () => {
    const timestamps = [1000, 2000, 3000];
    const values = [10_000, 10_500, 10_200];
    const curve = generateEquityCurve(timestamps, values, 10_000);
    expect(curve).toHaveLength(3);
  });

  it('sets equity values correctly', () => {
    const timestamps = [1000, 2000, 3000];
    const values = [10_000, 10_500, 10_200];
    const curve = generateEquityCurve(timestamps, values, 10_000);
    expect(curve[0].equity).toBe(10_000);
    expect(curve[1].equity).toBe(10_500);
    expect(curve[2].equity).toBe(10_200);
  });

  it('sets timestamps correctly', () => {
    const timestamps = [1000, 2000];
    const values = [10_000, 11_000];
    const curve = generateEquityCurve(timestamps, values, 10_000);
    expect(curve[0].timestamp).toBe(1000);
    expect(curve[1].timestamp).toBe(2000);
  });

  it('calculates zero drawdown when equity is monotonically increasing', () => {
    const curve = generateEquityCurve([1000, 2000, 3000], [10_000, 11_000, 12_000], 10_000);
    curve.forEach(p => expect(p.drawdown).toBeCloseTo(0, 6));
  });

  it('calculates drawdown correctly after a peak', () => {
    // peak = 11000 at index 1; trough = 10000 at index 2 → drawdown = 1000/11000 ≈ 9.09%
    const curve = generateEquityCurve([1000, 2000, 3000], [10_000, 11_000, 10_000], 10_000);
    expect(curve[2].drawdown).toBeCloseTo((1000 / 11_000) * 100, 4);
  });

  it('tracks peak across multiple bars correctly', () => {
    // 10000, 12000 (peak), 11000 (dd from 12k), 13000 (new peak), 12000 (dd from 13k)
    const values = [10_000, 12_000, 11_000, 13_000, 12_000];
    const ts = [1, 2, 3, 4, 5];
    const curve = generateEquityCurve(ts, values, 10_000);
    expect(curve[2].drawdown).toBeCloseTo((1_000 / 12_000) * 100, 4);
    expect(curve[4].drawdown).toBeCloseTo((1_000 / 13_000) * 100, 4);
  });

  it('throws when timestamps and values have different lengths', () => {
    expect(() => generateEquityCurve([1000, 2000], [10_000], 10_000)).toThrow(
      'Timestamps and equity values must have the same length'
    );
  });

  it('returns empty array for empty input', () => {
    const curve = generateEquityCurve([], [], 10_000);
    expect(curve).toHaveLength(0);
  });

  it('uses initialCapital as the starting peak for drawdown', () => {
    // If first equity value is below initial capital → drawdown from the start
    const curve = generateEquityCurve([1000], [9_500], 10_000);
    // peak starts at initialCapital (10000), so 9500 is a 5% drawdown
    expect(curve[0].drawdown).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------
// calculateRollingMetrics
// ---------------------------------------------------------------------------

describe('calculateRollingMetrics', () => {
  beforeEach(() => resetCounters());

  it('returns empty arrays when equity is empty', () => {
    const rolling = calculateRollingMetrics([], [], 10_000);
    expect(rolling.timestamps).toHaveLength(0);
    expect(rolling.cumulativeReturn).toHaveLength(0);
    expect(rolling.drawdown).toHaveLength(0);
    expect(rolling.rollingSharpe).toHaveLength(0);
    expect(rolling.cumulativeWinRate).toHaveLength(0);
    expect(rolling.cumulativeProfitFactor).toHaveLength(0);
  });

  it('produces arrays of same length as equity', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_020]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    expect(rolling.timestamps).toHaveLength(3);
    expect(rolling.cumulativeReturn).toHaveLength(3);
    expect(rolling.drawdown).toHaveLength(3);
    expect(rolling.rollingSharpe).toHaveLength(3);
    expect(rolling.cumulativeWinRate).toHaveLength(3);
    expect(rolling.cumulativeProfitFactor).toHaveLength(3);
  });

  it('cumulativeReturn starts at 0 and increases with equity growth', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 11_000]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    expect(rolling.cumulativeReturn[0]).toBeCloseTo(0, 6);
    expect(rolling.cumulativeReturn[1]).toBeCloseTo(10, 6); // (11000-10000)/10000 * 100 = 10%
  });

  it('drawdown array carries over from equity curve', () => {
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 1000, exitTime: 3000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_500], [3000, 10_200]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    // Drawdown at index 2: peak=10500, equity=10200 → 300/10500 ≈ 2.857%
    expect(rolling.drawdown[2]).toBeCloseTo((300 / 10_500) * 100, 4);
  });

  it('cumulativeWinRate starts at 0 then updates when a close trade occurs', () => {
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_010], [3000, 10_010]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    // Before any close trade: 0
    expect(rolling.cumulativeWinRate[0]).toBeCloseTo(0, 6);
    // After the close trade at t=2000: 1 win / 1 total = 100%
    expect(rolling.cumulativeWinRate[1]).toBeCloseTo(100, 6);
  });

  it('cumulativeProfitFactor is 0 before any close trade', () => {
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 2000, exitTime: 3000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_000], [3000, 10_010]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    expect(rolling.cumulativeProfitFactor[0]).toBe(0);
  });

  it('cumulativeProfitFactor is capped at 10 when all trades are winners', () => {
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_020]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    // No losses → capped at 10
    expect(rolling.cumulativeProfitFactor[1]).toBe(10);
  });

  it('rollingSharpe is 0 for first 2 bars', () => {
    resetCounters();
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 3000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_005], [3000, 10_010]]);
    const rolling = calculateRollingMetrics(trades, equity, 10_000);
    expect(rolling.rollingSharpe[0]).toBe(0);
    expect(rolling.rollingSharpe[1]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateRiskMetrics (exported helper)
// ---------------------------------------------------------------------------

describe('calculateRiskMetrics', () => {
  beforeEach(() => resetCounters());

  it('returns calmarRatio, ulcerIndex, riskRewardRatio', () => {
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_010]]);
    const risk = calculateRiskMetrics(trades, equity);
    expect(typeof risk.calmarRatio).toBe('number');
    expect(typeof risk.ulcerIndex).toBe('number');
    expect(typeof risk.riskRewardRatio).toBe('number');
  });

  it('ulcerIndex returns 0 for flat equity', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 100, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_000]]);
    const risk = calculateRiskMetrics(trades, equity);
    expect(risk.ulcerIndex).toBeCloseTo(0, 6);
  });

  it('riskRewardRatio is Infinity when there are no losses', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_020]]);
    const risk = calculateRiskMetrics(trades, equity);
    expect(risk.riskRewardRatio).toBe(Infinity);
  });

  it('riskRewardRatio is 0 when there are no winning trades', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 80, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 9_980]]);
    const risk = calculateRiskMetrics(trades, equity);
    expect(risk.riskRewardRatio).toBe(0);
  });

  it('calmarRatio is 0 when max drawdown is zero', () => {
    const trades = makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 1000, exitTime: 2000 });
    // Monotonically increasing → no drawdown
    const equity = makeEquity([[1000, 10_000], [2000, 10_500], [3000, 11_000]]);
    const risk = calculateRiskMetrics(trades, equity);
    expect(risk.calmarRatio).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateMetrics — long/short PnL breakdown
// ---------------------------------------------------------------------------

describe('calculateMetrics — long/short PnL breakdown', () => {
  beforeEach(() => resetCounters());

  it('all zero when no trades', () => {
    const metrics = calculateMetrics([], [], 10_000);
    expect(metrics.longPnl).toBe(0);
    expect(metrics.shortPnl).toBe(0);
    expect(metrics.longTrades).toBe(0);
    expect(metrics.shortTrades).toBe(0);
    expect(metrics.longWinRate).toBe(0);
    expect(metrics.shortWinRate).toBe(0);
  });

  it('only long trades — short fields are zero', () => {
    // Two winning long trades: +20 and +10
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_030]]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    expect(metrics.longPnl).toBeCloseTo(30, 6);
    expect(metrics.longTrades).toBe(2);
    expect(metrics.longWinRate).toBeCloseTo(100, 6);

    expect(metrics.shortPnl).toBe(0);
    expect(metrics.shortTrades).toBe(0);
    expect(metrics.shortWinRate).toBe(0);
  });

  it('only short trades — long fields are zero', () => {
    // Two winning short trades: entry 100, exit 80 → +20 each
    const trades = [
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 80, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 85, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_035]]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    expect(metrics.shortPnl).toBeCloseTo(35, 6);
    expect(metrics.shortTrades).toBe(2);
    expect(metrics.shortWinRate).toBeCloseTo(100, 6);

    expect(metrics.longPnl).toBe(0);
    expect(metrics.longTrades).toBe(0);
    expect(metrics.longWinRate).toBe(0);
  });

  it('mixed long and short — both sides calculated independently', () => {
    // Long win: +20, Short win: +15
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 85, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_035]]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    expect(metrics.longPnl).toBeCloseTo(20, 6);
    expect(metrics.longTrades).toBe(1);
    expect(metrics.longWinRate).toBeCloseTo(100, 6);

    expect(metrics.shortPnl).toBeCloseTo(15, 6);
    expect(metrics.shortTrades).toBe(1);
    expect(metrics.shortWinRate).toBeCloseTo(100, 6);
  });

  it('all winning longs, all losing shorts — longWinRate=100, shortWinRate=0', () => {
    // Long win: +20, Short loss: -10 (entry 100, exit 110 on short = loss)
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 110, entryTime: 3000, exitTime: 4000 }),
    ];
    const equity = makeEquity([[1000, 10_000], [2000, 10_020], [3000, 10_020], [4000, 10_010]]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    expect(metrics.longWinRate).toBeCloseTo(100, 6);
    expect(metrics.longTrades).toBe(1);
    expect(metrics.longPnl).toBeCloseTo(20, 6);

    expect(metrics.shortWinRate).toBeCloseTo(0, 6);
    expect(metrics.shortTrades).toBe(1);
    expect(metrics.shortPnl).toBeCloseTo(-10, 6);
  });

  it('mixed win/loss on both sides — calculates partial win rates correctly', () => {
    // 2 longs: win +20, loss -10 → longWinRate = 50%, longPnl = 10
    // 2 shorts: win +15, loss -5 → shortWinRate = 50%, shortPnl = 10
    const trades = [
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 120, entryTime: 1000, exitTime: 2000 }),
      ...makeTradePair({ side: 'long', amount: 1, entryPrice: 100, exitPrice: 90, entryTime: 3000, exitTime: 4000 }),
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 85, entryTime: 5000, exitTime: 6000 }),
      ...makeTradePair({ side: 'short', amount: 1, entryPrice: 100, exitPrice: 105, entryTime: 7000, exitTime: 8000 }),
    ];
    const equity = makeEquity([
      [1000, 10_000], [2000, 10_020], [3000, 10_020],
      [4000, 10_010], [5000, 10_010], [6000, 10_025],
      [7000, 10_025], [8000, 10_020],
    ]);
    const metrics = calculateMetrics(trades, equity, 10_000);

    expect(metrics.longTrades).toBe(2);
    expect(metrics.longPnl).toBeCloseTo(10, 6);
    expect(metrics.longWinRate).toBeCloseTo(50, 6);

    expect(metrics.shortTrades).toBe(2);
    expect(metrics.shortPnl).toBeCloseTo(10, 6);
    expect(metrics.shortWinRate).toBeCloseTo(50, 6);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — very large/small values
// ---------------------------------------------------------------------------

describe('edge cases — extreme values', () => {
  beforeEach(() => resetCounters());

  it('handles very small PnL values without floating point issues', () => {
    const trades = makeTradePair({ side: 'long', amount: 0.0001, entryPrice: 1, exitPrice: 1.001, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 10_000], [2000, 10_000.0001]]);
    const metrics = calculateMetrics(trades, equity, 10_000);
    expect(metrics.totalTrades).toBe(1);
    expect(metrics.winningTrades).toBe(1);
  });

  it('handles very large position sizes', () => {
    const trades = makeTradePair({ side: 'long', amount: 1_000_000, entryPrice: 50_000, exitPrice: 51_000, entryTime: 1000, exitTime: 2000 });
    const equity = makeEquity([[1000, 1_000_000_000], [2000, 2_000_000_000]]);
    const metrics = calculateMetrics(trades, equity, 1_000_000_000);
    expect(metrics.totalTrades).toBe(1);
    expect(metrics.winningTrades).toBe(1);
    expect(typeof metrics.sharpeRatio).toBe('number');
  });
});
