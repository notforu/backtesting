/**
 * Data provider factory and registry
 * Central point for creating data providers
 */

import { type DataProvider } from './base.js';
import { BinanceProvider } from './binance.js';

/**
 * Supported exchange identifiers
 */
export type SupportedExchange = 'binance';

/**
 * Registry of available providers
 */
const providerRegistry: Record<SupportedExchange, () => DataProvider> = {
  binance: () => new BinanceProvider(),
};

/**
 * Get a data provider for the specified exchange
 * @param exchange - Exchange identifier (e.g., 'binance')
 * @returns DataProvider instance
 * @throws Error if exchange is not supported
 */
export function getProvider(exchange: string): DataProvider {
  const factory = providerRegistry[exchange as SupportedExchange];

  if (!factory) {
    const supported = Object.keys(providerRegistry).join(', ');
    throw new Error(
      `Exchange "${exchange}" is not supported. Supported exchanges: ${supported}`
    );
  }

  return factory();
}

/**
 * Get list of supported exchanges
 */
export function getSupportedExchanges(): string[] {
  return Object.keys(providerRegistry);
}

/**
 * Check if an exchange is supported
 */
export function isExchangeSupported(exchange: string): boolean {
  return exchange in providerRegistry;
}

// Re-export types and classes
export { type DataProvider, RateLimiter } from './base.js';
export { BinanceProvider } from './binance.js';
