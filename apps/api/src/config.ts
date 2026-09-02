/**
 * Configuração carregada de env vars.
 * Valores ausentes viram undefined; consumers decidem se é fatal.
 */

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  natsUrl: string | undefined;

  jwtSecret: string;
  jwtExpiresSec: number;
  bcryptCost: number;

  /** URL default do game-server para o cliente conectar após match. */
  gameServerUrl: string;
}

function readEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: intEnv('PORT', 8080),
    // `::` e não `0.0.0.0`: o Node abre o socket em dual-stack, então a
    // API responde tanto em 127.0.0.1 quanto em ::1. Com `0.0.0.0` o
    // servidor só existia em IPv4, e um navegador que resolve
    // `localhost` para ::1 primeiro — o padrão no Windows — ficava
    // pendurado no login sem nem uma conexão recusada para mostrar.
    host: readEnv('HOST', '::') ?? '::',
    nodeEnv:
      (readEnv('NODE_ENV') as AppConfig['nodeEnv']) ?? 'development',
    logLevel:
      (readEnv('LOG_LEVEL') as AppConfig['logLevel']) ?? 'info',
    databaseUrl: readEnv('DATABASE_URL'),
    redisUrl: readEnv('REDIS_URL'),
    natsUrl: readEnv('NATS_URL'),
    jwtSecret: readEnv('JWT_SECRET', 'dev-secret-change-me') ?? 'dev-secret-change-me',
    jwtExpiresSec: intEnv('JWT_EXPIRES_SEC', 7 * 24 * 3600),
    bcryptCost: intEnv('BCRYPT_COST', 12),
    gameServerUrl: readEnv('GAME_SERVER_URL', 'ws://localhost:7777') ?? 'ws://localhost:7777',
  };
}
