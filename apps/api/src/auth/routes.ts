/**
 * Rotas HTTP de auth.
 *
 *   POST /auth/signup   { username, email, password } -> { account, token }
 *   POST /auth/login    { email, password }           -> { account, token }
 *   GET  /auth/me       Authorization: Bearer <jwt>   -> { account }
 *
 * Logout (Task 3.2.2) virá com session storage em Redis.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthError, getMe, login, signup } from './service.js';

const signupSchema = z.object({
  username: z
    .string()
    .min(3, 'username >= 3 chars')
    .max(32, 'username <= 32 chars')
    .regex(/^[a-zA-Z0-9_-]+$/, 'username: letras, números, _ ou -'),
  email: z.string().email('email inválido'),
  password: z.string().min(8, 'password >= 8 chars').max(128, 'password <= 128 chars'),
});

const loginSchema = z.object({
  email: z.string().email('email inválido'),
  password: z.string().min(1, 'password requerido'),
});

function mapAuthErrorCodeToHttp(
  code: AuthError['code'],
): { status: number; error: string } {
  switch (code) {
    case 'invalid_input':
      return { status: 400, error: 'invalid_input' };
    case 'email_taken':
    case 'username_taken':
      return { status: 409, error: code };
    case 'invalid_credentials':
      return { status: 401, error: 'invalid_credentials' };
    case 'db_unavailable':
      return { status: 503, error: 'db_unavailable' };
    case 'invalid_token':
      return { status: 401, error: 'invalid_token' };
  }
}

export const authRoutes: FastifyPluginAsync = async (
  app: FastifyInstance,
) => {
  app.post('/auth/signup', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        issues: parsed.error.issues,
      });
    }
    try {
      const { account, token } = await signup(
        parsed.data.username,
        parsed.data.email,
        parsed.data.password,
      );
      return reply.code(201).send({ account, token });
    } catch (err) {
      if (err instanceof AuthError) {
        const { status, error } = mapAuthErrorCodeToHttp(err.code);
        return reply.code(status).send({ error, message: err.message });
      }
      throw err;
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_input',
        issues: parsed.error.issues,
      });
    }
    try {
      const { account, token } = await login(
        parsed.data.email,
        parsed.data.password,
      );
      return { account, token };
    } catch (err) {
      if (err instanceof AuthError) {
        const { status, error } = mapAuthErrorCodeToHttp(err.code);
        return reply.code(status).send({ error, message: err.message });
      }
      throw err;
    }
  });

  app.get('/auth/me', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_token' });
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
      const account = await getMe(token);
      return { account };
    } catch (err) {
      if (err instanceof AuthError) {
        const { status, error } = mapAuthErrorCodeToHttp(err.code);
        return reply.code(status).send({ error, message: err.message });
      }
      throw err;
    }
  });
};
