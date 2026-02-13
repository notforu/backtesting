/**
 * Polymarket market metadata caching
 * Stores market information in SQLite database
 */

import { getDb } from './db.js';
import type { GammaMarket } from './providers/polymarket-types.js';

/**
 * Get market metadata by slug
 */
export function getMarketBySlug(slug: string): GammaMarket | null {
  const database = getDb();
  const select = database.prepare<[string], {
    id: string;
    question: string;
    slug: string;
    condition_id: string;
    clob_token_ids: string;
    end_date: string | null;
    category: string | null;
    liquidity: string | null;
    active: number;
    closed: number;
    image: string | null;
    volume: string | null;
  }>(`
    SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE slug = ?
  `);

  const row = select.get(slug);
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    question: row.question,
    slug: row.slug,
    conditionId: row.condition_id,
    clobTokenIds: row.clob_token_ids,
    endDate: row.end_date ?? '',
    category: row.category ?? '',
    liquidity: row.liquidity ?? '',
    active: row.active === 1,
    closed: row.closed === 1,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  };
}

/**
 * Save market metadata to cache
 */
export function saveMarket(market: GammaMarket): void {
  const database = getDb();
  const insert = database.prepare(`
    INSERT OR REPLACE INTO polymarket_markets
    (id, question, slug, condition_id, clob_token_ids, end_date, category, liquidity, active, closed, image, volume, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    market.id,
    market.question,
    market.slug,
    market.conditionId,
    market.clobTokenIds,
    market.endDate || null,
    market.category || null,
    market.liquidity || null,
    market.active ? 1 : 0,
    market.closed ? 1 : 0,
    market.image ?? null,
    market.volume ?? null,
    Date.now()
  );
}

/**
 * Search markets by question text
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 20)
 */
export function searchMarkets(query: string, limit: number = 20): GammaMarket[] {
  const database = getDb();
  const select = database.prepare<[string, string, number], {
    id: string;
    question: string;
    slug: string;
    condition_id: string;
    clob_token_ids: string;
    end_date: string | null;
    category: string | null;
    liquidity: string | null;
    active: number;
    closed: number;
    image: string | null;
    volume: string | null;
  }>(`
    SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE question LIKE '%' || ? || '%' OR slug LIKE '%' || ? || '%'
    ORDER BY active DESC, updated_at DESC
    LIMIT ?
  `);

  const rows = select.all(query, query, limit);
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    slug: row.slug,
    conditionId: row.condition_id,
    clobTokenIds: row.clob_token_ids,
    endDate: row.end_date ?? '',
    category: row.category ?? '',
    liquidity: row.liquidity ?? '',
    active: row.active === 1,
    closed: row.closed === 1,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  }));
}

/**
 * Get markets by category
 */
export function getMarketsByCategory(category: string): GammaMarket[] {
  const database = getDb();
  const select = database.prepare<[string], {
    id: string;
    question: string;
    slug: string;
    condition_id: string;
    clob_token_ids: string;
    end_date: string | null;
    category: string | null;
    liquidity: string | null;
    active: number;
    closed: number;
    image: string | null;
    volume: string | null;
  }>(`
    SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE category = ?
    ORDER BY active DESC, updated_at DESC
  `);

  const rows = select.all(category);
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    slug: row.slug,
    conditionId: row.condition_id,
    clobTokenIds: row.clob_token_ids,
    endDate: row.end_date ?? '',
    category: row.category ?? '',
    liquidity: row.liquidity ?? '',
    active: row.active === 1,
    closed: row.closed === 1,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  }));
}
