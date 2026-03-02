import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { getUserByUsername, verifyPassword, generateToken } from '../../auth/index.js';

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { username, password } = LoginSchema.parse(request.body);

      const user = await getUserByUsername(username);
      if (!user) {
        return reply.status(401).send({ error: 'Invalid username or password', code: 'AUTH_INVALID_CREDENTIALS' });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid username or password', code: 'AUTH_INVALID_CREDENTIALS' });
      }

      const token = generateToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });

      return reply.status(200).send({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      fastify.log.error({ err: error, msg: 'Login error' });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/auth/me
  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Not authenticated' });
    }
    return reply.status(200).send({
      id: request.user.userId,
      username: request.user.username,
      role: request.user.role,
    });
  });
}
