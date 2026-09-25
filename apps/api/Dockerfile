# Multi-stage Dockerfile para @batle/api.
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/client/package.json apps/client/

RUN pnpm install --frozen-lockfile=false

COPY apps/api apps/api

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY --chown=node:node --from=build /app ./

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["pnpm", "--filter", "@batle/api", "start"]
