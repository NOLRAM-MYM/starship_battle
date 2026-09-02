# Fase 3 — API, Accounts, Matchmaking, Chat, Clãs, Kubernetes

**Data:** 2026-08-31
**Status:** ✅ Concluída (2026-08-31)
**Dependência:** Fase 2 ✅ (game-server autoritativo + cliente + armas)

## 1. Objetivo

Elevar o jogo de "duas instâncias conectam" para um sistema multi-usuário completo:
- accounts persistentes (sign up / login com sessão JWT);
- matchmaking que forma partidas e atribui servidores de jogo;
- chat em múltiplos canais (global, time, clã, DM);
- clãs com hierarquia (líder, oficial, membro);
- deploy horizontal em Kubernetes com HPA.

## 2. Arquitetura

```
                ┌────────────────────────┐
                │   apps/client (web)    │
                │   apps/api (Fastify)   │
                │   crates/game-server   │
                └────────────────────────┘
                          │       │        │
                          ▼       ▼        ▼
                      ┌─────────────────────────┐
                      │   PostgreSQL (state)    │
                      │   Redis (sessions/queue)│
                      │   NATS (chat fanout)    │
                      └─────────────────────────┘
```

**apps/api (Node.js, Fastify 5, TypeScript)**
- HTTP REST: `/v1/auth/*`, `/v1/accounts/*`, `/v1/clans/*`, `/v1/matchmaking/*`, `/v1/chat/*`
- Health: `/healthz` (liveness), `/readyz` (readiness)
- Conexão Postgres via `pg` (Pool), Redis via `ioredis`, NATS via `nats.js`

**PostgreSQL (schema)**
- `accounts` (id uuid, email unique, password_hash, display_name, created_at)
- `sessions` (token, account_id, expires_at)
- `clans` (id, name unique, tag unique, leader_id, created_at)
- `clan_members` (clan_id, account_id, role, joined_at)
- `clan_invites` (clan_id, account_id, invited_by, created_at, accepted_at)
- `match_history` (id, account_id, result, score, created_at)

**Redis**
- `session:{token}` → account_id (TTL 7d)
- `mm:queue:{mode}` → lista de player_id (FIFO)
- `mm:party:{party_id}` → hash com membros

**NATS**
- Subject `chat.global`, `chat.team.{team_id}`, `chat.clan.{clan_id}`, `chat.dm.{a}.{b}`
- Pub/sub para distribuir mensagens entre instâncias da API

**game-server permanece intocado** — ele continua sendo autoridade da simulação. A API
apenas gerencia identidade, matchmaking, persistência e chat.

## 3. Tasks (granulares)

### Task 3.1 — Setup app API (Fastify)
- Criar `apps/api/package.json` com Fastify 5, pg, ioredis, nats.js, jsonwebtoken, bcrypt, zod
- Estrutura: `src/server.ts`, `src/routes/`, `src/db/`, `src/auth/`
- `src/server.ts` carrega env, abre pool Postgres, conecta Redis, conecta NATS
- Health checks: `/healthz` (200 sempre) e `/readyz` (verifica DB+Redis+NATS)
- Logging com pino (default do Fastify)
- Validação de input com zod
- 1 teste: server start/stop

### Task 3.2 — Accounts (sign up / login / JWT)
- `POST /v1/auth/signup` { email, password, display_name } → cria account
- `POST /v1/auth/login` { email, password } → { token, account }
- `POST /v1/auth/logout` (com Authorization) → invalida token
- `GET /v1/accounts/me` (com Authorization) → account
- Senhas com bcrypt (cost 12)
- Tokens JWT (HS256), expira em 7d, payload `{ sub: account_id }`
- Sessions persistidas em Redis para revogação
- 5 testes: signup, login, logout, me, duplicate email

