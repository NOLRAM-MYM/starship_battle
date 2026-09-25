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

/** Segredo padrão de desenvolvimento — inaceitável fora dele. */
export const SEGREDO_DE_DESENVOLVIMENTO = 'dev-secret-change-me';

/**
 * Segredo de assinatura dos tokens.
 *
 * Em produção, FALTAR é erro fatal. O padrão silencioso era pior que
 * nenhum: o segredo está escrito neste arquivo e nos `docker-compose`, e
 * quem lê o repositório assina um token para qualquer conta — inclusive a
 * de um administrador. Um servidor que sobe com ele não parece
 * comprometido; só está.
 */
export function resolveJwtSecret(
  bruto: string | undefined,
  nodeEnv: AppConfig['nodeEnv'],
): string {
  const valor = bruto?.trim();
  const ehProducao = nodeEnv === 'production';
  if (!valor || valor === SEGREDO_DE_DESENVOLVIMENTO) {
    if (ehProducao) {
      throw new Error(
        'JWT_SECRET ausente ou igual ao padrão de desenvolvimento. ' +
          'Defina um segredo próprio (ex.: openssl rand -base64 48) antes de subir em produção.',
      );
    }
    return SEGREDO_DE_DESENVOLVIMENTO;
  }
  if (ehProducao && valor.length < 32) {
    throw new Error('JWT_SECRET curto demais para produção: use ao menos 32 caracteres.');
  }
  return valor;
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
    jwtSecret: resolveJwtSecret(
      readEnv('JWT_SECRET'),
      (readEnv('NODE_ENV') as AppConfig['nodeEnv']) ?? 'development',
    ),
    jwtExpiresSec: intEnv('JWT_EXPIRES_SEC', 7 * 24 * 3600),
    bcryptCost: intEnv('BCRYPT_COST', 12),
    gameServerUrl: readEnv('GAME_SERVER_URL', 'ws://localhost:7777') ?? 'ws://localhost:7777',
  };
}
