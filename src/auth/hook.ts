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

  // Extract token from header or query param
  let token: string | undefined;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    // Fallback: query param (for SSE endpoints)
    const queryToken = (request.query as Record<string, string>)?.token;
    if (queryToken) {
      token = queryToken;
    }
  }

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
