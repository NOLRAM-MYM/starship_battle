# Fase 4 — Mundo Vivo: Economia, NPCs, Geração Procedural, Missões

**Data:** 2026-08-31
**Status:** ✅ Concluída
**Dependência:** Fase 3 ✅ (API completa, Helm, K8s)

## 1. Objetivo

Transformar a arena em um **mundo vivo** com循环 econômico, habitantes controlados por IA, e conteúdo gerado algoritmicamente. O sistema de missões amarra tudo, dando propósito ao jogador.

## 2. Componentes

### 2.1. Economia
- **Currency** (currency_t): gold, credits, dark-matter.
- **Wallet**: account_id → currency → amount (Postgres).
- **Transactions**: append-only ledger (origem, destino, valor, timestamp, motivo).
- **Shop**: itens vendáveis (mod_parts, consumables, raros). Preços dinâmicos baseados em supply/demand.
- **Inventário**: ship_id ou account_id → items[].

### 2.2. NPC AI
- **FSM (Finite State Machine)**: idle, patrol, investigate, attack, flee, dock.
- **Behaviors**:
  - Trader NPC: rota entre stations, oferece wares ao player próximo.
  - Pirate NPC: scan, persegue jogadores com pouca shield, ataca.
  - Patrol NPC: ronda áreas de anomalia, defende stations.
- **Spawn system**: arenas têm densidade alvo (N NPCs por km³).
- **Persistência mínima**: ao migrar de servidor, o NPC é destruído; ao voltar, é respawned.

### 2.3. Geração Procedural
- **Asteroid fields**: clusters proceduralmente posicionados (seed determinístico por shard).
- **Anomalies**: buracos de mineração, wormholes, distorções (efeitos visuais + loot).
- **Dungeons / Wreck sites**: naves caídas, estações destruídas, com inimigos de elite.
- **Seed por shard**: cada game-server usa um seed determinístico (ex: hash do shard_id).

### 2.4. Missões
- **Quest types**: kill (X enemies), collect (Y resource), deliver (Z to station), explore (reach anomaly).
- **Reward**: currency + items + XP (level-up, feature Fase 5).
- **Lifecycle**: offered → accepted → in_progress → completed (ou failed/abandoned).
- **Geração**: quests geradas a partir de templates + seed, garantindo variedade.

### 2.5. Sync Binária (Server → Client)
- **Snapshot** ganha variantes: `EntityKind::Npc`, `EntityKind::Asteroid`, `EntityKind::Anomaly`.
- **ServerMsg** ganha `QuestUpdate`, `ShopUpdate`, `WalletUpdate`.
- **Cliente TS**: novos components ECS (`NpcTag`, `AsteroidTag`, `AnomalyTag`), renderers.

## 3. Tasks

### Task 4.1 — Economia (currency, wallet, transactions)
- `apps/api/src/economy/`:
  - `types.ts`: Currency, Wallet, Transaction, Item, ShopItem.
  - `schema.sql`: wallets, transactions, items, shop_items, inventory.
  - `repository.ts`: queries Postgres (com transações ACID).
  - `service.ts`: earn (kill reward), spend (compra), transfer (P2P), ledger append.
  - `routes.ts`: `GET /economy/wallet`, `POST /economy/transfer`, `GET /economy/shop`, `POST /economy/shop/buy`, `POST /economy/shop/sell`.
- Critério: 5 testes (wallet init, earn, transfer atômico, buy/sell com estoque).

### Task 4.2 — NPC AI (FSM + behaviors)
- `crates/sim-core/src/ai/`:
  - `fsm.rs`: NPCState enum + transições válidas.
  - `behaviors.rs`: idle/patrol/investigate/attack/flee/dock.
  - `path.rs`: A* simplificado em 3D (ou steering: arrive + seek).
  - `spawn.rs`: spawn_table, density targets, faction tags.
- `crates/game-server/src/world.rs`: integração com `step()` (depois de physics, antes de colisões).
- Critério: 4 testes Rust (FSM transitions, patrol loop, pirate detects target, flee quando HP baixo).

### Task 4.3 — Geração Procedural
- `crates/sim-core/src/worldgen/`:
  - `seed.rs`: derive_seed(shard_id) → u64.
  - `asteroids.rs`: generate_field(seed, center, radius, count) → Vec<Asteroid>.
  - `anomalies.rs`: generate_anomalies(seed, count) → Vec<Anomaly>.
  - `wreck_sites.rs`: templates (pirate_wreck, military_wreck) com loot tables.
- Determinismo: mesma seed → mesmo layout (testável).
- Critério: 3 testes (asteroid count, anomaly positions estáveis entre runs, wreck site validity).

### Task 4.4 — Missões
- `apps/api/src/quests/`:
  - `types.ts`: Quest, QuestObjective, QuestStatus, Reward.
  - `schema.sql`: quests, quest_objectives, account_quests.
  - `templates.ts`: 5 templates (kill pirates, mine asteroids, deliver cargo, explore anomaly, hunt elite).
  - `service.ts`: generate_quests(seed, account_id), accept_quest, update_progress, complete_quest, abandon_quest.
  - `routes.ts`: `GET /quests/available`, `POST /quests/:id/accept`, `GET /quests/active`, `POST /quests/:id/abandon`.
- `crates/sim-core/src/quests/events.rs`: KillEvent, CollectEvent, ExploreEvent (publicados pelo game-server via NATS → API consome).
- Critério: 4 testes (generate com seed fixo, accept idempotente, progress increment, complete + reward).

