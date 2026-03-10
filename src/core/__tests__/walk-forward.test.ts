/**
 * Unit tests for walk-forward testing logic.
 *
 * The train/test split calculation, OOS degradation formula, and robustness
 * assessment are embedded inside runWalkForwardTest() which requires DB and
 * network access. We test the same pure formulas here as self-contained
 * functions that mirror the implementation exactly.
 *
 * We also test the exported formatDuration utility.
 */

import { describe, it, expect } from 'vitest';
import { formatDuration } from '../walk-forward.js';

// ============================================================================
// Helpers — pure reimplementations of the private walk-forward formulas
// ============================================================================

/**
 * Calculate the train/test split timestamps.
 * Mirrors the logic inside runWalkForwardTest:
 *   trainDuration = floor(totalDuration * trainRatio)
 *   trainEndDate  = startDate + trainDuration
 */
function calculateSplit(
  startDate: number,
  endDate: number,
  trainRatio: number,
): { trainEnd: number; testStart: number } {
  const totalDuration = endDate - startDate;
  const trainDuration = Math.floor(totalDuration * trainRatio);
  const trainEnd = startDate + trainDuration;
  return { trainEnd, testStart: trainEnd };
}

/**
 * Calculate OOS degradation percentage.
 * Mirrors the formula in runWalkForwardTest:
 *   oosDegrade = trainSharpe !== 0
 *     ? ((trainSharpe - testSharpe) / Math.abs(trainSharpe)) * 100
 *     : 0
 */
function calculateOOSDegrade(trainSharpe: number, testSharpe: number): number {
  if (trainSharpe === 0) return 0;
  return ((trainSharpe - testSharpe) / Math.abs(trainSharpe)) * 100;
}

/**
 * Assess robustness.
 * Mirrors the condition in runWalkForwardTest:
 *   isRobust = oosDegrade < oosThreshold && testSharpe > minTestSharpe
 */
function assessRobustness(
  oosDegrade: number,
  testSharpe: number,
  oosThreshold = 30,
  minTestSharpe = 0.5,
): boolean {
  return oosDegrade < oosThreshold && testSharpe > minTestSharpe;
}

// ============================================================================
// Timestamp helpers
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;

// ============================================================================
// Tests — train/test split
// ============================================================================

describe('Walk-Forward — train/test split calculation', () => {
  it('70/30 split: trainEnd is 70% of the way from start to end', () => {
    const start = 0;
    const end = 100_000;
    const { trainEnd } = calculateSplit(start, end, 0.7);
    expect(trainEnd).toBe(70_000);
  });

  it('70/30 split: testStart equals trainEnd (continuous)', () => {
    const { trainEnd, testStart } = calculateSplit(0, 100_000, 0.7);
    expect(testStart).toBe(trainEnd);
  });

  it('70/30 split on a 1-year range produces correct boundaries', () => {
    const start = 0;
    const end = YEAR_MS; // 365 days
    const { trainEnd } = calculateSplit(start, end, 0.7);

    const trainDays = (trainEnd - start) / DAY_MS;
    const testDays = (end - trainEnd) / DAY_MS;

    // 70% of 365 days = 255.5 days; floor() applied to milliseconds not days,
    // so trainDays = floor(365 * 0.7 * DAY_MS) / DAY_MS = floor(255.5 * DAY_MS) / DAY_MS = 255.5
    // trainDays ≈ 255.5, testDays ≈ 109.5
    expect(trainDays).toBeGreaterThan(255);
    expect(trainDays).toBeLessThan(256);
    expect(testDays).toBeGreaterThan(109);
    expect(testDays).toBeLessThan(111);
  });

  it('50/50 split divides range in half', () => {
    const start = 1_000_000;
    const end = 3_000_000;
    const { trainEnd } = calculateSplit(start, end, 0.5);
    expect(trainEnd).toBe(2_000_000);
  });

  it('train period covers exactly trainRatio fraction of total range', () => {
    const start = 1000;
    const end = 10000;
    const ratio = 0.7;
    const { trainEnd } = calculateSplit(start, end, ratio);
    const trainFraction = (trainEnd - start) / (end - start);
    expect(trainFraction).toBeCloseTo(ratio, 6);
  });

  it('test period covers the remainder of the range', () => {
    const start = 0;
    const end = 1_000_000;
    const { trainEnd } = calculateSplit(start, end, 0.7);
    const testDuration = end - trainEnd;
    const totalDuration = end - start;
    const testFraction = testDuration / totalDuration;
    expect(testFraction).toBeCloseTo(0.3, 6);
  });

  it('floor() ensures integer timestamp boundary', () => {
    // totalDuration = 7, trainRatio = 0.7 → trainDuration = floor(4.9) = 4
    const { trainEnd } = calculateSplit(0, 7, 0.7);
    expect(trainEnd).toBe(4);
    expect(Number.isInteger(trainEnd)).toBe(true);
  });
});

// ============================================================================
// Tests — OOS degradation formula
// ============================================================================

