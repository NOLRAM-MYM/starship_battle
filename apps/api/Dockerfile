# Multi-stage Dockerfile para @batle/api.
#
# Stage 1: deps + build (gera node_modules completo).
# Stage 2: runtime (apenas prod deps + dist + src, sem devDependencies).
#
# Build:
#   docker build -t batle/api:0.1.0 -f apps/api/Dockerfile .
#
# Run (dev):
#   docker run --rm -p 8080:8080 \
#     -e DATABASE_URL=postgres://... \
#     -e REDIS_URL=redis://... \
#     -e NATS_URL=nats://... \
#     -e JWT_SECRET=changeme \
#     batle/api:0.1.0

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Habilita pnpm via corepack.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copia apenas manifestos para cache de layers.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages packages 2>/dev/null || true
COPY apps/client/package.json apps/client/ 2>/dev/null || true

# Instala TODAS as deps (incluindo dev) para fazer build.
RUN pnpm install --frozen-lockfile=false

# Copia o código-fonte da API.
COPY apps/api apps/api

# Build de tipo (não emite JS; tsx roda TS direto).
# Mantido como sanity check.
RUN pnpm --filter @batle/api exec tsc --noEmit

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Instala apenas deps de prod.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
RUN pnpm install --prod --frozen-lockfile=false

# Copia src e tsconfig.
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/tsconfig.base.json ./

# Usuário não-root.
RUN addgroup -g 1000 -S app && adduser -u 1000 -S app -G app \
 && chown -R app:app /app
USER app

EXPOSE 8080

# Health check básico (o K8s livenessProbe complementa).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["sh", "-c", "node --import tsx apps/api/src/server.ts"]
