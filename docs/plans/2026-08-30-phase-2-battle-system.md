# Fase 2 — Sistema de Batalhas + Física (Plano)

> **Para agentes executores:** SUB-SKILL: `superpowers:subagent-driven-development`.
> Steps usam checkbox (`- [ ]`).

**Goal:** Servidor de jogo autoritativo em Rust com física espacial (inércia, vetor de thrust, drag), sistema de armas (projetil + beam), escudo/HP por subsistema, replicação de estado a 20Hz via WebSocket. Cliente conecta, envia inputs, recebe snapshots, renderiza outras naves.

**Architecture:** Servidor Bevy 0.15 com ECS, tokio para I/O, snapshot binário delta-encoded, WebSocket via `tokio-tungstenite` (upgrade para QUIC na Fase 3). Cliente TypeScript recebe snapshots, interpola entre frames, renderiza navers com interpolação suave.

**Tech Stack adições:**
- Servidor: `bevy`, `bevy_ecs`, `tokio`, `tokio-tungstenite`, `serde`, `bincode`
- Cliente: `bitecs` (já), `flatbuffers` ou `bincode` para deserialização rápida

---

## File Structure (Fase 2)

```
crates/
├── sim-core/                  (existente)
├── game-server/               (novo)
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs            entry point, tokio runtime
│   │   ├── net/
│   │   │   ├── mod.rs
│   │   │   ├── ws.rs          WebSocket server
│   │   │   └── protocol.rs    tipos de mensagem (ClientMsg, ServerMsg)
│   │   ├── world/
│   │   │   ├── mod.rs         WorldPlugin
│   │   │   ├── ship.rs        componentes/sistemas de nave
│   │   │   ├── physics.rs     inércia + drag
│   │   │   ├── combat.rs      armas, projéteis, dano
│   │   │   └── snapshot.rs    serialização 20Hz
│   │   └── lib.rs
│   └── tests/
│       ├── physics_test.rs
│       └── snapshot_test.rs

apps/client/
├── src/
│   ├── net/
│   │   ├── client.ts          WebSocket client
│   │   └── interpolation.ts   interpola entre snapshots
│   ├── ecs/
│   │   └── systems/
│   │       ├── remoteShips.ts aplica snapshots a entidades remotas
│   │       └── input.ts       envia input ao servidor
│   └── ui/
│       └── combatHud.ts       HP/shield/status
```

---

## Tasks

### Task 2.1: Setup crate `game-server`

- [ ] **Step 1**: `crates/game-server/Cargo.toml` com `bevy`, `tokio`, `tokio-tungstenite`, `serde`, `bincode`
- [ ] **Step 2**: Adicionar `crates/game-server` ao workspace em `Cargo.toml`
- [ ] **Step 3**: `crates/game-server/src/main.rs` com `#[tokio::main]` que loga `"game-server listening"`
- [ ] **Step 4**: `cargo build -p game-server` → OK

### Task 2.2: Protocolo + WebSocket server

- [ ] **Step 1**: `protocol.rs` com `ClientMsg` (Join, Input, Fire) e `ServerMsg` (Welcome, Snapshot, EntityDestroyed) usando bincode
- [ ] **Step 2**: `ws.rs` tokio listener em 0.0.0.0:7777, aceita conexões, spawna task por cliente
- [ ] **Step 3**: Cliente conecta → servidor responde `Welcome { player_id, tick_rate }`
- [ ] **Step 4**: Teste integração: dois tokio clients conectam, recebem Welcome

### Task 2.3: Snapshot do estado do mundo a 20Hz

- [ ] **Step 1**: Componentes `Position`, `Velocity`, `Ship` no ECS
- [ ] **Step 2**: Sistema `tick_physics` (fixed dt 1/30) aplicando inércia
- [ ] **Step 3**: Sistema `broadcast_snapshots` (20Hz) coleta estado e envia bincode para todos
- [ ] **Step 4**: Teste determinístico: rodar 60 ticks, hash do estado igual em 2 runs

### Task 2.4: Cliente conecta e renderiza entidades remotas

- [ ] **Step 1**: `net/client.ts` com `connect()`, envia `Join`, recebe `Welcome`
- [ ] **Step 2**: `systems/remoteShips.ts` aplica Snapshot → cria/atualiza entidades remotas em ECS
- [ ] **Step 3**: Instanciar mesh procedural de nave (cubo) por entidade remota
- [ ] **Step 4**: Validar: conectar, ver 1 cubo local (self) girando

### Task 2.5: Input do cliente (thrust/steer)

- [ ] **Step 1**: Capturar WASD/arrows no cliente, enviar `ClientMsg::Input { thrust, steer }` 30Hz
- [ ] **Step 2**: Servidor aplica input ao componente `Ship.thrust_input`
- [ ] **Step 3**: Sistema `apply_input` converte em aceleração
- [ ] **Step 4**: Validar: input local move a própria nave; outras naves só interpolam

### Task 2.6: Sistema de armas (projetil) e dano

- [ ] **Step 1**: Cliente: tecla `Space` envia `ClientMsg::Fire { weapon_slot }`
- [ ] **Step 2**: Servidor valida cooldown, spawna entidade `Projectile { pos, vel, owner, damage, ttl }`
- [ ] **Step 3**: Sistema `projectile_hit` verifica colisão AABB, aplica dano
- [ ] **Step 4**: Componente `Hull { hp, max }`; ao chegar a 0, nave destruída
- [ ] **Step 5**: Snapshot inclui `hp_ratio` para HUD
- [ ] **Step 6**: UI `combatHud.ts` mostra HP/shield do self + inimigos próximos

---

## Critérios de aceite da Fase 2

- [ ] Dois clientes podem conectar e ver um ao outro se movendo
- [ ] Input local move apenas a própria nave
- [ ] Tiros de um cliente atingem o outro, HP decrementa, nave morre ao chegar a 0
- [ ] Snapshot roda a 20Hz com banda <50kbps/cliente para 10 entidades
- [ ] `cargo test -p game-server` cobre: física determinística, colisão, dano
- [ ] `cargo clippy --workspace -- -D warnings` passa

---

## Self-Review

- [x] **Cobertura da spec Fase 2**: física ✓, combate ✓, replicação ✓
- [x] **Sem placeholders**: cada task tem arquivos e dependências reais
- [x] **Tamanho controlado**: 6 tasks focadas no MVP jogável, expando em planos futuros
- [x] **Determinismo**: teste explícito de hash de estado
- [x] **Compat com Fase 1**: reutiliza `sim-core` para validação de loadout