describe('Walk-Forward — OOS degradation calculation', () => {
  it('zero degradation when train and test Sharpe are equal', () => {
    expect(calculateOOSDegrade(1.0, 1.0)).toBeCloseTo(0, 10);
  });

  it('positive degradation when test is worse than train', () => {
    // (1.0 - 0.5) / |1.0| * 100 = 50%
    expect(calculateOOSDegrade(1.0, 0.5)).toBeCloseTo(50, 8);
  });

  it('negative degradation when test exceeds train (improvement)', () => {
    // (1.0 - 1.5) / |1.0| * 100 = -50%
    expect(calculateOOSDegrade(1.0, 1.5)).toBeCloseTo(-50, 8);
  });

  it('uses absolute value of trainSharpe in denominator', () => {
    // trainSharpe = -1.0, testSharpe = -0.5
    // degrade = (-1.0 - (-0.5)) / |-1.0| * 100 = (-0.5) / 1.0 * 100 = -50%
    const degrade = calculateOOSDegrade(-1.0, -0.5);
    expect(degrade).toBeCloseTo(-50, 8);
  });

  it('returns 0 when trainSharpe is 0 (avoid division by zero)', () => {
    expect(calculateOOSDegrade(0, 1.5)).toBe(0);
    expect(calculateOOSDegrade(0, -0.5)).toBe(0);
    expect(calculateOOSDegrade(0, 0)).toBe(0);
  });

  it('100% degradation when test Sharpe drops to 0 from positive train', () => {
    // (1.0 - 0.0) / 1.0 * 100 = 100%
    expect(calculateOOSDegrade(1.0, 0)).toBeCloseTo(100, 8);
  });

  it('degradation > 100% when test Sharpe goes very negative', () => {
    // (1.0 - (-1.0)) / 1.0 * 100 = 200%
    expect(calculateOOSDegrade(1.0, -1.0)).toBeCloseTo(200, 8);
  });

  it('exact formula: (train - test) / |train| * 100', () => {
    // Numerical spot-check
    const train = 1.8;
    const test = 1.2;
    const expected = ((train - test) / Math.abs(train)) * 100;
    expect(calculateOOSDegrade(train, test)).toBeCloseTo(expected, 8);
  });
});

// ============================================================================
// Tests — robustness assessment
// ============================================================================

describe('Walk-Forward — robustness assessment', () => {
  it('is robust when degradation < threshold AND testSharpe > minTestSharpe', () => {
    // degrade=20% < 30%, testSharpe=0.8 > 0.5 → PASS
    expect(assessRobustness(20, 0.8)).toBe(true);
  });

  it('is NOT robust when degradation equals threshold (boundary: not < threshold)', () => {
    // degrade=30% is NOT < 30% → FAIL
    expect(assessRobustness(30, 0.8)).toBe(false);
  });

  it('is NOT robust when degradation exceeds threshold', () => {
    // degrade=35% > 30% → FAIL
    expect(assessRobustness(35, 0.8)).toBe(false);
  });

  it('is NOT robust when testSharpe equals minTestSharpe (boundary: not > minTestSharpe)', () => {
    // testSharpe=0.5 is NOT > 0.5 → FAIL
    expect(assessRobustness(20, 0.5)).toBe(false);
  });

  it('is NOT robust when testSharpe is below minTestSharpe', () => {
    // testSharpe=0.3 < 0.5 → FAIL
    expect(assessRobustness(20, 0.3)).toBe(false);
  });

  it('negative degradation (test beats train) is still robust if testSharpe is good', () => {
    // degrade=-10% < 30%, testSharpe=1.2 > 0.5 → PASS
    expect(assessRobustness(-10, 1.2)).toBe(true);
  });

  it('fails when BOTH conditions fail', () => {
    // degrade=40%, testSharpe=0.2 → FAIL
    expect(assessRobustness(40, 0.2)).toBe(false);
  });

  it('fails when degradation OK but testSharpe below min', () => {
    expect(assessRobustness(10, 0.1)).toBe(false);
  });

  it('fails when testSharpe OK but degradation too high', () => {
    expect(assessRobustness(50, 1.0)).toBe(false);
  });

  it('custom thresholds are respected', () => {
    // With oosThreshold=50, minTestSharpe=0.2
    expect(assessRobustness(40, 0.3, 50, 0.2)).toBe(true);
    // degrade=50% is NOT < 50 → FAIL
    expect(assessRobustness(50, 0.3, 50, 0.2)).toBe(false);
  });
});

// ============================================================================
// Tests — mapMetricToOptimizer (re-implemented; pure mapping logic)
// ============================================================================