### Task 3.3 — Matchmaking
- `POST /v1/matchmaking/queue` { mode: 'duel' | 'team4' } → entra na fila
- `DELETE /v1/matchmaking/queue` → sai da fila
- Worker que drena a fila a cada 1s, agrupa por modo e dispara `match_found`
- Ao formar partida, aloca um `game-server` (mockado: retorna URL de ws://localhost:7777)
- Notifica via NATS `match.found.{account_id}` (push para cliente conectado)
- Persistir match_history
- 4 testes: queue join/leave, match formation, match_history

### Task 3.4 — Chat
- `POST /v1/chat/messages` { channel, body } → publica
- `GET /v1/chat/messages?channel=...&since=...` → histórico (últimas N)
- Channels: `global`, `team:{team_id}`, `clan:{clan_id}`, `dm:{a_id}:{b_id}` (ordenado)
- Mensagens efêmeras: 24h TTL em Redis
- 3 testes: post, fetch, ordering

### Task 3.5 — Clãs
- `POST /v1/clans` { name, tag } → cria clã, vira líder
- `GET /v1/clans/:id` → info do clã
- `POST /v1/clans/:id/invite` { account_id } → cria invite
- `POST /v1/clans/invites/:id/accept` → entra no clã
- `POST /v1/clans/:id/kick` { account_id } (só líder) → remove
- `POST /v1/clans/:id/leave` (membro) → sai
- 4 testes: criar, invite, accept, kick

### Task 3.6 — Helm + Kubernetes HPA
- `deploy/helm/space-battle/` com Chart.yaml, values.yaml
- Templates: `deployment-api`, `deployment-game-server`, `service-api`, `service-game-server`,
  `ingress`, `configmap`, `secret`, `hpa-api`, `hpa-game-server`
- HPA: scale em CPU (target 70%) e em connections (custom metric)
- StatefulSet para Postgres? Não: usar managed (RDS/Cloud SQL) — apenas Secret
- Documentação em `deploy/helm/README.md`

## 4. Critérios de Sucesso

- API responde 200 em `/healthz` mesmo sem DB (liveness separado de readiness)
- Signup → login → `/me` funciona com 5 testes de integração
- Matchmaking forma duelos a cada ~5s com 2+ players na fila
- Chat entrega mensagens entre 2 clientes conectados
- Clã: 3 membros via invite/accept
- `helm install` provisiona 2 réplicas da API + 2 réplicas do game-server
- HPA escala API de 2 → 5 réplicas sob carga sintética

## 5. Não-Objetivos (escopo fora)

- WebSocket gateway para chat (vai via NATS, clientes usam SSE ou polling)
- OAuth / 2FA
- Anti-cheat
- Billing
- WebXR / mobile (Fase 5)
- Migração para bevy_ecs Schedule (fica para Fase 4 se necessário)

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Postgres não disponível em dev | Usar `pg-mem` (in-memory) nos testes; produção usa Postgres real |
| NATS overhead em dev | Usar canal in-process como fallback; NATS é produção |
| HPA não testar carga real | Documentar como rodar `k6`/Locust para validar |
| Rate limit / abuse | Adicionar `fastify-rate-limit` desde o início |

## 7. Status Final (entregue)

### 7.1. Apps criados / expandidos
- `apps/api/` — Fastify 5 + TypeScript estrito (`verbatimModuleSyntax`, `exactOptionalPropertyTypes`).
  - Dependências: `fastify 5.0`, `@fastify/cors 10`, `@fastify/rate-limit 10`, `pg 8.13`, `ioredis 5.4`, `nats 2.28`, `jsonwebtoken 9`, `bcrypt 5`, `zod 3.23`, `pino-pretty 11`.
  - Conexões externas opcionais: o servidor sobe sem DB/Redis/NATS em dev.

### 7.2. Módulos
- `src/config.ts` — `loadConfig()` com env vars; `JWT_SECRET` default `dev-secret-change-me`.
- `src/db/{postgres,redis}.ts` — pools lazy, `pingXxx()`.
- `src/chat/nats.ts` — `NatsConnection` async lazy.
- `src/server.ts` — `buildServer({ testMode })` + `startServer` + bootstrap via `node --import tsx`.
- `src/healthz` 200, `readyz` 503 quando qualquer dependência está down.
- `src/auth/` — `passwords.ts` (bcrypt 12), `tokens.ts` (JWT HS256), `types.ts` (`Account`/`PublicAccount`), `repository.ts` (CRUD Postgres), `service.ts` (`signup/login/getMe` com `AuthError`), `routes.ts` (3 endpoints).
- `src/matchmaking/` — `queue.ts` (ZSET Redis), `party.ts` (HASH Redis), `service.ts` (skill-based com relaxamento por espera, `findCompatible`, `partyAverageSkill`, `TEAM_SIZES`), `routes.ts` (party CRUD + queue enqueue/dequeue/status).
- `src/chat/` — `types.ts`, `store.ts` (LIST com LTRIM + EXPIRE 24h), `publish.ts` (NATS subjects), `service.ts` (sanitização, rate-limit in-process 500ms), `routes.ts` (8 endpoints: global/team/dm GET+POST).
- `src/clans/` — `types.ts` (`Clan`/`ClanMember`/`ClanRole` + `isRoleAtLeast`), `schema.sql` (3 tabelas + 6 índices), `repository.ts` (CRUD), `service.ts` (12 funções), `routes.ts` (12 endpoints).

### 7.3. Infraestrutura
- `apps/api/Dockerfile` — multi-stage: `node:22-alpine`, pnpm via corepack, `node --import tsx` no CMD, user 1000, `readOnlyRootFilesystem`.
- `infra/helm/batle-api/` — Chart v0.1.0:
  - `Chart.yaml`, `values.yaml`, `.helmignore`
  - templates: `deployment.yaml`, `service.yaml`, `hpa.yaml` (autoscaling/v2 CPU+Memory), `ingress.yaml` (networking.k8s.io/v1), `secret.yaml`, `serviceaccount.yaml`, `_helpers.tpl`
  - Probes HTTP `/healthz`/`/readyz`
  - Security: runAsNonRoot, readOnlyRootFilesystem, drop ALL capabilities
- `scripts/lint-helm.mjs` — valida YAML puro (Chart/values) + verifica delimitadores Helm balanceados em templates. Script `pnpm lint:helm` no workspace raiz.

### 7.4. Testes (vitest)
- 5 arquivos de teste, 63 testes, 100% passing:
  - `test/health.test.ts` (2)
  - `test/auth.test.ts` (12 — bcrypt + JWT + routes com 503 quando DB down)
  - `test/matchmaking.test.ts` (16 — algoritmo puro + 6 endpoints com 401/400/503)
  - `test/chat.test.ts` (14 — helpers + 8 endpoints)
  - `test/clans.test.ts` (19 — hierarquia + 12 endpoints)
- TypeScript: `tsc --noEmit` limpo em todos os módulos.
- Helm: `pnpm lint:helm` valida 8 arquivos sem erros.

### 7.5. Como rodar
- Dev (sem DB/Redis/NATS): `pnpm --filter @batle/api dev`
- Testes: `pnpm --filter @batle/api test`
- Helm: `pnpm lint:helm` ou `helm install` (com K8s configurado)
- Build de imagem: `docker build -t batle/api:0.1.0 -f apps/api/Dockerfile .`

## 8. Próximos Passos (Fase 4+)
- Worker de match periódico (loop em produção, separado do API)
- Transferência de liderança de clã
- Sessões revogáveis (logout real via Redis blacklist)
- Chat realtime via SSE ou WebSocket
- Migração para bevy_ecs Schedule no game-server (se 100+ players)
