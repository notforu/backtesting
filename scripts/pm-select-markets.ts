#!/usr/bin/env npx tsx
/**
 * PM Market Selector CLI
 *
 * Screens active Polymarket markets for mean-reversion trading suitability
 * using cached candle data and oscillation metrics.
 *
 * Usage:
 *   npx tsx scripts/pm-select-markets.ts [options]
 *
 * Options:
 *   --min-price=0.15        Minimum current price (default: 0.15)
 *   --max-price=0.85        Maximum current price (default: 0.85)
 *   --min-days=30           Minimum days until resolution (default: 30)
 *   --min-volume=5000       Minimum total USD volume (default: 5000)
 *   --min-data-days=14      Minimum days of cached data (default: 14)
 *   --min-vol-activity=0.3  Minimum volume activity fraction (default: 0.3)
 *   --min-bb-width=0.05     Minimum average BB width (default: 0.05)
 *   --min-crossovers=3      Minimum SMA crossovers (default: 3)
 *   --top=20                Show top N results (default: 20)
 *   --json                  Output JSON to stdout instead of table
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { selectMarkets } from '../src/data/pm-market-selector.js';
import type { MarketSelection, MarketSelectorOptions } from '../src/data/pm-market-selector.js';

// ============================================================================
// CLI argument parsing
// ============================================================================

function parseArgs(): {
  options: MarketSelectorOptions;
  top: number;
  json: boolean;
} {
  const args = process.argv.slice(2);
  const options: MarketSelectorOptions = {};
  let top = 20;
  let json = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }

    const [key, value] = arg.split('=');
    if (!key || value === undefined) continue;

    switch (key) {
      case '--min-price':
        options.minPrice = parseFloat(value);
        break;
      case '--max-price':
        options.maxPrice = parseFloat(value);
        break;
      case '--min-days':
        options.minDaysToResolution = parseInt(value, 10);
        break;
      case '--min-volume':
        options.minVolume = parseFloat(value);
        break;
      case '--min-data-days':
        options.minDataDays = parseInt(value, 10);
        break;
      case '--min-vol-activity':
        options.minVolumeActivity = parseFloat(value);
        break;
      case '--min-bb-width':
        options.minBBWidth = parseFloat(value);
        break;
      case '--min-crossovers':
        options.minCrossovers = parseInt(value, 10);
        break;
      case '--top':
        top = parseInt(value, 10);
        break;
    }
  }

  return { options, top, json };
}

// ============================================================================
// Console table output
// ============================================================================

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str.padEnd(len);
}

function padStart(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str.padStart(len);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return vol.toFixed(0);
}

function recommendationLabel(rec: MarketSelection['recommendation']): string {
  switch (rec) {
    case 'strong':
      return 'STRONG';
    case 'moderate':
      return 'MOD';
    case 'weak':
      return 'WEAK';
  }
}

function printTable(markets: MarketSelection[], top: number): void {
  const display = markets.slice(0, top);

  console.log('\n=== PM MARKET SELECTOR RESULTS ===');
  console.log(`Showing top ${Math.min(top, display.length)} of ${markets.length} qualifying markets`);
  console.log('');

  // Header
  const hdr =
    '#   ' +
    'Question                                                     ' + // 60 chars
    'Price ' +
    'Days ' +
    'Score ' +
    'BBW   ' +
    'VolAct ' +
    'Xovers ' +
    'Vol     ' +
    'Rec';
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  for (let i = 0; i < display.length; i++) {
    const m = display[i];
    const rank = padEnd(String(i + 1), 4);
    const question = padEnd(m.question, 60);
    const price = padStart(m.currentPrice.toFixed(2), 5) + ' ';
    const days = padStart(String(m.daysToResolution), 4) + ' ';
    const score = padStart(m.oscillationScore.toFixed(3), 5) + ' ';
    const bbw = padStart(m.avgBBWidth.toFixed(3), 5) + ' ';
    const volAct = padStart((m.volumeActivity * 100).toFixed(0) + '%', 6) + ' ';
    const xovers = padStart(String(m.smaCrossovers), 6) + ' ';
    const vol = padStart(formatVolume(m.volume), 7) + ' ';
    const rec = recommendationLabel(m.recommendation);

    console.log(`${rank}${question}${price}${days}${score}${bbw}${volAct}${xovers}${vol}${rec}`);
  }

  console.log('');

  // Summary breakdown
  const strong = markets.filter((m) => m.recommendation === 'strong').length;
  const moderate = markets.filter((m) => m.recommendation === 'moderate').length;
  const weak = markets.filter((m) => m.recommendation === 'weak').length;

  console.log(`Recommendation breakdown: ${strong} STRONG, ${moderate} MODERATE, ${weak} WEAK`);

  if (strong > 0) {
    console.log('\nStrong picks:');
    markets
      .filter((m) => m.recommendation === 'strong')
      .slice(0, 5)
      .forEach((m, i) => {
        console.log(
          `  ${i + 1}. ${m.question.slice(0, 70)} [score: ${m.oscillationScore.toFixed(3)}, price: ${m.currentPrice.toFixed(2)}]`
        );
      });
  }
}

// ============================================================================
// Save results to file
// ============================================================================

const RESULTS_DIR = '/workspace/results/pm-pipeline';
const OUTPUT_PATH = join(RESULTS_DIR, 'market-selection.json');

function saveResults(markets: MarketSelection[]): void {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const output = {
    timestamp: new Date().toISOString(),
    totalQualifying: markets.length,
    strongCount: markets.filter((m) => m.recommendation === 'strong').length,
    moderateCount: markets.filter((m) => m.recommendation === 'moderate').length,
    weakCount: markets.filter((m) => m.recommendation === 'weak').length,
    markets,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { options, top, json } = parseArgs();

  if (!json) {
    console.log('PM Market Selector - Fetching active markets and scoring...');
    console.log('Options:', {
      minPrice: options.minPrice ?? 0.15,
      maxPrice: options.maxPrice ?? 0.85,
      minDaysToResolution: options.minDaysToResolution ?? 30,
      minVolume: options.minVolume ?? 5000,
      minDataDays: options.minDataDays ?? 14,
      minVolumeActivity: options.minVolumeActivity ?? 0.3,
      minBBWidth: options.minBBWidth ?? 0.05,
      minCrossovers: options.minCrossovers ?? 3,
    });
    console.log('');
  }

  let markets: MarketSelection[];
  try {
    markets = await selectMarkets(options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!json) {
      console.error(`Error: ${msg}`);
    } else {
      console.error(JSON.stringify({ error: msg }));
    }
    process.exit(1);
  }

  if (json) {
    // JSON output — include all results (not limited by --top)
    const output = {
      timestamp: new Date().toISOString(),
      totalQualifying: markets.length,
      strongCount: markets.filter((m) => m.recommendation === 'strong').length,
      moderateCount: markets.filter((m) => m.recommendation === 'moderate').length,
      weakCount: markets.filter((m) => m.recommendation === 'weak').length,
      markets: markets.slice(0, top),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    printTable(markets, top);
  }

  // Always save full results to file (even in json mode)
  try {
    saveResults(markets);
    if (!json) {
      console.log(`\nFull results saved to: ${OUTPUT_PATH}`);
    }
  } catch (err) {
    if (!json) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Could not save results: ${msg}`);
    }
  }

  if (!json && markets.length === 0) {
    console.log('No markets passed all filters.');
    console.log('Tips:');
    console.log('  - Run pm-discover-and-cache.ts first to populate the candle cache');
    console.log('  - Lower --min-data-days or --min-crossovers to loosen filters');
    console.log('  - Check that the DB has polymarket 1h candles');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
