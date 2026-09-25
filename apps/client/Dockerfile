# Multi-stage Dockerfile para @batle/client.
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @batle/client run build

# Stage 2: servidor web estático (Nginx)
FROM nginx:alpine AS runtime

COPY --from=build /app/apps/client/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
