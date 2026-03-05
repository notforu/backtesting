import { saveAggregationConfig, closeDb, initDb } from '../src/data/db.js';
import { v4 as uuidv4 } from 'uuid';
import type { AggregationConfig } from '../src/data/db.js';

/**
 * Restore all aggregation configs to the database.
 *
 * Includes:
 *  - V2 configs based on paper trading sessions running on production
 *  - V1 configs from save-fr-aggregations.ts (FR Spike Top 10, Best Mix 20, DeFi, 4h Conservative)
 */
async function main() {
  try {
    await initDb();
    console.log('Database initialized');

    const now = Date.now();

    // -------------------------------------------------------------------------
    // FR V2 configs (from production paper trading sessions)
    // -------------------------------------------------------------------------

    const frV2Top9Symbols = [
      { symbol: 'LDO/USDT:USDT',  timeframe: '4h' },
      { symbol: 'DOGE/USDT:USDT', timeframe: '4h' },
      { symbol: 'ARB/USDT:USDT',  timeframe: '4h' },
      { symbol: 'ICP/USDT:USDT',  timeframe: '4h' },
      { symbol: 'COMP/USDT:USDT', timeframe: '4h' },
      { symbol: 'TRX/USDT:USDT',  timeframe: '4h' },
      { symbol: 'XLM/USDT:USDT',  timeframe: '4h' },
      { symbol: 'RPL/USDT:USDT',  timeframe: '1h' },
      { symbol: 'ENS/USDT:USDT',  timeframe: '1h' },
    ];

    // Config 1: FR V2 Top9 — single_strongest
    const configV2Top9Single: AggregationConfig = {
      id: uuidv4(),
      name: 'FR V2 Top9 — single_strongest',
      allocationMode: 'single_strongest',
      maxPositions: 1,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: frV2Top9Symbols.map(({ symbol, timeframe }) => ({
        strategyName: 'funding-rate-spike-v2',
        symbol,
        timeframe,
        params: {},
        exchange: 'bybit',
      })),
    };
    await saveAggregationConfig(configV2Top9Single);
    console.log(`Saved Config V2-1 (FR V2 Top9 — single_strongest): ${configV2Top9Single.id}`);

    // Config 2: FR V2 Top9 — top_n (maxPos=3)
    const configV2Top9TopN: AggregationConfig = {
      id: uuidv4(),
      name: 'FR V2 Top9 — top_n (maxPos=3)',
      allocationMode: 'top_n',
      maxPositions: 3,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: frV2Top9Symbols.map(({ symbol, timeframe }) => ({
        strategyName: 'funding-rate-spike-v2',
        symbol,
        timeframe,
        params: {},
        exchange: 'bybit',
      })),
    };
    await saveAggregationConfig(configV2Top9TopN);
    console.log(`Saved Config V2-2 (FR V2 Top9 — top_n (maxPos=3)): ${configV2Top9TopN.id}`);

    // Config 3: FR V2 Top5 — single_strongest
    const configV2Top5Single: AggregationConfig = {
      id: uuidv4(),
      name: 'FR V2 Top5 — single_strongest',
      allocationMode: 'single_strongest',
      maxPositions: 1,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike-v2', symbol: 'LDO/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'DOGE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'ARB/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'TRX/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'ICP/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV2Top5Single);
    console.log(`Saved Config V2-3 (FR V2 Top5 — single_strongest): ${configV2Top5Single.id}`);

    // Config 4: FR V2 Top6 Original — single_strongest
    const configV2Top6Original: AggregationConfig = {
      id: uuidv4(),
      name: 'FR V2 Top6 Original — single_strongest',
      allocationMode: 'single_strongest',
      maxPositions: 1,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike-v2', symbol: 'LDO/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'DOGE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'IMX/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'ICP/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'XLM/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike-v2', symbol: 'NEAR/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV2Top6Original);
    console.log(`Saved Config V2-4 (FR V2 Top6 Original — single_strongest): ${configV2Top6Original.id}`);

    // -------------------------------------------------------------------------
    // V1 configs (from save-fr-aggregations.ts)
    // -------------------------------------------------------------------------

    // Config V1-1: FR Spike Top 10
    const configV1Top10: AggregationConfig = {
      id: uuidv4(),
      name: 'FR Spike Top 10',
      allocationMode: 'top_n',
      maxPositions: 5,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LTC/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV1Top10);
    console.log(`Saved Config V1-1 (FR Spike Top 10): ${configV1Top10.id}`);

    // Config V1-2: FR Spike Best Mix 20
    const configV1BestMix20: AggregationConfig = {
      id: uuidv4(),
      name: 'FR Spike Best Mix 20',
      allocationMode: 'top_n',
      maxPositions: 8,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LTC/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'SNX/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'IMX/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'TRX/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XLM/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LDO/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'VET/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LINK/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ICP/USDT:USDT',   timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'HBAR/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ATOM/USDT:USDT',  timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV1BestMix20);
    console.log(`Saved Config V1-2 (FR Spike Best Mix 20): ${configV1BestMix20.id}`);

    // Config V1-3: FR Spike DeFi
    const configV1DeFi: AggregationConfig = {
      id: uuidv4(),
      name: 'FR Spike DeFi',
      allocationMode: 'top_n',
      maxPositions: 4,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT',    timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'SNX/USDT:USDT',    timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LDO/USDT:USDT',    timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT',   timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT',    timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'PENDLE/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'IMX/USDT:USDT',    timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT',    timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV1DeFi);
    console.log(`Saved Config V1-3 (FR Spike DeFi): ${configV1DeFi.id}`);

    // Config V1-4: FR Spike 4h Conservative
    const configV1Conservative: AggregationConfig = {
      id: uuidv4(),
      name: 'FR Spike 4h Conservative',
      allocationMode: 'top_n',
      maxPositions: 6,
      exchange: 'bybit',
      mode: 'futures',
      initialCapital: 10000,
      createdAt: now,
      updatedAt: now,
      subStrategies: [
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XLM/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'VET/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LINK/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XRP/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'HBAR/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETH/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'TRX/USDT:USDT',  timeframe: '4h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(configV1Conservative);
    console.log(`Saved Config V1-4 (FR Spike 4h Conservative): ${configV1Conservative.id}`);

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log('\nAll aggregation configs saved successfully!');
    console.log('Summary:');
    console.log(`  V2-1 FR V2 Top9 — single_strongest:       ${configV2Top9Single.id}`);
    console.log(`  V2-2 FR V2 Top9 — top_n (maxPos=3):       ${configV2Top9TopN.id}`);
    console.log(`  V2-3 FR V2 Top5 — single_strongest:       ${configV2Top5Single.id}`);
    console.log(`  V2-4 FR V2 Top6 Original — single_strongest: ${configV2Top6Original.id}`);
    console.log(`  V1-1 FR Spike Top 10:                      ${configV1Top10.id}`);
    console.log(`  V1-2 FR Spike Best Mix 20:                 ${configV1BestMix20.id}`);
    console.log(`  V1-3 FR Spike DeFi:                        ${configV1DeFi.id}`);
    console.log(`  V1-4 FR Spike 4h Conservative:             ${configV1Conservative.id}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
