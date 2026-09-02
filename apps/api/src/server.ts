/**
 * Servidor Fastify. Monta CORS, rate limit e health checks.
 * Conexões com DB/Redis/NATS são lazy e opcionais em dev.
 */

import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config.js';
import { pingDatabase } from './db/postgres.js';
import { runMigrations } from './db/migrate.js';
import { pingRedis } from './db/redis.js';
import { pingNats } from './chat/nats.js';
import { authRoutes } from './auth/routes.js';
import { matchmakingRoutes } from './matchmaking/routes.js';
import { chatRoutes } from './chat/routes.js';
import { clanRoutes } from './clans/routes.js';
import { economyRoutes } from './economy/routes.js';
import { questRoutes } from './quests/routes.js';
import { progressionRoutes } from './progression/routes.js';
import { leaderboardRoutes } from './leaderboards/routes.js';
import { loadoutRoutes } from './loadouts/routes.js';
import { gmRoutes } from './gm/routes.js';

export interface BuildServerOptions {
  /** Para testes: desabilita plugins que exigem env real. */
  testMode?: boolean;
}

export async function buildServer(
  opts: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const config = loadConfig();

  // Em dev usamos pino-pretty; em prod/test, logger JSON puro.
  const loggerOpts: FastifyServerOptions['logger'] =
    config.nodeEnv === 'development'
      ? {
          level: config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss' },
          },
        }
      : { level: config.logLevel };

  const app: FastifyInstance = Fastify({
    logger: loggerOpts,
    disableRequestLogging: opts.testMode === true,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });
  await app.register(authRoutes);
  await app.register(matchmakingRoutes);
  await app.register(chatRoutes);
  await app.register(clanRoutes);
  await app.register(economyRoutes);
  await app.register(questRoutes);
  await app.register(progressionRoutes);
  await app.register(leaderboardRoutes);
  await app.register(loadoutRoutes);
  await app.register(gmRoutes);

  // Health endpoints.
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    const db = await pingDatabase();
    const redis = await pingRedis();
    const nats = await pingNats();
    const ready = db && redis && nats;
    if (!ready) {
      return reply.code(503).send({
        status: 'not-ready',
        db,
        redis,
        nats,
      });
    }
    return { status: 'ready', db, redis, nats };
  });

  return app;
}

export async function startServer(app: FastifyInstance): Promise<string> {
  const config = loadConfig();
  await app.listen({ port: config.port, host: config.host });
  return `${config.host}:${config.port}`;
}

// Bootstrap quando executado diretamente (node src/server.ts).
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /src[\\/]+server\.ts$/.test(process.argv[1]);
if (isMain) {
  const app = await buildServer();

  // Schemas e catálogo da loja são idempotentes; aplicamos no boot para
  // que uma instância nova já suba com o banco no formato esperado.
  // Falha aqui não impede o servidor de subir — o health check é quem
  // decide se ele entra no balanceador.
  const migrations = await runMigrations();
  if (!migrations.ran) {
    app.log.warn('sem DATABASE_URL: migrações puladas');
  } else {
    app.log.info({ applied: migrations.applied.length }, 'migrações aplicadas');
    for (const f of migrations.failed) {
      app.log.error({ file: f.file, error: f.error }, 'migração falhou');
    }
  }

  const addr = await startServer(app);
  app.log.info(`api listening on ${addr}`);
}
