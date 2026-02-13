/**
 * Polymarket API routes
 * Routes for browsing and searching Polymarket prediction markets
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

// Query schema for market search
const MarketsQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  active: z.string().optional().transform((s) => s === 'true' ? 'true' : s === 'false' ? 'false' : undefined),
  closed: z.string().optional().transform((s) => s === 'true' ? 'true' : s === 'false' ? 'false' : undefined),
  limit: z.string().optional().transform((s) => s ? parseInt(s, 10) : 50),
});

type MarketsQuery = z.infer<typeof MarketsQuerySchema>;

// Params schema for single market
const MarketParamsSchema = z.object({
  slug: z.string().min(1),
});

type MarketParams = z.infer<typeof MarketParamsSchema>;

export async function polymarketRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/polymarket/markets
   * Search/browse Polymarket markets
   * Query params: search, category, active, closed, limit
   */
  fastify.get('/api/polymarket/markets', async (
    request: FastifyRequest<{ Querystring: MarketsQuery }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate and parse query params
      const parsed = MarketsQuerySchema.parse(request.query);

      // Build query params for Gamma API
      const params = new URLSearchParams();
      if (parsed.search) params.append('search', parsed.search);
      if (parsed.category) params.append('category', parsed.category);
      if (parsed.active !== undefined) params.append('active', parsed.active);
      if (parsed.closed !== undefined) params.append('closed', parsed.closed);
      params.append('limit', String(parsed.limit));

      // Fetch from Gamma API
      const url = `https://gamma-api.polymarket.com/markets?${params}`;
      fastify.log.info(`Fetching markets from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        fastify.log.error(`Gamma API error: ${response.status} - ${errorText}`);
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const markets = await response.json();
      fastify.log.info(`Retrieved ${Array.isArray(markets) ? markets.length : 0} markets`);

      return reply.status(200).send(markets);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.issues,
        });
      }

      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }

      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/polymarket/markets/:slug
   * Get single market details by slug
   */
  fastify.get('/api/polymarket/markets/:slug', async (
    request: FastifyRequest<{ Params: MarketParams }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate params
      const { slug } = MarketParamsSchema.parse(request.params);

      // Fetch from Gamma API by slug
      const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`;
      fastify.log.info(`Fetching market by slug: ${slug}`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        fastify.log.error(`Gamma API error: ${response.status} - ${errorText}`);
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const markets = await response.json();

      if (!Array.isArray(markets) || markets.length === 0) {
        return reply.status(404).send({
          error: `Market "${slug}" not found`,
        });
      }

      return reply.status(200).send(markets[0]);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.issues,
        });
      }

      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }

      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });

  /**
   * GET /api/polymarket/categories
   * Get available market categories
   */
  fastify.get('/api/polymarket/categories', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      // Fetch a large batch of active markets to extract categories
      const url = 'https://gamma-api.polymarket.com/markets?limit=500&active=true';
      fastify.log.info('Fetching markets to extract categories');

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        fastify.log.error(`Gamma API error: ${response.status} - ${errorText}`);
        throw new Error(`Gamma API error: ${response.status}`);
      }

      const markets = await response.json();

      // Extract unique categories and sort them
      const categories = [...new Set(
        markets
          .map((m: any) => m.category)
          .filter((cat: any) => cat !== null && cat !== undefined && cat !== '')
      )].sort();

      fastify.log.info(`Extracted ${categories.length} unique categories`);

      return reply.status(200).send(categories);
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(500).send({
          error: error.message,
        });
      }

      return reply.status(500).send({
        error: 'Unknown error occurred',
      });
    }
  });
}
