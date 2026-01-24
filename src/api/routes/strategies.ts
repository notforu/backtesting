/**
 * Strategy API routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listStrategies,
  getStrategyDetails,
  getAllStrategyDetails,
} from '../../strategy/index.js';

export async function strategyRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/strategies
   * List all available strategies
   */
  fastify.get('/api/strategies', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const strategies = await getAllStrategyDetails();
      return reply.status(200).send(strategies);
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

  /**
   * GET /api/strategies/names
   * List just strategy names (lightweight)
   */
  fastify.get('/api/strategies/names', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const names = await listStrategies();
      return reply.status(200).send(names);
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

  /**
   * GET /api/strategies/:name
   * Get strategy details by name
   */
  fastify.get('/api/strategies/:name', async (
    request: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { name } = request.params;
      const details = await getStrategyDetails(name);
      return reply.status(200).send(details);
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a not found error
        if (error.message.includes('not found')) {
          return reply.status(404).send({
            error: error.message,
          });
        }
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
