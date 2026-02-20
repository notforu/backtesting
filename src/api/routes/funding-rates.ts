/**
 * Funding Rate API Routes
 * Provides access to funding rate data stored in the database
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getFundingRates } from '../../data/db.js';

const FundingRatesQuerySchema = z.object({
  exchange: z.string(),
  symbol: z.string(),
  start: z.string().transform((s) => parseInt(s, 10)),
  end: z.string().transform((s) => parseInt(s, 10)),
});

export async function fundingRateRoutes(fastify: FastifyInstance) {
  fastify.get('/api/funding-rates', async (request, reply) => {
    try {
      const { exchange, symbol, start, end } = FundingRatesQuerySchema.parse(request.query);
      const rates = await getFundingRates(exchange, symbol, start, end);
      return reply.status(200).send({ rates });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid query parameters', details: error.issues });
      }
      if (error instanceof Error) {
        return reply.status(500).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Unknown error' });
    }
  });
}
