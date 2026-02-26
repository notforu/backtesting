/**
 * Environment configuration with runtime validation via Zod.
 *
 * Call `validateEnv()` once at application startup (before any other module
 * reads from process.env). Subsequent calls to `getEnv()` return the cached
 * parsed result, so there is no performance cost.
 */
import { z } from 'zod';

const envSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────────────
  // Use z.string().min(1) instead of z.string().url() because postgres://
  // and postgresql:// URLs are not recognised by the WHATWG URL parser that
  // Zod's .url() relies on in older Node versions.
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://backtesting:backtesting@localhost:5432/backtesting'),

  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z
    .string()
    .default('3000')
    .transform((v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`PORT must be a valid port number, got: ${v}`);
      }
      return n;
    }),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // ── Optional integrations ─────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

/**
 * Returns the parsed environment object. Throws if the environment has not
 * yet been validated (i.e. `validateEnv()` was never called).
 */
export function getEnv(): Env {
  if (!_env) {
    // Lazily parse on first call so the module can be imported anywhere
    // without requiring an explicit boot sequence.
    _env = envSchema.parse(process.env);
  }
  return _env;
}

/**
 * Validates the current process environment against the schema.
 * Prints a human-readable error and exits with code 1 on failure.
 *
 * Call this once at the very start of `server.ts` (before `initDb()` etc.)
 * to surface misconfiguration early.
 */
export function validateEnv(): Env {
  try {
    _env = envSchema.parse(process.env);
    return _env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:');
      for (const issue of error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
      }
      process.exit(1);
    }
    throw error;
  }
}
