#!/usr/bin/env node
/**
 * List top Bybit perpetual futures symbols by volume
 */
import ccxt from 'ccxt';

async function main() {
  const client = new ccxt.bybit({ options: { defaultType: 'swap' } });
  await client.loadMarkets();

  // Get all USDT-settled perpetual futures
  const swaps = Object.values(client.markets).filter(
    (m) => m.swap && m.settle === 'USDT' && m.active
  );

  // Sort by some available metric or just list them
  // CCXT markets don't always have volume, so just list symbols
  const symbols = swaps.map(m => m.symbol).sort();

  console.log(`Total USDT perp futures on Bybit: ${symbols.length}`);
  console.log('');

  // Print top ones we want to test (manually curated high-volume list)
  const topSymbols = [
    'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT',
    'XRP/USDT:USDT', 'DOGE/USDT:USDT', 'ADA/USDT:USDT',
    'AVAX/USDT:USDT', 'LINK/USDT:USDT', 'DOT/USDT:USDT',
    'NEAR/USDT:USDT', 'ARB/USDT:USDT', 'OP/USDT:USDT',
    'APT/USDT:USDT', 'SUI/USDT:USDT', 'PEPE/USDT:USDT',
    'WIF/USDT:USDT', 'FET/USDT:USDT', 'INJ/USDT:USDT',
    'ATOM/USDT:USDT', 'FIL/USDT:USDT', 'LTC/USDT:USDT',
    'TIA/USDT:USDT', 'SEI/USDT:USDT', 'WLD/USDT:USDT',
    'MATIC/USDT:USDT', 'ORDI/USDT:USDT', 'JUP/USDT:USDT',
    'AAVE/USDT:USDT', 'MKR/USDT:USDT', 'UNI/USDT:USDT',
  ];

  // Verify which ones are available
  const available = topSymbols.filter(s => symbols.includes(s));
  const unavailable = topSymbols.filter(s => !symbols.includes(s));

  console.log(`Available (${available.length}):`);
  available.forEach(s => console.log(`  ${s}`));

  if (unavailable.length > 0) {
    console.log(`\nUnavailable (${unavailable.length}):`);
    unavailable.forEach(s => console.log(`  ${s}`));
  }

  // Print as comma-separated for cache script
  console.log('\nFor cache script:');
  console.log(available.join(','));
}

main().catch(console.error);
