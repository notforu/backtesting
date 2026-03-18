/**
 * Platform Settings API Routes
 *
 * Provides REST endpoints for platform-wide settings such as kill switch configuration.
 *
 * Endpoints:
 *   GET  /api/settings/kill-switch     — read both PT and LT kill switch settings
 *   PUT  /api/settings/kill-switch/pt  — update paper trading kill switch
 *   PUT  /api/settings/kill-switch/lt  — update live trading kill switch
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { getPlatformSetting, setPlatformSetting } from '../../data/db.js';

// ============================================================================
// Types
// ============================================================================

export interface KillSwitchConfig {
  enabled: boolean;
  ddPercent: number;
}

export interface KillSwitchSettings {
  pt: KillSwitchConfig;
  lt: KillSwitchConfig;
}

// ============================================================================
// Constants
// ============================================================================

const DB_KEY_PT = 'kill_switch_pt';
const DB_KEY_LT = 'kill_switch_lt';

const DEFAULT_KILL_SWITCH: KillSwitchConfig = { enabled: true, ddPercent: 30 };

// ============================================================================
// Validation schemas
// ============================================================================

const KillSwitchUpdateSchema = z.object({
  enabled: z.boolean(),
  ddPercent: z.number().min(1).max(99).optional(),
});

// ============================================================================
// Helpers
// ============================================================================

async function readKillSwitchConfig(key: string): Promise<KillSwitchConfig> {
  const raw = await getPlatformSetting(key);
  if (raw === null) return { ...DEFAULT_KILL_SWITCH };

  // Validate shape from DB — fall back to defaults for any missing field
  const parsed = raw as Partial<KillSwitchConfig>;
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_KILL_SWITCH.enabled,
    ddPercent:
      typeof parsed.ddPercent === 'number' ? parsed.ddPercent : DEFAULT_KILL_SWITCH.ddPercent,
  };
}

// ============================================================================
// Route plugin
// ============================================================================

export async function settingsRoutes(fastify: FastifyInstance) {
  // --------------------------------------------------------------------------
  // GET /api/settings/kill-switch
  // --------------------------------------------------------------------------
  fastify.get(
    '/api/settings/kill-switch',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const [pt, lt] = await Promise.all([
          readKillSwitchConfig(DB_KEY_PT),
          readKillSwitchConfig(DB_KEY_LT),
        ]);
        const response: KillSwitchSettings = { pt, lt };
        return reply.status(200).send(response);
      } catch (error) {
        fastify.log.error({ err: error, msg: 'Error reading kill switch settings' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({ error: message, code: 'INTERNAL_ERROR' });
      }
    },
  );

  // --------------------------------------------------------------------------
  // PUT /api/settings/kill-switch/pt
  // --------------------------------------------------------------------------
  fastify.put(
    '/api/settings/kill-switch/pt',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const parsed = KillSwitchUpdateSchema.parse(request.body);

        // Merge with existing config so ddPercent is preserved when not supplied
        const existing = await readKillSwitchConfig(DB_KEY_PT);
        const updated: KillSwitchConfig = {
          enabled: parsed.enabled,
          ddPercent: parsed.ddPercent ?? existing.ddPercent,
        };

        await setPlatformSetting(DB_KEY_PT, updated);
        return reply.status(200).send(updated);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error updating PT kill switch' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({ error: message, code: 'INTERNAL_ERROR' });
      }
    },
  );

  // --------------------------------------------------------------------------
  // PUT /api/settings/kill-switch/lt
  // --------------------------------------------------------------------------
  fastify.put(
    '/api/settings/kill-switch/lt',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const parsed = KillSwitchUpdateSchema.parse(request.body);

        const existing = await readKillSwitchConfig(DB_KEY_LT);
        const updated: KillSwitchConfig = {
          enabled: parsed.enabled,
          ddPercent: parsed.ddPercent ?? existing.ddPercent,
        };

        await setPlatformSetting(DB_KEY_LT, updated);
        return reply.status(200).send(updated);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.status(400).send({ error: 'Validation error', details: error.issues });
        }
        fastify.log.error({ err: error, msg: 'Error updating LT kill switch' });
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({ error: message, code: 'INTERNAL_ERROR' });
      }
    },
  );
}