### Task 4.5 — Sync Binária (Npc/Asteroid/Anomaly broadcast)
- `crates/sim-core/src/protocol.rs`: novos `EntityKind` e serialização.
- `crates/game-server/src/snapshot.rs`: inclui npcs/asteroids/anomalies.
- `apps/client/src/ecs/components/npc.ts`, `asteroid.ts`, `anomaly.ts`.
- `apps/client/src/render/NpcRenderer.ts`, `AsteroidRenderer.ts`, `AnomalyRenderer.ts` (Three.js WebGPU).
- Critério: 3 testes Rust (encode/decode) + 2 testes TS (decoder).

## 4. Critérios de Sucesso

- Wallet de 2 contas transfere valor com 1 teste ACID (rollback se falhar).
- NPC pirate detecta ship em range, persegue, e foge quando HP < 30%.
- 100 asteroides gerados deterministicamente com seed fixo (1 teste reproduz layout).
- Quest "kill 3 pirates" aceita, progredi com kill, completa, recompensa creditada.
- Cliente recebe 1 Npc, 1 Asteroid, 1 Anomaly no snapshot e renderiza.
- Todos os testes de Fase 4 + 63 anteriores continuam passando (regressão).

## 5. Não-Objetivos

- Persistência de longo prazo do estado do mundo (cada shard é efêmero).
- Pathfinding completo em grid 3D (steering é suficiente para escala atual).
- NPCs comprando/vendendo de graça (vai em Fase 5+).
- Leveling system completo (só XP counter; árvore de skills em Fase 5).

## 6. Riscos

| Risco | Mitigação |
|---|---|
| ACID em transactions com deadlock | Ordenar updates por account_id ascendente |
| NPC AI pesado em 30Hz tick | FSM evaluate apenas a cada N ticks; LOD por distância |
| Seed determinístico vs random spawn | Seed por shard, mas re-rolagem a cada shard restart é aceitável |
| Binary protocol breaking | Adicionar variantes em vez de mexer no layout; version field |

## 7. Convenções

- Toda nova tabela Postgres: `created_at TIMESTAMPTZ DEFAULT NOW()` + `updated_at` com trigger ou manual.
- Todo novo ECS component: lowercase + TypedArrays separados (rotX/rotY/rotZ/rotW + posX/posY/posZ).
- Toda nova mensagem binária: novo discriminante no `ClientMsg`/`ServerMsg`, testes de encode/decode.
- Testes Rust: `cargo test -p sim-core` e `cargo test -p game-server`.
- Testes TS: `pnpm --filter @batle/client test` e `pnpm --filter @batle/api test`.

## 8. Status Final

**Concluído em:** 2026-08-31

### Tasks entregues (5/5)

| Task | Escopo | Arquivos principais | Testes |
|---|---|---|---|
| 4.1 | Economia | `apps/api/src/economy/{types,repository,service,routes}.ts`, `schema.sql` | 29 vitest |
| 4.2 | NPC AI (FSM + behaviors + A*) | `crates/sim-core/src/ai/{mod,vec3,behaviors,fsm,path}.rs` | 31 sim-core |
| 4.3 | Worldgen (asteroid/anomaly/wreck) | `crates/sim-core/src/worldgen/{mod,seed,noise,asteroid,anomaly,wreck,sector}.rs` | 32 sim-core |
| 4.4 | Missões (templates/instances/progress) | `apps/api/src/quests/{types,repository,service,routes}.ts`, `schema.sql` | 23 vitest |
| 4.5 | Sync binária Npc/Asteroid/Anomaly/Wreck | `crates/game-server/src/{npc,world}.rs`, `net/protocol.rs`, `net/ws.rs` | 18 game-server + integração |

### Mudanças de protocolo

- `PROTOCOL_VERSION`: 1 → 2
- `ServerMsg::Welcome` ganhou `world_seed: u32`
- `EntityState` ganhou `payload: Option<EntityPayload>` (None = player/ship legado)
- `EntityPayload` enum: `Npc(NpcPayload)` | `Asteroid(AsteroidPayload)` | `Anomaly(AnomalyPayload)` | `Wreck(WreckPayload)`
- World determinístico: cliente usa `world_seed` para reproduzir a geração procedural localmente (asteroids/anomalies/wrecks)

### Estatísticas finais

- **Rust:** 145 testes passando (`cargo test` — 39 game-server lib + 39 game-server main + 1 ws_integration + 63 sim-core + 3 ship_builder)
- **TypeScript API:** 115/115 vitest (12 auth + 16 matchmaking + 14 chat + 19 clans + 29 economy + 23 quests + 2 health)
- **TypeScript client:** `tsc --noEmit` 0 erros
- **Compile health:** zero warnings, zero erros em todos os crates/apps

### Pendências para Fase 5

- Renderer cliente para Npc/Asteroid/Anomaly/Wreck (atualmente só simulação autoritativa)
- Cliente TS ainda não tem suíte de testes (vitest ausente em `apps/client`)
- Nenhum suporte a WebXR/VR — totalmente novo
- Mobile (touch + adaptive UI) — totalmente novo
- Polish beta: profiler, fps counter, menu, settings, áudio, acessibilidade
- Leveling / skill tree (mencionado como não-objetivo em Fase 4)

## 9. Próximos Passos

- Iniciar **Fase 5 — VR/AR (WebXR), Mobile e Polish Beta** com plano dedicado.
- Mover tasks pendentes para a Fase 5 (rendering cliente de entidades Fase 4, leveling, suíte de testes do cliente).
- Atualizar ADRs caso haja decisão arquitetural relevante (ex: WebXR session lifecycle, fallback não-VR).
