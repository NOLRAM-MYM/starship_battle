# Fase 7 — LiveOps & Metagame

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIO: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Steps usam checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar sistemas de engajamento contínuo (Leaderboards, Missões Diárias) e persistência em nuvem dos loadouts de naves construídos pelos jogadores.

**Status:** ✅ Concluída

**Architecture:** 
- **Leaderboards**: Utilização de Sorted Sets no Redis (`ZADD`, `ZREVRANGE`) para rankings em tempo real (Top XP, Top Kills, Top Wealth), com rotas expostas no Fastify.
- **Missões Diárias**: Expansão do módulo `quests` no PostgreSQL para suportar ciclo de renovação (diário/semanal), permitindo que missões sejam re-aceitas após reset.
- **Persistência de Loadouts**: Migração do `loadoutRepo.ts` do cliente (IndexedDB) para o backend (PostgreSQL via Fastify), garantindo que as naves construídas acompanhem a conta do jogador (Auth JWT) em qualquer dispositivo.

**Tech Stack:** Fastify (Node.js/TS), Redis, PostgreSQL, TypeScript (Vitest).

---

## 1. Escopo e Tasks

### Task 7.1: Módulo de Leaderboards na API

**Files:**
- Create: `apps/api/src/leaderboards/routes.ts`
- Create: `apps/api/src/leaderboards/service.ts`
- Create: `apps/api/tests/leaderboards.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Escrever testes (TDD)**

```typescript
// apps/api/tests/leaderboards.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { leaderboardsRoutes } from '../src/leaderboards/routes';
import { redisClient } from '../src/db/redis';

describe('Leaderboards API', () => {
  const app = Fastify();
  app.register(leaderboardsRoutes);

  beforeEach(async () => {
    await redisClient.del('leaderboard:xp');
    await redisClient.zadd('leaderboard:xp', 100, 'player1', 500, 'player2', 300, 'player3');
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /leaderboards/xp retorna o top 10', async () => {
    const res = await app.inject({ method: 'GET', url: '/leaderboards/xp' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ranking).toHaveLength(3);
    expect(json.ranking[0].username).toBe('player2');
    expect(json.ranking[0].score).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**
Run: `pnpm --filter api test`
Expected: FAIL (arquivos não existem)

- [ ] **Step 3: Implementar o Service e as Rotas**
Criar `service.ts` com funções `getTopPlayers(board: string)` chamando `redisClient.zrevrange(key, 0, 9, 'WITHSCORES')`. Criar `routes.ts` registrando `GET /leaderboards/:board`. E registrar o plugin no `server.ts`.

- [ ] **Step 4: Rodar o teste e ver passar**
Run: `pnpm --filter api test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/leaderboards apps/api/tests/leaderboards.test.ts apps/api/src/server.ts
git commit -m "feat(api): leaderboards module with redis sorted sets"
```

---

### Task 7.2: Atualizar XP para alimentar o Leaderboard

**Files:**
- Modify: `apps/api/src/progression/service.ts`
- Modify: `apps/api/tests/progression.test.ts` (ou equivalente)

- [ ] **Step 1: Atualizar testes**
Modificar o teste de `addXpService` para verificar se ele chama `redisClient.zincrby('leaderboard:xp', amount, username)`. Como o `addXpService` só recebe `accountId`, você precisará buscar o username no DB ou passar como parâmetro.

- [ ] **Step 2: Rodar o teste e ver falhar**
Run: `pnpm --filter api test`

- [ ] **Step 3: Implementar a sincronização**
No `addXpService` (em `apps/api/src/progression/service.ts`), após inserir no Postgres, buscar o username (via tabela `accounts`) e atualizar o Redis: `await redisClient.zincrby('leaderboard:xp', amount, username)`.

- [ ] **Step 4: Rodar o teste e ver passar**
Run: `pnpm --filter api test`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/progression
git commit -m "feat(api): sync xp gains to redis leaderboard"
```

---

### Task 7.3: Persistência de Loadouts no Backend (PostgreSQL)

**Files:**
- Create: `apps/api/src/loadouts/schema.sql`
- Create: `apps/api/src/loadouts/repository.ts`
- Create: `apps/api/src/loadouts/service.ts`
- Create: `apps/api/src/loadouts/routes.ts`
- Create: `apps/api/tests/loadouts.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar schema SQL e rodar migration**
Criar `apps/api/src/loadouts/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS loadouts (
    id UUID PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    ship_template_id VARCHAR(40) NOT NULL,
    components JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

- [ ] **Step 2: Escrever testes TDD para a API**
Testes para `GET /loadouts`, `POST /loadouts`, `DELETE /loadouts/:id`.

- [ ] **Step 3: Implementar Rotas e Serviços**
Criar as operações de CRUD para loadouts no banco de dados. Exigir `requireAuth` e filtrar os loadouts pelo `accountId`.

- [ ] **Step 4: Rodar testes**
Run: `pnpm --filter api test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/loadouts apps/api/tests/loadouts.test.ts apps/api/src/server.ts
git commit -m "feat(api): backend persistence for ship loadouts"
```

---

### Task 7.4: Migrar o Cliente para consumir Loadouts da API

**Files:**
- Modify: `apps/client/src/persistence/loadoutRepo.ts`

- [ ] **Step 1: Atualizar o `loadoutRepo.ts`**
Substituir a lógica baseada em IndexedDB para usar chamadas HTTP (`fetch`) apontando para `/loadouts`.
Exemplo:
```typescript
export async function saveLoadout(loadout: SavedLoadout, token: string): Promise<void> {
  const res = await fetch('/api/loadouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(loadout)
  });
  if (!res.ok) throw new Error('Failed to save loadout');
}
```

- [ ] **Step 2: Atualizar a UI do Ship Builder para passar o Token JWT**
Em `apps/client/src/ui/shipBuilder.ts`, obter o token JWT de onde estiver salvo (localStorage ou global context) ao chamar `saveLoadout`.

- [ ] **Step 3: Testar e Validar**
Rodar `pnpm --filter client build` e validar que não há erros de compilação.
Testar manualmente a interface para garantir que salva na API em vez do IndexedDB.

- [ ] **Step 4: Commit**
```bash
git add apps/client/src/persistence apps/client/src/ui
git commit -m "feat(client): migrate loadout persistence from indexeddb to backend api"
```

---

## 2. Execução

Plano concluído e salvo em `docs/plans/2026-08-31-phase-7-liveops-metagame.md`.
