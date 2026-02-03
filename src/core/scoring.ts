/**
 * Strategy Robustness Scoring Module
 *
 * Calculates overall robustness scores for strategies based on multiple validation metrics:
 * - Walk-forward test results (out-of-sample performance)
 * - Multi-asset validation (generalizability)
 * - Optimization metrics (baseline performance)
 *
 * Formula:
 * score = (
 *   0.30 * normalize(sharpeRatio, 0, 3) +
 *   0.20 * (1 - oosDegrade / 100) +
 *   0.20 * (multiAssetPassRate) +
 *   0.15 * normalize(totalReturnPercent, 0, 100) +
 *   0.15 * (1 - maxDrawdownPercent / 30)
 * ) * 100
 */

import type { PerformanceMetrics } from './types.js';
import type { WalkForwardResult } from './walk-forward.js';
import type { MultiAssetResult } from './multi-asset-validation.js';

// ============================================================================
// Types
// ============================================================================

export interface ScoringInput {
  /**
   * Optimization metrics (baseline performance)
   */
  optimizationMetrics?: PerformanceMetrics;

  /**
   * Walk-forward test result
   */
  walkForwardResult?: WalkForwardResult;

  /**
   * Multi-asset validation result
   */
  multiAssetResult?: MultiAssetResult;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Normalize a value to 0-1 range
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Calculate overall robustness score (0-100)
 *
 * The score combines multiple factors:
 * - 30% Sharpe Ratio (risk-adjusted returns)
 * - 20% Walk-forward degradation (overfitting measure)
 * - 20% Multi-asset pass rate (generalizability)
 * - 15% Total return (absolute profitability)
 * - 15% Drawdown management (risk control)
 *
 * @param input - Scoring input with various validation results
 * @returns Score from 0 to 100 (higher is better)
 */
export function calculateRobustnessScore(input: ScoringInput): number {
  const {
    optimizationMetrics,
    walkForwardResult,
    multiAssetResult,
  } = input;

  let score = 0;

  // Component 1: Sharpe Ratio (30%)
  // Use test Sharpe if available, otherwise optimization Sharpe
  let sharpeRatio = 0;
  if (walkForwardResult) {
    sharpeRatio = walkForwardResult.testMetrics.sharpeRatio;
  } else if (optimizationMetrics) {
    sharpeRatio = optimizationMetrics.sharpeRatio;
  }
  const sharpeScore = normalize(sharpeRatio, 0, 3); // Sharpe of 3+ is excellent
  score += 0.30 * sharpeScore;

  // Component 2: Out-of-sample degradation (20%)
  // Lower degradation = better generalization
  let oosScore = 0;
  if (walkForwardResult) {
    const degradation = Math.abs(walkForwardResult.oosDegrade);
    oosScore = Math.max(0, 1 - degradation / 100); // 100% degradation = score 0
  } else {
    // If no walk-forward test, assume neutral score
    oosScore = 0.5;
  }
  score += 0.20 * oosScore;

  // Component 3: Multi-asset pass rate (20%)
  // Higher pass rate = better generalizability
  let multiAssetScore = 0;
  if (multiAssetResult) {
    multiAssetScore = multiAssetResult.passRate / 100; // Already in 0-100, normalize to 0-1
  } else {
    // If no multi-asset test, assume neutral score
    multiAssetScore = 0.5;
  }
  score += 0.20 * multiAssetScore;

  // Component 4: Total return (15%)
  // Use test return if available, otherwise optimization return
  let totalReturn = 0;
  if (walkForwardResult) {
    totalReturn = walkForwardResult.testMetrics.totalReturnPercent;
  } else if (optimizationMetrics) {
    totalReturn = optimizationMetrics.totalReturnPercent;
  }
  const returnScore = normalize(totalReturn, 0, 100); // 100%+ return is excellent
  score += 0.15 * returnScore;

  // Component 5: Drawdown management (15%)
  // Lower drawdown = better risk control
  let maxDrawdown = 0;
  if (walkForwardResult) {
    maxDrawdown = Math.abs(walkForwardResult.testMetrics.maxDrawdownPercent);
  } else if (optimizationMetrics) {
    maxDrawdown = Math.abs(optimizationMetrics.maxDrawdownPercent);
  }
  const drawdownScore = Math.max(0, 1 - maxDrawdown / 30); // 30%+ drawdown = score 0
  score += 0.15 * drawdownScore;

  // Convert to 0-100 scale
  return Math.round(score * 100);
}

/**
 * Determine if a strategy is "promising" based on quality criteria
 *
 * A strategy is promising if it meets ALL of the following criteria:
 * - Walk-forward OOS Sharpe > 0.5 (profitable on test data)
 * - OOS degradation < 30% (not heavily overfitted)
 * - Works on at least 2 major assets or 40%+ pass rate (generalizable)
 * - Has > 20 trades in test period (sufficient sample size)
 * - Max drawdown < 25% (manageable risk)
 *
 * @param input - Scoring input with various validation results
 * @returns True if strategy meets all promising criteria
 */
export function isStrategyPromising(input: ScoringInput): boolean {
  const { walkForwardResult, multiAssetResult } = input;

  // Criterion 1: Walk-forward OOS Sharpe > 0.5
  if (!walkForwardResult) {
    console.warn('Strategy missing walk-forward test - cannot determine if promising');
    return false;
  }

  const testSharpe = walkForwardResult.testMetrics.sharpeRatio;
  if (testSharpe < 0.5) {
    return false;
  }

  // Criterion 2: OOS degradation < 30%
  const degradation = Math.abs(walkForwardResult.oosDegrade);
  if (degradation >= 30) {
    return false;
  }

  // Criterion 3: Multi-asset validation
  if (multiAssetResult) {
    const passedSymbols = multiAssetResult.symbolsPassed;
    const passRate = multiAssetResult.passRate;

    // Need at least 2 passing symbols OR 40%+ pass rate
    if (passedSymbols < 2 && passRate < 40) {
      return false;
    }
  }

  // Criterion 4: Sufficient trade count
  const totalTrades = walkForwardResult.testMetrics.totalTrades;
  if (totalTrades < 20) {
    return false;
  }

  // Criterion 5: Manageable drawdown
  const maxDrawdown = Math.abs(walkForwardResult.testMetrics.maxDrawdownPercent);
  if (maxDrawdown >= 25) {
    return false;
  }

  // All criteria met
  return true;
}

/**
 * Get a human-readable summary of scoring components
 */
export function getScoringBreakdown(input: ScoringInput): {
  sharpe: number;
  oosDegrade: number;
  multiAssetPassRate: number;
  totalReturn: number;
  maxDrawdown: number;
  overallScore: number;
} {
  const { optimizationMetrics, walkForwardResult, multiAssetResult } = input;

  // Extract metrics
  let sharpe = 0;
  if (walkForwardResult) {
    sharpe = walkForwardResult.testMetrics.sharpeRatio;
  } else if (optimizationMetrics) {
    sharpe = optimizationMetrics.sharpeRatio;
  }

  let oosDegrade = 0;
  if (walkForwardResult) {
    oosDegrade = walkForwardResult.oosDegrade;
  }

  let multiAssetPassRate = 0;
  if (multiAssetResult) {
    multiAssetPassRate = multiAssetResult.passRate;
  }

  let totalReturn = 0;
  if (walkForwardResult) {
    totalReturn = walkForwardResult.testMetrics.totalReturnPercent;
  } else if (optimizationMetrics) {
    totalReturn = optimizationMetrics.totalReturnPercent;
  }

  let maxDrawdown = 0;
  if (walkForwardResult) {
    maxDrawdown = walkForwardResult.testMetrics.maxDrawdownPercent;
  } else if (optimizationMetrics) {
    maxDrawdown = optimizationMetrics.maxDrawdownPercent;
  }

  return {
    sharpe,
    oosDegrade,
    multiAssetPassRate,
    totalReturn,
    maxDrawdown,
    overallScore: calculateRobustnessScore(input),
  };
}
