/**
 * Polymarket market metadata caching
 * Stores market information in PostgreSQL database
 */

import { getPool } from './db.js';
import type { GammaMarket } from './providers/polymarket-types.js';

/**
 * Get market metadata by slug
 */
export async function getMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE slug = $1`,
    [slug]
  );

  const row = result.rows[0];
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
    active: row.active,
    closed: row.closed,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  };
}

/**
 * Save market metadata to cache
 */
export async function saveMarket(market: GammaMarket): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO polymarket_markets
    (id, question, slug, condition_id, clob_token_ids, end_date, category, liquidity, active, closed, image, volume, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      question = EXCLUDED.question,
      slug = EXCLUDED.slug,
      condition_id = EXCLUDED.condition_id,
      clob_token_ids = EXCLUDED.clob_token_ids,
      end_date = EXCLUDED.end_date,
      category = EXCLUDED.category,
      liquidity = EXCLUDED.liquidity,
      active = EXCLUDED.active,
      closed = EXCLUDED.closed,
      image = EXCLUDED.image,
      volume = EXCLUDED.volume,
      updated_at = EXCLUDED.updated_at`,
    [
      market.id,
      market.question,
      market.slug,
      market.conditionId,
      market.clobTokenIds,
      market.endDate || null,
      market.category || null,
      market.liquidity || null,
      market.active,
      market.closed,
      market.image ?? null,
      market.volume ?? null,
      Date.now(),
    ]
  );
}

/**
 * Search markets by question text
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 20)
 */
export async function searchMarkets(query: string, limit: number = 20): Promise<GammaMarket[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE question LIKE '%' || $1 || '%' OR slug LIKE '%' || $2 || '%'
    ORDER BY active DESC, updated_at DESC
    LIMIT $3`,
    [query, query, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    question: row.question,
    slug: row.slug,
    conditionId: row.condition_id,
    clobTokenIds: row.clob_token_ids,
    endDate: row.end_date ?? '',
    category: row.category ?? '',
    liquidity: row.liquidity ?? '',
    active: row.active,
    closed: row.closed,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  }));
}

/**
 * Get markets by category
 */
export async function getMarketsByCategory(category: string): Promise<GammaMarket[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
      id, question, slug, condition_id, clob_token_ids,
      end_date, category, liquidity, active, closed, image, volume
    FROM polymarket_markets
    WHERE category = $1
    ORDER BY active DESC, updated_at DESC`,
    [category]
  );

  return result.rows.map((row) => ({
    id: row.id,
    question: row.question,
    slug: row.slug,
    conditionId: row.condition_id,
    clobTokenIds: row.clob_token_ids,
    endDate: row.end_date ?? '',
    category: row.category ?? '',
    liquidity: row.liquidity ?? '',
    active: row.active,
    closed: row.closed,
    image: row.image ?? undefined,
    volume: row.volume ?? undefined,
  }));
}
