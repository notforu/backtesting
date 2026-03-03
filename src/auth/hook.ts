import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './jwt.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      username: string;
      role: string;
    };
  }
}

const PUBLIC_PREFIXES = ['/api/health', '/api/auth/'];

// Routes that allow unauthenticated GET requests (read-only public access).
// POST, DELETE, PATCH on these routes still require authentication.
const PUBLIC_GET_PREFIXES = ['/api/paper-trading/', '/api/paper-trading', '/api/candles', '/api/funding-rates'];

/**
 * Extract the bearer token from request headers or query params.
 * Returns undefined if no token is present.
 */
function extractToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const queryToken = (request.query as Record<string, string>)?.token;
  return queryToken || undefined;
}

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = request.url.split('?')[0];

  // Only protect /api/ routes — skip auth for static files, SPA fallback, etc.
  if (!url.startsWith('/api/')) {
    return;
  }

  // Skip auth for public API routes
  for (const prefix of PUBLIC_PREFIXES) {
    if (url === prefix.replace(/\/$/, '') || url.startsWith(prefix)) {
      return;
    }
  }

  // Allow unauthenticated GET requests to public-read routes.
  // Still try to attach user from token if present (e.g. for ownership checks).
  if (request.method === 'GET') {
    for (const prefix of PUBLIC_GET_PREFIXES) {
      if (url === prefix.replace(/\/$/, '') || url.startsWith(prefix)) {
        const token = extractToken(request);
        if (token) {
          try {
            const payload = verifyToken(token);
            request.user = { userId: payload.userId, username: payload.username, role: payload.role };
          } catch {
            // Invalid token on public GET — continue without user
          }
        }
        return;
      }
    }
  }

  // Extract token from header or query param
  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  try {
    const payload = verifyToken(token);
    request.user = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
    };
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token', code: 'AUTH_INVALID_TOKEN' });
  }
}
