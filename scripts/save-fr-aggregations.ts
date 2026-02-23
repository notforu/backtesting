import { saveAggregationConfig, closeDb, initDb } from '../src/data/db.js';
import { v4 as uuidv4 } from 'uuid';
import type { AggregationConfig } from '../src/data/db.js';

/**
 * Save predefined FR Spike aggregation configurations to the database
 */
async function main() {
  try {
    // Initialize database
    await initDb();
    console.log('Database initialized');

    const now = Date.now();

    // Config 1: FR Spike Top 10
    const config1: AggregationConfig = {
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
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LTC/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(config1);
    console.log(`✓ Saved Config 1 (FR Spike Top 10): ${config1.id}`);

    // Config 2: FR Spike Best Mix 20
    const config2: AggregationConfig = {
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
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LTC/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'SNX/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'IMX/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'TRX/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XLM/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LDO/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'VET/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LINK/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ICP/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'HBAR/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ATOM/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(config2);
    console.log(`✓ Saved Config 2 (FR Spike Best Mix 20): ${config2.id}`);

    // Config 3: FR Spike DeFi
    const config3: AggregationConfig = {
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
        { strategyName: 'funding-rate-spike', symbol: 'CRV/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'SNX/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LDO/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'PENDLE/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'IMX/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT', timeframe: '1h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(config3);
    console.log(`✓ Saved Config 3 (FR Spike DeFi): ${config3.id}`);

    // Config 4: FR Spike 4h Conservative
    const config4: AggregationConfig = {
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
        { strategyName: 'funding-rate-spike', symbol: 'DOT/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ADA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETC/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'MANA/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AXS/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'INJ/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XLM/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'VET/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'LINK/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'XRP/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'GRT/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'AAVE/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'HBAR/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'ETH/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
        { strategyName: 'funding-rate-spike', symbol: 'TRX/USDT:USDT', timeframe: '4h', params: {}, exchange: 'bybit' },
      ],
    };
    await saveAggregationConfig(config4);
    console.log(`✓ Saved Config 4 (FR Spike 4h Conservative): ${config4.id}`);

    console.log('\nAll aggregation configs saved successfully!');
    console.log('Summary:');
    console.log(`  Config 1 ID: ${config1.id}`);
    console.log(`  Config 2 ID: ${config2.id}`);
    console.log(`  Config 3 ID: ${config3.id}`);
    console.log(`  Config 4 ID: ${config4.id}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