describe('Walk-Forward — metric name mapping', () => {
  type OptimizeMetric = 'sharpeRatio' | 'totalReturn' | 'profitFactor' | 'sortino' | 'calmar';
  type OptimizerMetric = 'sharpeRatio' | 'totalReturnPercent' | 'profitFactor' | 'winRate' | 'composite';

  /**
   * Mirrors mapMetricToOptimizer() from walk-forward.ts.
   */
  function mapMetricToOptimizer(metric: OptimizeMetric): OptimizerMetric {
    const metricMap: Record<OptimizeMetric, OptimizerMetric> = {
      sharpeRatio: 'sharpeRatio',
      totalReturn: 'totalReturnPercent',
      profitFactor: 'profitFactor',
      sortino: 'sharpeRatio',   // Sharpe as proxy
      calmar: 'sharpeRatio',    // Sharpe as proxy
    };
    return metricMap[metric] ?? 'sharpeRatio';
  }

  it('sharpeRatio maps to sharpeRatio', () => {
    expect(mapMetricToOptimizer('sharpeRatio')).toBe('sharpeRatio');
  });

  it('totalReturn maps to totalReturnPercent', () => {
    expect(mapMetricToOptimizer('totalReturn')).toBe('totalReturnPercent');
  });

  it('profitFactor maps to profitFactor', () => {
    expect(mapMetricToOptimizer('profitFactor')).toBe('profitFactor');
  });

  it('sortino uses sharpeRatio as proxy', () => {
    expect(mapMetricToOptimizer('sortino')).toBe('sharpeRatio');
  });

  it('calmar uses sharpeRatio as proxy', () => {
    expect(mapMetricToOptimizer('calmar')).toBe('sharpeRatio');
  });
});

// ============================================================================
// Tests — exported formatDuration utility
// ============================================================================

describe('Walk-Forward — formatDuration (exported)', () => {
  it('formats duration of exactly 1 day', () => {
    const result = formatDuration(DAY_MS);
    expect(result).toBe('1d 0h');
  });

  it('formats duration of 2 days and 6 hours', () => {
    const result = formatDuration(2 * DAY_MS + 6 * 60 * 60 * 1000);
    expect(result).toBe('2d 6h');
  });

  it('formats sub-day durations as hours only', () => {
    const result = formatDuration(12 * 60 * 60 * 1000);
    expect(result).toBe('12h');
  });

  it('formats zero duration as 0h', () => {
    expect(formatDuration(0)).toBe('0h');
  });

  it('ignores minutes (only days and hours are shown)', () => {
    // 1 hour and 30 minutes → '1h'
    const result = formatDuration(60 * 60 * 1000 + 30 * 60 * 1000);
    expect(result).toBe('1h');
  });

  it('formats a 30-day period correctly', () => {
    const result = formatDuration(30 * DAY_MS);
    expect(result).toBe('30d 0h');
  });

  it('returns days format when days > 0', () => {
    const result = formatDuration(3 * DAY_MS + 5 * 60 * 60 * 1000);
    expect(result).toMatch(/^\d+d \d+h$/);
  });

  it('returns hours-only format when days === 0', () => {
    const result = formatDuration(18 * 60 * 60 * 1000);
    expect(result).toMatch(/^\d+h$/);
  });
});

// ============================================================================
// Tests — full walk-forward scenario (pure math verification)
// ============================================================================

describe('Walk-Forward — end-to-end scenario (pure math)', () => {
  it('typical scenario: good train, decent test → robust', () => {
    const startDate = 0;
    const endDate = YEAR_MS;
    const trainRatio = 0.7;

    const { trainEnd } = calculateSplit(startDate, endDate, trainRatio);

    // Simulate: optimization found Sharpe 1.5 on train, test gives 1.1
    const trainSharpe = 1.5;
    const testSharpe = 1.1;

    const oosDegrade = calculateOOSDegrade(trainSharpe, testSharpe);
    // Expected: (1.5 - 1.1) / 1.5 * 100 ≈ 26.67%
    expect(oosDegrade).toBeCloseTo(26.67, 1);

    // Train covers 70% of total
    expect((trainEnd - startDate) / (endDate - startDate)).toBeCloseTo(0.7, 6);

    // Robust: degrade 26.67% < 30%, testSharpe 1.1 > 0.5
    expect(assessRobustness(oosDegrade, testSharpe)).toBe(true);
  });

  it('overfitting scenario: great train, terrible test → not robust', () => {
    const trainSharpe = 3.0;
    const testSharpe = 0.1;

    const oosDegrade = calculateOOSDegrade(trainSharpe, testSharpe);
    // Expected: (3.0 - 0.1) / 3.0 * 100 ≈ 96.67%
    expect(oosDegrade).toBeCloseTo(96.67, 1);

    // Not robust: degrade > 30%
    expect(assessRobustness(oosDegrade, testSharpe)).toBe(false);
  });

  it('negative train Sharpe: degradation uses absolute value', () => {
    // Strategy lost money in train period but (less) in test
    const trainSharpe = -0.5;
    const testSharpe = -0.2;

    const oosDegrade = calculateOOSDegrade(trainSharpe, testSharpe);
    // (-0.5 - (-0.2)) / |-0.5| * 100 = -0.3 / 0.5 * 100 = -60%
    expect(oosDegrade).toBeCloseTo(-60, 8);

    // testSharpe = -0.2 < 0.5 → NOT robust despite low degradation
    expect(assessRobustness(oosDegrade, testSharpe)).toBe(false);
  });
});
