/**
 * Filesystem result storage
 * Saves backtest results as JSON files for version control and reproducibility.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { BacktestResult, PairsBacktestResult } from './types.js';

// Results directory at project root
const RESULTS_DIR = join(process.cwd(), 'results');

/**
 * Sanitize a string for use in filenames
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/^PM:/, '')  // Remove PM: prefix
    .replace(/[^a-zA-Z0-9_-]/g, '-')  // Replace special chars with dashes
    .replace(/-+/g, '-')  // Collapse multiple dashes
    .replace(/^-|-$/g, '')  // Trim leading/trailing dashes
    .substring(0, 80);  // Limit length
}

/**
 * Format timestamp for filename: YYYY-MM-DD-HHmmss
 */
function formatTimestamp(ts?: number): string {
  const d = new Date(ts ?? Date.now());
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Save a backtest result to the filesystem
 * Path: results/{strategy}/{timestamp}-{symbol}.json
 */
export function saveResultToFile(result: BacktestResult | PairsBacktestResult): string {
  const config = result.config as any;
  const strategyName = config.strategyName;
  const symbol = config.symbol || config.symbolA || 'unknown';

  // Create directory
  const strategyDir = join(RESULTS_DIR, sanitizeFilename(strategyName));
  if (!existsSync(strategyDir)) {
    mkdirSync(strategyDir, { recursive: true });
  }

  // Build filename
  const timestamp = formatTimestamp(result.createdAt);
  const symbolSlug = sanitizeFilename(symbol);
  const filename = `${timestamp}-${symbolSlug}.json`;
  const filepath = join(strategyDir, filename);

  // Build the output object (exclude large candle arrays to keep files manageable)
  const output = {
    // Input
    config: result.config,

    // Output - metrics
    metrics: result.metrics,

    // Output - trades (full detail)
    trades: result.trades,

    // Output - equity curve (keep it - useful for analysis)
    equity: result.equity,

    // Rolling metrics if present
    ...(result.rollingMetrics ? { rollingMetrics: result.rollingMetrics } : {}),

    // Metadata
    meta: {
      savedAt: new Date().toISOString(),
      backtestId: result.id,
      duration: (result as any).duration,
      tradesCount: result.trades.length,
    },
  };

  writeFileSync(filepath, JSON.stringify(output, null, 2));

  return filepath;
}

/**
 * Save scanner summary results to filesystem
 * Path: results/{strategy}/scan-{timestamp}.json
 */
export function saveScanResultsToFile(
  strategyName: string,
  scanConfig: {
    symbols: string[];
    timeframe: string;
    from: string;
    to: string;
    slippage: number;
    initialCapital: number;
    params: Record<string, unknown>;
  },
  results: Array<{
    symbol: string;
    metrics?: {
      totalReturnPercent: number;
      sharpeRatio: number;
      maxDrawdownPercent: number;
      winRate: number;
      profitFactor: number;
    };
    tradesCount?: number;
    status: string;
    error?: string;
  }>,
  summary: { total: number; profitable: number; avgSharpe: number; avgReturn: number }
): string {
  const strategyDir = join(RESULTS_DIR, sanitizeFilename(strategyName));
  if (!existsSync(strategyDir)) {
    mkdirSync(strategyDir, { recursive: true });
  }

  const timestamp = formatTimestamp();
  const filename = `scan-${timestamp}.json`;
  const filepath = join(strategyDir, filename);

  const output = {
    type: 'scan',
    config: scanConfig,
    strategy: strategyName,
    summary,
    results,
    meta: {
      savedAt: new Date().toISOString(),
      marketsScanned: results.length,
    },
  };

  writeFileSync(filepath, JSON.stringify(output, null, 2));

  return filepath;
}
