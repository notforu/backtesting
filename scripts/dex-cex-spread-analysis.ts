#!/usr/bin/env node
/**
 * DEX-CEX Spread Analysis
 *
 * Compares DEX (GeckoTerminal) and CEX (Bybit) prices to identify
 * exploitable spread opportunities across chains.
 *
 * Usage: npx tsx scripts/dex-cex-spread-analysis.ts [--months=6]
 *
 * Output: Writes analysis report to /docs/research/dex-cex-spread-analysis.md
 */

import { GeckoTerminalFetcher, KNOWN_POOLS } from '../src/data/providers/gecko-terminal.js';
import { BybitProvider } from '../src/data/providers/bybit.js';
import type { Candle } from '../src/core/types.js';
import * as fs from 'fs';
import * as path from 'path';

interface SpreadStats {
  poolKey: string;
  label: string;
  cexSymbol: string;
  totalCandles: number;
  alignedCandles: number;
  meanSpread: number;
  medianSpread: number;
  stdSpread: number;
  pctAbove01: number; // % of time spread > 0.1%
  pctAbove03: number; // % of time spread > 0.3%
  pctAbove05: number; // % of time spread > 0.5%
  pctAbove10: number; // % of time spread > 1.0%
  avgReversionBars: number; // Average candles until spread < 0.1%
  maxSpread: number;
  minSpread: number;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (key !== undefined && value !== undefined) result[key] = value;
    }
  }
  return result;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function alignCandles(
  dex: Candle[],
  cex: Candle[]
): { dex: Candle; cex: Candle }[] {
  // Build map of CEX candles by timestamp (rounded to nearest hour)
  const cexMap = new Map<number, Candle>();
  for (const c of cex) {
    const hourTs = Math.floor(c.timestamp / 3600000) * 3600000;
    cexMap.set(hourTs, c);
  }

  const aligned: { dex: Candle; cex: Candle }[] = [];
  for (const d of dex) {
    const hourTs = Math.floor(d.timestamp / 3600000) * 3600000;
    const c = cexMap.get(hourTs);
    if (c !== undefined) {
      aligned.push({ dex: d, cex: c });
    }
  }

  return aligned;
}

function calculateSpreadStats(
  poolKey: string,
  label: string,
  cexSymbol: string,
  aligned: { dex: Candle; cex: Candle }[]
): SpreadStats {
  if (aligned.length === 0) {
    return {
      poolKey,
      label,
      cexSymbol,
      totalCandles: 0,
      alignedCandles: 0,
      meanSpread: 0,
      medianSpread: 0,
      stdSpread: 0,
      pctAbove01: 0,
      pctAbove03: 0,
      pctAbove05: 0,
      pctAbove10: 0,
      avgReversionBars: 0,
      maxSpread: 0,
      minSpread: 0,
    };
  }

  // Calculate absolute spreads (%)
  const spreads = aligned.map(({ dex, cex }) =>
    Math.abs(((dex.close - cex.close) / cex.close) * 100)
  );

  const meanSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const medianSpread = median(spreads);
  const variance =
    spreads.reduce((s, v) => s + (v - meanSpread) ** 2, 0) / spreads.length;
  const stdSpread = Math.sqrt(variance);

  const count01 = spreads.filter((s) => s > 0.1).length;
  const count03 = spreads.filter((s) => s > 0.3).length;
  const count05 = spreads.filter((s) => s > 0.5).length;
  const count10 = spreads.filter((s) => s > 1.0).length;

  // Mean reversion time: when spread > 0.1%, how many bars until it drops below 0.1%?
  let totalReversionBars = 0;
  let reversionCount = 0;
  for (let i = 0; i < spreads.length; i++) {
    if ((spreads[i] as number) > 0.1) {
      let bars = 0;
      for (let j = i + 1; j < spreads.length; j++) {
        bars++;
        if ((spreads[j] as number) < 0.1) break;
      }
      totalReversionBars += bars;
      reversionCount++;
    }
  }

  return {
    poolKey,
    label,
    cexSymbol,
    totalCandles: aligned.length,
    alignedCandles: aligned.length,
    meanSpread,
    medianSpread,
    stdSpread,
    pctAbove01: (count01 / spreads.length) * 100,
    pctAbove03: (count03 / spreads.length) * 100,
    pctAbove05: (count05 / spreads.length) * 100,
    pctAbove10: (count10 / spreads.length) * 100,
    avgReversionBars:
      reversionCount > 0 ? totalReversionBars / reversionCount : 0,
    maxSpread: Math.max(...spreads),
    minSpread: Math.min(...spreads),
  };
}

