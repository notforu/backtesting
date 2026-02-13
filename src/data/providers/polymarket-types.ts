/**
 * Type definitions for Polymarket API responses
 */

/**
 * Gamma API market response
 * Reference: https://gamma-api.polymarket.com/markets
 */
export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  clobTokenIds: string; // JSON string like '["token1","token2"]'
  endDate: string;
  category: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  image?: string;
  volume?: string;
  volumeNum?: number;
}

/**
 * CLOB API price point
 * Reference: https://clob.polymarket.com/prices-history
 */
export interface CLOBPricePoint {
  t: number; // Unix seconds
  p: number; // Probability 0-1
}

/**
 * CLOB API price history response
 */
export interface CLOBPriceHistory {
  history: CLOBPricePoint[];
}
