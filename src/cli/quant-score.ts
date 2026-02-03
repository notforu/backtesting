#!/usr/bin/env node
/**
 * CLI tool for scoring strategy robustness
 * Usage: npx tsx src/cli/quant-score.ts --walk-forward-file=<path> [--multi-asset-file=<path>]
 *
 * Options:
 *   --walk-forward-file=PATH    Path to walk-forward test JSON output (required)
 *   --multi-asset-file=PATH     Path to multi-asset test JSON output (optional)
 *
 * Outputs JSON to stdout:
 * - Success: {"score":72,"isPromising":true,"breakdown":{...}}
 * - Failure: {"error":"..."}
 *
 * All logging goes to stderr
 */

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import {
  calculateRobustnessScore,
  isStrategyPromising,
  getScoringBreakdown,
  type ScoringInput,
} from '../core/scoring.js';
import type { WalkForwardResult } from '../core/walk-forward.js';
import type { MultiAssetResult } from '../core/multi-asset-validation.js';

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key && value) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Read and parse JSON file
 */
function readJsonFile(filePath: string): unknown {
  const resolvedPath = path.resolve(process.cwd(), filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  if (!args['walk-forward-file']) {
    console.error('Error: Missing required argument: --walk-forward-file');
    process.stdout.write(JSON.stringify({
      error: 'Missing required argument: --walk-forward-file'
    }));
    process.exit(1);
  }

  console.error('Reading input files...');

  try {
    // Read walk-forward result
    const walkForwardData = readJsonFile(args['walk-forward-file']);

    // Validate walk-forward data structure
    if (!walkForwardData || typeof walkForwardData !== 'object') {
      throw new Error('Invalid walk-forward file: must contain a JSON object');
    }

    const walkForwardResult = walkForwardData as WalkForwardResult;

    // Check required fields
    if (!walkForwardResult.trainMetrics || !walkForwardResult.testMetrics) {
      throw new Error('Invalid walk-forward file: missing trainMetrics or testMetrics');
    }

    // Read multi-asset result if provided
    let multiAssetResult: MultiAssetResult | undefined;
    if (args['multi-asset-file']) {
      const multiAssetData = readJsonFile(args['multi-asset-file']);

      if (!multiAssetData || typeof multiAssetData !== 'object') {
        throw new Error('Invalid multi-asset file: must contain a JSON object');
      }

      multiAssetResult = multiAssetData as MultiAssetResult;

      // Check required fields
      if (typeof multiAssetResult.passRate !== 'number') {
        throw new Error('Invalid multi-asset file: missing passRate');
      }
    }

    console.error('Calculating robustness score...');

    // Build scoring input
    const scoringInput: ScoringInput = {
      walkForwardResult,
      multiAssetResult,
    };

    // Calculate score and breakdown
    const score = calculateRobustnessScore(scoringInput);
    const isPromising = isStrategyPromising(scoringInput);
    const breakdown = getScoringBreakdown(scoringInput);

    // Output result to stdout
    process.stdout.write(JSON.stringify({
      score,
      isPromising,
      breakdown,
    }));

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Scoring failed: ${message}`);
    process.stdout.write(JSON.stringify({
      error: message
    }));
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error('Fatal error:', error);
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : 'Unknown error'
  }));
  process.exit(1);
});