function generateReport(allStats: SpreadStats[]): string {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  let report = `# DEX-CEX Spread Analysis\n\n`;
  report += `**Generated:** ${now}\n\n`;
  report += `## Summary\n\n`;
  report += `Analyzed ${allStats.length} DEX-CEX pairs across multiple chains.\n`;
  report += `Looking for exploitable price discrepancies between decentralized and centralized exchanges.\n\n`;

  // Comparison table
  report += `## Spread Statistics by Pool\n\n`;
  report += `| Pool | Aligned Candles | Mean Spread % | Median % | Max % | >0.1% | >0.3% | >0.5% | >1.0% | Avg Reversion (bars) |\n`;
  report += `|------|----------------|---------------|----------|-------|-------|-------|-------|-------|---------------------|\n`;

  for (const s of allStats) {
    report += `| ${s.label} | ${s.alignedCandles} | ${s.meanSpread.toFixed(4)} | ${s.medianSpread.toFixed(4)} | ${s.maxSpread.toFixed(2)} | ${s.pctAbove01.toFixed(1)}% | ${s.pctAbove03.toFixed(1)}% | ${s.pctAbove05.toFixed(1)}% | ${s.pctAbove10.toFixed(1)}% | ${s.avgReversionBars.toFixed(1)} |\n`;
  }

  report += `\n## Interpretation\n\n`;
  report += `### Minimum Profitable Spread per Chain\n\n`;
  report += `To profitably arbitrage DEX-CEX, the spread must exceed:\n`;
  report += `- **Ethereum**: ~0.3-0.5% (high gas fees, ~$5-50 per swap)\n`;
  report += `- **Arbitrum**: ~0.1-0.2% (low gas, ~$0.10-0.50 per swap)\n`;
  report += `- **Base**: ~0.1-0.2% (low gas, similar to Arbitrum)\n`;
  report += `- **Solana**: ~0.05-0.1% (very low fees, ~$0.01 per swap)\n\n`;

  report += `### Key Findings\n\n`;

  for (const s of allStats) {
    const viable = s.pctAbove03 > 5;
    report += `**${s.label}**: `;
    if (s.alignedCandles === 0) {
      report += `No data available.\n`;
    } else if (viable) {
      report += `Potentially viable. Spread >0.3% occurs ${s.pctAbove03.toFixed(1)}% of the time. `;
      report += `Mean reversion takes ${s.avgReversionBars.toFixed(1)} bars.\n`;
    } else {
      report += `Not viable. Spread rarely exceeds profitable threshold. `;
      report += `Mean spread: ${s.meanSpread.toFixed(4)}%\n`;
    }
  }

  report += `\n## Conclusion\n\n`;
  const anyViable = allStats.some((s) => s.pctAbove03 > 5);
  if (anyViable) {
    report += `Some DEX-CEX pairs show exploitable spread patterns. Further investigation with higher frequency data and gas cost modeling recommended.\n`;
  } else {
    report += `DEX-CEX spreads are generally too tight for profitable arbitrage at hourly frequency. `;
    report += `Higher frequency (1m-5m) analysis or flash-loan based strategies may be needed.\n`;
  }

  return report;
}

// Map pool keys to CEX symbols for Bybit
const POOL_CEX_MAP: Record<string, string> = {
  'eth-uniswap-v3-eth-usdc': 'ETH/USDT:USDT',
  'arbitrum-uniswap-v3-eth-usdc': 'ETH/USDT:USDT',
  'base-aerodrome-eth-usdc': 'ETH/USDT:USDT',
  'solana-raydium-sol-usdc': 'SOL/USDT:USDT',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const months = parseInt(args['months'] ?? '3', 10);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  console.log(`DEX-CEX Spread Analysis`);
  console.log(
    `Period: ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`
  );
  console.log('');

  const gecko = new GeckoTerminalFetcher();
  const bybit = new BybitProvider();
  const allStats: SpreadStats[] = [];

  // Cache CEX data per symbol to avoid duplicate fetches
  const cexCache = new Map<string, Candle[]>();

  for (const [poolKey, pool] of Object.entries(KNOWN_POOLS)) {
    const cexSymbol = POOL_CEX_MAP[poolKey];
    if (cexSymbol === undefined) {
      console.log(`Skipping ${poolKey}: no CEX symbol mapping`);
      continue;
    }

    console.log(`\n--- ${pool.label} ---`);

    try {
      // Fetch DEX data
      console.log(
        `Fetching DEX data from GeckoTerminal (${pool.network})...`
      );
      const dexCandles = await gecko.fetchFullHistory(
        pool.network,
        pool.poolAddress,
        'hour',
        1,
        startDate.getTime(),
        endDate.getTime()
      );
      console.log(`  DEX: ${dexCandles.length} candles`);

      // Fetch CEX data (cached)
      let cexCandles = cexCache.get(cexSymbol);
      if (cexCandles === undefined) {
        console.log(`Fetching CEX data from Bybit (${cexSymbol})...`);
        cexCandles = await bybit.fetchCandles(
          cexSymbol,
          '1h',
          startDate,
          endDate
        );
        cexCache.set(cexSymbol, cexCandles);
        console.log(`  CEX: ${cexCandles.length} candles`);
      } else {
        console.log(`  CEX: ${cexCandles.length} candles (cached)`);
      }

      // Align and analyze
      const aligned = alignCandles(dexCandles, cexCandles);
      console.log(`  Aligned: ${aligned.length} candles`);

      const stats = calculateSpreadStats(
        poolKey,
        pool.label,
        cexSymbol,
        aligned
      );
      allStats.push(stats);

      console.log(
        `  Mean spread: ${stats.meanSpread.toFixed(4)}%, Max: ${stats.maxSpread.toFixed(2)}%`
      );
      console.log(
        `  >0.1%: ${stats.pctAbove01.toFixed(1)}%, >0.3%: ${stats.pctAbove03.toFixed(1)}%, >0.5%: ${stats.pctAbove05.toFixed(1)}%`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`  ERROR: ${msg}`);
      allStats.push({
        poolKey,
        label: pool.label,
        cexSymbol,
        totalCandles: 0,
        alignedCandles: 0,
        meanSpread: 0,
        medianSpread: 0,
        stdSpread: 0,
        pctAbove01: 0,
        pctAbove03: 0,
        pctAbove05: 0,
        pctAbove10: 0,
        avgReversionBars: 0,
        maxSpread: 0,
        minSpread: 0,
      });
    }
  }

  // Generate report
  const report = generateReport(allStats);

  // Save to docs/research/
  const outputDir = path.join(process.cwd(), 'docs', 'research');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'dex-cex-spread-analysis.md');
  fs.writeFileSync(outputPath, report);

  console.log(`\nReport saved to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
