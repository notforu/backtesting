/**
 * Data provider factory and registry
 * Central point for creating data providers
 */

import { type DataProvider } from './base.js';
import { BinanceProvider } from './binance.js';
import { BybitProvider } from './bybit.js';
import { PolymarketProvider } from './polymarket.js';
import { ManifoldProvider } from './manifold.js';

/**
 * Supported exchange identifiers
 */
export type SupportedExchange = 'binance' | 'bybit' | 'polymarket' | 'manifold';

/**
 * Registry of provider factories
 */
const providerRegistry: Record<SupportedExchange, () => DataProvider> = {
  binance: () => new BinanceProvider(),
  bybit: () => new BybitProvider(),
  polymarket: () => new PolymarketProvider(),
  manifold: () => new ManifoldProvider(),
};

/**
 * Cache of provider instances (singleton pattern)
 * CCXT clients are heavy and should be reused
 */
const providerCache = new Map<string, DataProvider>();

/**
 * Get a data provider for the specified exchange
 * Uses cached instance to avoid creating multiple CCXT clients
 * @param exchange - Exchange identifier (e.g., 'binance')
 * @returns DataProvider instance (cached/singleton)
 * @throws Error if exchange is not supported
 */
export function getProvider(exchange: string): DataProvider {
  // Check cache first
  const cached = providerCache.get(exchange);
  if (cached) {
    return cached;
  }

  const factory = providerRegistry[exchange as SupportedExchange];

  if (!factory) {
    const supported = Object.keys(providerRegistry).join(', ');
    throw new Error(
      `Exchange "${exchange}" is not supported. Supported exchanges: ${supported}`
    );
  }

  // Create and cache the provider
  const provider = factory();
  providerCache.set(exchange, provider);
  return provider;
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
export { BybitProvider } from './bybit.js';
export { PolymarketProvider } from './polymarket.js';
export { ManifoldProvider } from './manifold.js';
