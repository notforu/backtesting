#!/usr/bin/env npx tsx
/**
 * Seed a paper trading test session.
 * Usage: npx tsx scripts/seed-paper-test.ts
 */

import { initDb, getAggregationConfigs, saveAggregationConfig } from '../src/data/db.js';
import { sessionManager } from '../src/paper-trading/session-manager.js';
import type { AggregateBacktestConfig } from '../src/core/signal-types.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  await initDb();

  // Find or create an aggregation config
  let configs = await getAggregationConfigs();

  if (configs.length === 0) {
    console.log('No aggregation configs found, creating a test config...');
    const testConfig = {
      id: uuidv4(),
      name: 'Paper Test - FR Spike ATOM/DOT',
      allocationMode: 'single_strongest' as const,
      maxPositions: 1,
      subStrategies: [
        {
          strategyName: 'funding-rate-spike',
          symbol: 'ATOM/USDT:USDT',
          timeframe: '4h',
          params: {},
          exchange: 'bybit',
        },
        {
          strategyName: 'funding-rate-spike',
          symbol: 'DOT/USDT:USDT',
          timeframe: '4h',
          params: {},
          exchange: 'bybit',
        },
      ],
      initialCapital: 10000,
      exchange: 'bybit',
      mode: 'futures' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveAggregationConfig(testConfig);
    configs = [testConfig];
    console.log(`Created aggregation config: ${testConfig.name} (${testConfig.id})`);
  }

  const config = configs[0];
  console.log(`Using aggregation config: ${config.name} (${config.id})`);

  // Create paper session
  const aggregationConfig: AggregateBacktestConfig = {
    subStrategies: config.subStrategies.map((s) => ({
      strategyName: s.strategyName,
      symbol: s.symbol,
      timeframe: s.timeframe as AggregateBacktestConfig['subStrategies'][number]['timeframe'],
      params: s.params ?? {},
      exchange: s.exchange ?? config.exchange,
    })),
    allocationMode: config.allocationMode as AggregateBacktestConfig['allocationMode'],
    maxPositions: config.maxPositions,
    initialCapital: config.initialCapital,
    startDate: 0,
    endDate: 0,
    exchange: config.exchange,
    mode: (config.mode as 'spot' | 'futures') ?? 'futures',
  };

  const session = await sessionManager.createSession({
    name: `Test Session - ${new Date().toISOString().split('T')[0]}`,
    aggregationConfig,
    aggregationConfigId: config.id,
    initialCapital: config.initialCapital,
  });

  console.log('\nPaper session created!');
  console.log(`   Session ID: ${session.id}`);
  console.log(`   Name: ${session.name}`);
  console.log(`   Capital: $${session.initialCapital}`);
  console.log(`   Status: ${session.status}`);
  console.log('\nNext steps:');
  console.log('  1. Start the dev server: npm run dev');
  console.log('  2. Force a tick via API:');
  console.log(`     curl -X POST http://localhost:3000/api/paper-trading/sessions/${session.id}/tick`);
  console.log('  3. Check session detail:');
  console.log(`     curl http://localhost:3000/api/paper-trading/sessions/${session.id}`);
  console.log('  4. Or use the dashboard Paper Trading tab');

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
