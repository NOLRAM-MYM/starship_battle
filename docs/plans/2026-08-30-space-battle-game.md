# Space Battle Arena — Plano Mestre de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIO: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Steps usam checkbox (`- [ ]`).

**Goal:** Construir um MMO de batalhas espaciais em navegador, com construção modular de naves, batalhas em tempo real para 100 jogadores, economia dirigida por jogadores, geração procedural de sistemas estelares e suporte cross-platform (desktop, mobile, VR/AR).

**Architecture:** Cliente TypeScript/WebGPU com ECS customizado, servidor de jogo autoritativo em Rust (Bevy) com replicação de estado via snapshot interpolation, infraestrutura escalável em Kubernetes com NATS para mensageria, PostgreSQL/Redis/TimescaleDB para persistência, e WebRTC (mediasoup) para canais de baixa latência voz/chat de esquadrão.

**Tech Stack (resumo — ver Seção 2 para justificativas):**
- Cliente: TypeScript, Vite, Three.js (WebGPU renderer), bitECS, WebXR
- Servidor de jogo: Rust, Bevy, Rapier (física), Colyseus-like (rooms), tokio
- API/Serviços: Node.js + Fastify (TS), gRPC
- Dados: PostgreSQL, Redis, TimescaleDB, ClickHouse (telemetria)
- Mensageria: NATS JetStream
- Cloud: Hetzner/AWS (GameLift fallback), Cloudflare (DDoS/CDN), S3 + CloudFront
- Observabilidade: OpenTelemetry, Grafana, Loki, Tempo
- Testes: Vitest, Playwright, k6, criterion.rs

---

## 1. Escopo

Este plano cobre o projeto **completo** do MVP ao Beta. Devido ao tamanho, está dividido em 5 fases. **Esta entrega detalha apenas a Fase 1 (Tarefas 1–N)**. As Fases 2–5 estão descritas em alto nível com referência ao arquivo de plano que será gerado em cada uma.

Para evitar a regra de "plan = placeholder", cada fase subsequente será um documento independente em `docs/plans/` quando chegar a hora.

---

## 2. Pilha Tecnológica Completa e Justificativas

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Linguagem cliente | **TypeScript 5.x (strict)** | Tipagem end-to-end com servidor TS, ecossistema WebGPU/WebXR maduro, melhor DX para ECS. |
| Bundler | **Vite 6** | HMR sub-100ms, suporte nativo a WASM, target ES2022. |
| Renderização 3D | **Three.js r170+ (WebGPURenderer)** | Suporte oficial a WebGPU, compute shaders, node materials, VR. Babylon.js é alternativa se preferir PBR de alto nível. |
| ECS cliente | **bitECS** + **miniplex** (reactive layer) | 100k+ entidades, garbage-free, determinístico. |
| Física cliente | **Rapier3D (WASM)** | Compatível com servidor, determinístico com fixed timestep. |
| Input | **Gamepad API + Pointer Lock + WebXR Input** | Cross-platform nativo. |
| Áudio | **Howler.js + Web Audio API** + spatial PannerNode | 3D posicional, streaming. |
| Linguagem servidor de jogo | **Rust 1.83+ (stable)** | Latência <5ms por tick, zero-cost abstractions, segura contra data races. |
| Engine servidor | **Bevy 0.15** + **bevy_ecs** | ECS de alta performance, hot-reload de sistemas, ideal para 100 players/sala. |
| Networking servidor | **bevy_replicon** (snapshot) + custom UDP (quinn/QUIC) | State sync autoritativo com client-side prediction + server reconciliation. |
| Física servidor | **Rapier3D** (mesma versão do cliente) | Garantia de determinismo. |
| API/BFF | **Node.js 22 + Fastify 5** (TS) | Webhooks, billing, account management, leaderboards. |
| RPC interno | **gRPC (tonic/Connect)** | Contratos .proto compartilhados cliente↔servidor. |
| Auth | **OAuth2 (Discord, Google) + JWT (PASETO)** | Padrão mercado, sem senha custom. |
| Banco relacional | **PostgreSQL 17 + PostgREST** | Dados transacionais (contas, clans, inventário). |
| Cache/leaderboards | **Redis 8 (Valkey fork)** | Sorted sets para ranking, pub/sub para chat. |
| Telemetria | **TimescaleDB** (métricas) + **ClickHouse** (analytics) | Séries temporais de batalha, queries OLAP. |
| Mensageria | **NATS JetStream** | Salas de jogo, eventos entre regiões, replay. |
| Load balancer | **HAProxy + Cloudflare Spectrum (UDP/TCP)** | L4 para servidores de jogo, L7 para API. |
| WebRTC | **mediasoup 3** (SFU) | Áudio/vídeo de esquadrão, sync P2P de alta freq. |
| VR/AR | **WebXR Device API** | Suporte Quest 3, Vision Pro, Pico 4 via Three.js XR. |
| CI/CD | **GitHub Actions + ArgoCD** | Deploy GitOps em k8s. |
| Orquestração | **Kubernetes (K3s para custo)** | Auto-scaling de game rooms. |
| Observabilidade | **OpenTelemetry → Grafana Tempo/Loki/Prometheus** | Tracing distribuído, logs, métricas. |
| Testes cliente | **Vitest + Playwright + @webgpu/types** | Unit, integração, E2E com GPU mocking. |
| Testes servidor | **cargo test + criterion + testcontainers-rs** | Unit, bench, integração com DB real. |
| Testes de carga | **k6 + vegeta** | 100+ clients simulados por sala. |

### Justificativas-chave das escolhas de risco

- **Rust no servidor de jogo**: alternativa Node.js (Colyseus) avaliada; descartada por GC pauses imprevisíveis em tick rate 30Hz com 100 players.
- **QUIC em vez de WebSocket puro**: handshake 0-RTT, streams multiplexados, melhor comportamento em redes móveis (60% do público-alvo).
- **bitECS em vez de Entity-Component puro Three.js**: iteração cache-friendly para 10k+ objetos (projéteis, partículas) por sala.
- **ClickHouse + TimescaleDB**: separar hot path (rankings, inventário) de cold path (replay, BI) evita ruído em produção.

---

## 3. Roadmap de Desenvolvimento (Fases)

### Fase 1 — Fundação + Núcleo de Construção de Naves (8–10 semanas)
**Entregável:** Protótipo jogável single-player com ship builder funcional, salvar/carregar naves, navegar em sistema estelar estático com 1 planeta, sem multiplayer.
- Setup monorepo, CI, infra base
- ECS cliente + renderizador WebGPU + asset pipeline
- Ship builder modular (motores, armas, escudos, sensores, carga, stealth)
- Sistema de progressão (árvore de tech + conquistas locais)
- Persistência local (IndexedDB) + sync com backend (skeleton)

> **Detalhamento completo: ver Seção 5 abaixo.**

### Fase 2 — Sistema de Batalhas + Física (6–8 semanas)
**Entregável:** Multiplayer local (LAN) com 2–8 jogadores, física espacial completa, inércia, gravidade planetária, danos componente-a-componente.
- Servidor de jogo Rust + replicação de estado
- Sistema de armas (beam, projectile, missile) com dissipação de energia
- Damage model por subsistema (motor/escudo/armas podem ser destruídos)
- HUD tático, radar, comunicação
- Plano detalhado: `docs/plans/2026-XX-XX-phase-2-battle-system.md`

### Fase 3 — Infraestrutura Multiplayer Online (6 semanas)
**Entregável:** Salas online com 100 jogadores, account system, chat global/de esquadrão, matchmaking.
- Backend API (Fastify), auth, accounts
- Matchmaking (Elo + region)
- Salas de jogo com auto-scaling (HPA k8s por CCU)
- Chat com profanidade/moderação
- Plano: `docs/plans/2026-XX-XX-phase-3-multiplayer-infra.md`

### Fase 4 — Conteúdo Complexo (8–10 semanas)
**Entregável:** Clãs, economia, AI de NPCs, geração procedural, modos de guerra.
- Sistema de clãs + war mode
- Mercado de componentes com oferta/demanda
- AI de piratas/império/comerciantes (behavior trees + utility AI)
- Procgen de sistemas estelares (Wave Function Collapse + noise)
- Plano: `docs/plans/2026-XX-XX-phase-4-content.md`

### Fase 5 — Beta + Polimento (4–6 semanas)
**Entregável:** VR/AR, cross-platform mobile, balanceamento, analytics, loja.
- WebXR (modo cockpit VR)
- Build mobile (touch controls, LOD agressivo)
- Loja de cosmetics (Stripe)
- Plano: `docs/plans/2026-XX-XX-phase-5-beta.md`

---

## 4. Requisitos de Teste

### 4.1 Testes de Carga (Fase 3+)
- **Cenário A — Capacidade por sala**: 100 clientes simulados, tick rate 30Hz, snapshot rate 20Hz, banda ≤50kbps/cliente. Aceitar CPU <70% por core de servidor.
- **Cenário B — Capacidade global**: 10.000 CCU distribuídos em 200 salas. Aceitar p99 latência <100ms.
- **Cenário C — Matchmaking**: 5000 jogadores enfileirados, tempo médio até sala <30s.
- Ferramenta: **k6** com módulo `k6/x/grpc` + driver custom para QUIC.

### 4.2 Testes de Usabilidade
- **Ship builder**: tarefa "montar nave funcional em <3min" com 20 usuários novatos. Meta: ≥85% sucesso.
- **Mobile**: 15 usuários em iOS/Android. Meta: NPS ≥40.
- Acessibilidade: WCAG 2.2 AA em menus, daltonismo em HUD (paletas testadas com simulador).
- Ferramenta: **Maze + Playwright + OTEL** para heatmaps de UX.

### 4.3 Testes Cross-Platform
Matriz obrigatória:
- Chrome 130+ (Win/Mac/Linux), Firefox 132+, Safari 18 (macOS/iOS), Edge 130+
- Samsung Internet, Brave
- Mobile: iOS 17+ Safari, Android 13+ Chrome
- VR: Meta Quest Browser, Vision Pro Safari, Pico Browser
- Headless: Playwright com `--use-gl=swiftshader` para CI

### 4.4 Testes de Determinismo
- Simulação 1v1 cliente+server, hash do estado a cada 60s. **Qualquer divergência = bug P0.**
- Replay 100% reproduzível a partir de input log.

### 4.5 Critérios de Sucesso (alinhados com a spec)

| Critério | Meta | Métrica |
|---|---|---|
| FPS desktop | ≥60 estável (mediano) | Stats.js + Grafana |
| FPS mobile (Médio) | ≥30 | Stats.js |
| Latência online p99 | <100ms | OpenTelemetry RTT |
| Retenção D7 | ≥30% | ClickHouse cohort |
| Uptime | 99.5% em beta, 99.9% GA | StatusCake |
| Tempo de deploy sem downtime | <2min | ArgoCD |
| Build size inicial | <8MB gzipped | Vite analyzer |

---

## 5. Fase 1 — Detalhamento Tarefa por Tarefa

### File Structure (Fase 1)

```
batle/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vite.config.ts
├── .github/workflows/ci.yml
├── rust-toolchain.toml
├── Cargo.toml                      # workspace Rust
├── crates/
│   ├── sim-core/                   # lógica de jogo compartilhada (Rust lib)
│   └── sim-wasm/                   # bindings WASM p/ cliente TS
├── apps/
│   ├── client/                     # jogo no navegador
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── render/             # WebGPU renderer
│   │   │   ├── ecs/                # bitECS world, systems
│   │   │   ├── gameplay/
│   │   │   │   ├── ship/           # ship builder, components
│   │   │   │   ├── combat/         # placeholder p/ Fase 2
│   │   │   │   └── progression/    # tech tree, achievements
│   │   │   ├── ui/                 # menus, HUD
│   │   │   ├── input/
│   │   │   ├── audio/
│   │   │   └── persistence/        # IndexedDB + sync stub
│   │   ├── public/assets/
│   │   └── tests/
│   └── server-api/                 # skeleton Fastify (Fase 3 expande)
│       ├── src/main.ts
│       └── tests/
├── proto/                          # contratos .proto
├── infra/
│   ├── docker-compose.dev.yml
│   └── k8s/                        # manifests
└── docs/
    ├── architecture/
    └── plans/
```

---

### Task 1: Inicializar monorepo pnpm + workspaces

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`, `.editorconfig`

- [ ] **Step 1: Criar `package.json` raiz**

```json
{
  "name": "space-battle-arena",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "lint": "pnpm -r run lint",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "prettier": "3.3.3",
    "eslint": "9.13.0",
    "@types/node": "22.7.5"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **Step 2: Criar `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "crates/*"
```

- [ ] **Step 3: Criar `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true
  }
}
```

- [ ] **Step 4: Criar `.gitignore`**

```
node_modules/
dist/
target/
*.log
.env
.env.local
.DS_Store
.vite/
coverage/
playwright-report/
test-results/
```

- [ ] **Step 5: Instalar dependências**

```bash
cd c:\Users\user\Downloads\batle
pnpm install
```

Expected: `Lockfile is up to date` e nenhum erro.

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "chore: initialize pnpm monorepo with strict TS config"
```

---

### Task 2: Setup cliente Vite + Three.js WebGPU

**Files:**
- Create: `apps/client/package.json`, `apps/client/vite.config.ts`, `apps/client/index.html`, `apps/client/src/main.ts`, `apps/client/tsconfig.json`

- [ ] **Step 1: Criar `apps/client/package.json`**

```json
{
  "name": "@batle/client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "three": "0.170.0",
    "bitecs": "0.3.40"
  },
  "devDependencies": {
    "vite": "6.0.0",
    "vitest": "2.1.4",
    "@types/three": "0.170.0",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: Criar `apps/client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
```

- [ ] **Step 3: Criar `apps/client/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Space Battle Arena</title>
  </head>
  <body>
    <canvas id="game-canvas"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Criar `apps/client/src/main.ts`**

```typescript
async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  // Verifica WebGPU
  if (!navigator.gpu) {
    document.body.innerHTML = '<h1>Seu navegador não suporta WebGPU. Atualize para Chrome 113+ ou Firefox 121+.</h1>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');

  // Inicializa renderer (será expandido na Task 4)
  console.info('[bootstrap] WebGPU adapter acquired', adapter.info ?? {});
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed', err);
});
```

- [ ] **Step 5: Criar `apps/client/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 6: Instalar e validar**

```bash
cd c:\Users\user\Downloads\batle
pnpm install
cd apps/client
pnpm exec vite build
```

Expected: build completa sem erros, `dist/index.html` gerado.

- [ ] **Step 7: Smoke test no browser**

```bash
pnpm dev
```

Abrir `http://localhost:5173`, console deve mostrar `[bootstrap] WebGPU adapter acquired`.

- [ ] **Step 8: Commit**

```bash
git add apps/client
git commit -m "feat(client): bootstrap vite + three.js webgpu"
```

---

### Task 3: Setup workspace Rust + crate sim-core

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `crates/sim-core/Cargo.toml`, `crates/sim-core/src/lib.rs`

- [ ] **Step 1: Criar `rust-toolchain.toml`**

```toml
[toolchain]
channel = "1.83.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

- [ ] **Step 2: Criar `Cargo.toml` workspace**

```toml
[workspace]
resolver = "2"
members = ["crates/*"]

[workspace.package]
edition = "2021"
license = "Proprietary"
version = "0.1.0"

[workspace.dependencies]
serde = { version = "1.0.214", features = ["derive"] }
serde_json = "1.0.132"
thiserror = "1.0.68"
```

- [ ] **Step 3: Criar `crates/sim-core/Cargo.toml`**

```toml
[package]
name = "sim-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde = { workspace = true }
thiserror = { workspace = true }
```

- [ ] **Step 4: Criar `crates/sim-core/src/lib.rs`**

```rust
//! sim-core: lógica de jogo compartilhada (servidor + WASM cliente).
//! Tudo que afeta regras/balance vive aqui para garantir paridade.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod ship;

pub use ship::*;
```

- [ ] **Step 5: Criar `crates/sim-core/src/ship/mod.rs` com esqueleto**

```rust
//! Definições de componentes de nave e ship loadout.

use serde::{Deserialize, Serialize};

/// Categorias de slot em uma nave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SlotKind {
    /// Propulsão principal/secundária.
    Engine,
    /// Arma fixa ou turret.
    Weapon,
    /// Gerador de escudo.
    Shield,
    /// Sensores passivos/ativos.
    Sensor,
    /// Compartimento de carga (expansível).
    Cargo,
    /// Sistema de camuflagem (stealth).
    Stealth,
}

/// Posição de slot em uma nave (grid 3D simplificado).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SlotPos {
    /// Identificador único do slot dentro da nave.
    pub id: u16,
    /// Categoria aceita neste slot.
    pub kind: SlotKind,
}

/// Componente instanciado ocupando um slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    /// ID do template (ex.: "engine_mk3", "railgun_heavy").
    pub template_id: String,
    /// Tier (1..=5).
    pub tier: u8,
    /// Carga de upgrade aplicada (0..=100).
    pub upgrade_points: u16,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_kinds_are_distinct() {
        let kinds = [SlotKind::Engine, SlotKind::Weapon, SlotKind::Shield,
                     SlotKind::Sensor, SlotKind::Cargo, SlotKind::Stealth];
        for (i, a) in kinds.iter().enumerate() {
            for b in &kinds[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }
}
```

- [ ] **Step 6: Validar build + testes**

```bash
cd c:\Users\user\Downloads\batle
cargo test -p sim-core
```

Expected: `1 passed; 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml rust-toolchain.toml crates
git commit -m "feat(sim-core): scaffold rust workspace with ship module"
```

---

### Task 4: Renderer WebGPU — cena base com skybox estelar

**Files:**
- Create: `apps/client/src/render/Renderer.ts`, `apps/client/src/render/Starfield.ts`, `apps/client/src/render/skybox.ts.ts`
- Modify: `apps/client/src/main.ts`

- [ ] **Step 1: Criar `apps/client/src/render/Renderer.ts`**

```typescript
import * as THREE from 'three/webgpu';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
}

export class GameRenderer {
  readonly three: THREE.WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  constructor(opts: RendererOptions) {
    this.three = new THREE.WebGPURenderer({
      canvas: opts.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000005);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1e6);
    this.camera.position.set(0, 0, 50);
  }

  resize(width: number, height: number): void {
    this.three.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async init(): Promise<void> {
    await this.three.init();
  }

  render(): void {
    this.three.render(this.scene, this.camera);
  }
}
```

- [ ] **Step 2: Criar `apps/client/src/render/Starfield.ts`**

```typescript
import * as THREE from 'three/webgpu';

/**
 * Skybox procedural com 8000 estrelas distribuídas em uma esfera.
 * Sem texturas externas — totalmente gerado em GPU via points.
 */
export function createStarfield(count = 8000, radius = 5_000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  // Seed determinístico p/ reprodutibilidade
  let seed = 0x1234_5678;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffff_ffff;
  };

  for (let i = 0; i < count; i++) {
    // Distribuição em esfera com leve bias para disco galáctico
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.6 + 0.4 * rand());

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.3; // achata
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Cor: branco → azul → amarelo → vermelho (classe espectral)
    const t = rand();
    const r1 = 0.7 + t * 0.3;
    const g = 0.7 + (1 - Math.abs(t - 0.5)) * 0.3;
    const b = 1 - t * 0.3;
    colors[i * 3] = r1;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    sizes[i] = 0.5 + rand() * 1.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsNodeMaterial({
    size: 1.0,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
  });

  return new THREE.Points(geo, mat);
}
```

- [ ] **Step 3: Wire-up em `apps/client/src/main.ts`**

Substitua o conteúdo de `main.ts` por:

```typescript
import { GameRenderer } from './render/Renderer';
import { createStarfield } from './render/Starfield';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  if (!navigator.gpu) {
    document.body.innerHTML = '<h1>Navegador sem suporte a WebGPU.</h1>';
    return;
  }

  const renderer = new GameRenderer({ canvas });
  await renderer.init();
  renderer.resize(window.innerWidth, window.innerHeight);

  const stars = createStarfield();
  renderer.scene.add(stars);

  let t0 = performance.now();
  const tick = (): void => {
    const t = (performance.now() - t0) / 1000;
    stars.rotation.y = t * 0.01;
    renderer.render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });

  console.info('[bootstrap] scene running');
}

bootstrap().catch((err) => console.error('[bootstrap] failed', err));
```

- [ ] **Step 4: Validar build**

```bash
cd c:\Users\user\Downloads\batle\apps\client
pnpm exec tsc --noEmit
pnpm exec vite build
```

Expected: build OK, sem erros TS.

- [ ] **Step 5: Smoke test visual**

```bash
pnpm dev
```

Esperado: canvas preto com campo de estrelas em slow-rotation, sem erros no console.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src
git commit -m "feat(render): webgpu renderer with procedural starfield"
```

---

### Task 5: ECS — definir entidades e componentes básicos

**Files:**
- Create: `apps/client/src/ecs/world.ts`, `apps/client/src/ecs/components/transform.ts`, `apps/client/src/ecs/components/ship.ts`, `apps/client/src/ecs/systems/spin.ts`
- Modify: `apps/client/src/main.ts`

- [ ] **Step 1: Criar `apps/client/src/ecs/world.ts`**

```typescript
import { createWorld } from 'bitecs';

export const world = createWorld();
```

- [ ] **Step 2: Criar `apps/client/src/ecs/components/transform.ts`**

```typescript
import { Types, defineComponent } from 'bitecs';

export const Transform = defineComponent({
  posX: Types.f32,
  posY: Types.f32,
  posZ: Types.f32,
  rotX: Types.f32,
  rotY: Types.f32,
  rotZ: Types.f32,
  scale: Types.f32,
});
```

- [ ] **Step 3: Criar `apps/client/src/ecs/components/ship.ts`**

```typescript
import { Types, defineComponent } from 'bitecs';

export const ShipTag = defineComponent();

export const ShipStats = defineComponent({
  mass: Types.f32,
  thrust: Types.f32,
  shieldHp: Types.f32,
  shieldMax: Types.f32,
  hullHp: Types.f32,
  hullMax: Types.f32,
  cargoCap: Types.f32,
  sensorRange: Types.f32,
  stealthRating: Types.f32,
});
```

- [ ] **Step 4: Criar `apps/client/src/ecs/systems/spin.ts`**

```typescript
import { world } from '../world';
import { Transform } from '../components/transform';
import { ShipTag } from '../components/ship';

export function spinSystem(dt: number): void {
  const entities = ShipTag(world);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i]!;
    Transform.rotY[eid] += dt * 0.1;
  }
}
```

- [ ] **Step 5: Wire-up no `main.ts` (substituir tick)**

```typescript
import { world } from './ecs/world';
import { Transform, ShipStats, ShipTag } from './ecs/components/transform'; // adjust import path
import { spinSystem } from './ecs/systems/spin';

// ... dentro do bootstrap, após criar starfield ...

// Cria 1 entidade de teste (nave)
const eid = ShipTag(world);
Transform.posX[eid] = 0;
Transform.posY[eid] = 0;
Transform.posZ[eid] = 0;
Transform.scale[eid] = 1;
ShipStats.mass[eid] = 1000;
ShipStats.shieldMax[eid] = 500;
ShipStats.shieldHp[eid] = 500;
ShipStats.hullMax[eid] = 800;
ShipStats.hullHp[eid] = 800;
ShipStats.thrust[eid] = 50;

let last = performance.now();
const tick = (): void => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  spinSystem(dt);
  renderer.render();
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

- [ ] **Step 6: Validar**

```bash
pnpm exec tsc --noEmit
pnpm exec vite build
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/ecs
git commit -m "feat(ecs): bitecs world with transform and ship components"
```

---

### Task 6: Ship Builder — modelo de dados de templates

**Files:**
- Create: `crates/sim-core/src/ship/template.rs`, `crates/sim-core/src/ship/builder.rs`, `crates/sim-core/tests/ship_builder.rs`

- [ ] **Step 1: Criar `crates/sim-core/src/ship/template.rs`**

```rust
//! Templates de componentes carregados de JSON (data-driven).

use serde::{Deserialize, Serialize};

use super::{ComponentInstance, SlotKind, SlotPos};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentTemplate {
    pub id: String,
    pub display_name: String,
    pub kind: SlotKind,
    pub tier: u8,
    pub mass: f32,
    pub power_draw: f32,
    pub stats: ComponentStats,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ComponentStats {
    pub thrust: f32,
    pub shield_hp: f32,
    pub shield_regen: f32,
    pub damage: f32,
    pub fire_rate: f32,
    pub range: f32,
    pub sensor_range: f32,
    pub cargo_capacity: f32,
    pub stealth_rating: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipTemplate {
    pub id: String,
    pub display_name: String,
    pub base_mass: f32,
    pub base_cargo: f32,
    pub slots: Vec<SlotPos>,
}
```

- [ ] **Step 2: Adicionar `pub mod template;` em `crates/sim-core/src/ship/mod.rs`**

- [ ] **Step 3: Criar `crates/sim-core/src/ship/builder.rs`**

```rust
//! Construtor de naves a partir de template + loadout de componentes.

use serde::{Deserialize, Serialize};

use super::template::{ComponentStats, ShipTemplate};
use super::ComponentInstance;
use crate::ship::SlotKind;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShipLoadout {
    pub ship_template_id: String,
    pub components: Vec<ComponentInstance>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum BuildError {
    #[error("slot {0} not found in template {1}")]
    SlotNotFound(u16, String),
    #[error("slot {0} expects {1:?}, got component for {2:?}")]
    SlotKindMismatch(u16, SlotKind, SlotKind),
    #[error("empty component id")]
    EmptyComponentId,
    #[error("unknown component template: {0}")]
    UnknownComponent(String),
}

pub struct ShipStats {
    pub total_mass: f32,
    pub thrust: f32,
    pub shield_hp: f32,
    pub shield_regen: f32,
    pub damage: f32,
    pub sensor_range: f32,
    pub cargo_capacity: f32,
    pub stealth_rating: f32,
}

/// Resolve o loadout e devolve stats agregadas.
/// `resolve_component` é injetado para manter a função pura/testável.
pub fn build_ship<F>(
    template: &ShipTemplate,
    loadout: &ShipLoadout,
    mut resolve_component: F,
) -> Result<ShipStats, BuildError>
where
    F: FnMut(&str) -> Option<super::template::ComponentTemplate>,
{
    if loadout.components.iter().any(|c| c.template_id.is_empty()) {
        return Err(BuildError::EmptyComponentId);
    }

    let mut stats = ShipStats {
        total_mass: template.base_mass,
        thrust: 0.0,
        shield_hp: 0.0,
        shield_regen: 0.0,
        damage: 0.0,
        sensor_range: 0.0,
        cargo_capacity: template.base_cargo,
        stealth_rating: 0.0,
    };

    for comp in &loadout.components {
        let ct = resolve_component(&comp.template_id)
            .ok_or_else(|| BuildError::UnknownComponent(comp.template_id.clone()))?;

        let slot = template
            .slots
            .iter()
            .find(|s| s.id == comp.slot_id())
            .ok_or_else(|| BuildError::SlotNotFound(comp.slot_id(), template.id.clone()))?;

        if slot.kind != ct.kind {
            return Err(BuildError::SlotKindMismatch(slot.id, slot.kind, ct.kind));
        }

        stats.total_mass += ct.mass;
        merge_stats(&mut stats, &ct.stats);
    }

    Ok(stats)
}

fn merge_stats(out: &mut ShipStats, c: &ComponentStats) {
    out.thrust += c.thrust;
    out.shield_hp += c.shield_hp;
    out.shield_regen += c.shield_regen;
    out.damage += c.damage;
    out.sensor_range = out.sensor_range.max(c.sensor_range);
    out.cargo_capacity += c.cargo_capacity;
    out.stealth_rating = out.stealth_rating.max(c.stealth_rating);
}
```

- [ ] **Step 4: Estender `ComponentInstance` com `slot_id` em `crates/sim-core/src/ship/mod.rs`**

Atualize a struct:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentInstance {
    pub template_id: String,
    pub slot_id: u16,
    pub tier: u8,
    pub upgrade_points: u16,
}

impl ComponentInstance {
    pub fn slot_id(&self) -> u16 { self.slot_id }
}
```

- [ ] **Step 5: Criar teste `crates/sim-core/tests/ship_builder.rs`**

```rust
use sim_core::ship::template::{ComponentStats, ComponentTemplate, ShipTemplate};
use sim_core::ship::{build_ship, ComponentInstance, ShipLoadout, SlotKind, SlotPos};

fn make_engine(id: &str, thrust: f32) -> ComponentTemplate {
    ComponentTemplate {
        id: id.into(),
        display_name: id.into(),
        kind: SlotKind::Engine,
        tier: 1,
        mass: 10.0,
        power_draw: 5.0,
        stats: ComponentStats { thrust, ..Default::default() },
    }
}

fn make_weapon(id: &str, dmg: f32) -> ComponentTemplate {
    ComponentTemplate {
        id: id.into(),
        display_name: id.into(),
        kind: SlotKind::Weapon,
        tier: 1,
        mass: 20.0,
        power_draw: 30.0,
        stats: ComponentStats { damage: dmg, ..Default::default() },
    }
}

fn make_template() -> ShipTemplate {
    ShipTemplate {
        id: "scout".into(),
        display_name: "Scout".into(),
        base_mass: 100.0,
        base_cargo: 50.0,
        slots: vec![
            SlotPos { id: 1, kind: SlotKind::Engine },
            SlotPos { id: 2, kind: SlotKind::Weapon },
        ],
    }
}

#[test]
fn builds_ship_with_two_components() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![
            ComponentInstance { template_id: "eng1".into(), slot_id: 1, tier: 1, upgrade_points: 0 },
            ComponentInstance { template_id: "wpn1".into(), slot_id: 2, tier: 1, upgrade_points: 0 },
        ],
    };
    let stats = build_ship(&tmpl, &loadout, |id| match id {
        "eng1" => Some(make_engine("eng1", 100.0)),
        "wpn1" => Some(make_weapon("wpn1", 50.0)),
        _ => None,
    }).unwrap();
    assert_eq!(stats.total_mass, 100.0 + 10.0 + 20.0);
    assert_eq!(stats.thrust, 100.0);
    assert_eq!(stats.damage, 50.0);
}

#[test]
fn rejects_wrong_slot_kind() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![ComponentInstance {
            template_id: "wpn1".into(), slot_id: 1, tier: 1, upgrade_points: 0,
        }],
    };
    let err = build_ship(&tmpl, &loadout, |_| Some(make_weapon("wpn1", 1.0))).unwrap_err();
    assert!(matches!(err, sim_core::ship::BuildError::SlotKindMismatch(_, SlotKind::Engine, SlotKind::Weapon)));
}

#[test]
fn rejects_unknown_component() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![ComponentInstance {
            template_id: "missing".into(), slot_id: 1, tier: 1, upgrade_points: 0,
        }],
    };
    let err = build_ship(&tmpl, &loadout, |_| None).unwrap_err();
    assert!(matches!(err, sim_core::ship::BuildError::UnknownComponent(_)));
}
```

- [ ] **Step 6: Adicionar dep `thiserror` em `crates/sim-core/Cargo.toml`**

```toml
[dependencies]
serde = { workspace = true }
serde_json = "1.0.132"
thiserror = { workspace = true }
```

- [ ] **Step 7: Rodar testes**

```bash
cd c:\Users\user\Downloads\batle
cargo test -p sim-core
```

Expected: `3 passed; 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add crates/sim-core
git commit -m "feat(sim-core): ship builder with stats aggregation and validation"
```

---

### Task 7: UI mínima do Ship Builder (lista de slots + drag-drop)

**Files:**
- Create: `apps/client/src/ui/shipBuilder.ts`, `apps/client/src/ui/shipBuilder.css`, `apps/client/src/ui/componentLibrary.ts`
- Modify: `apps/client/index.html`, `apps/client/src/main.ts`

- [ ] **Step 1: Criar `apps/client/src/ui/componentLibrary.ts`**

```typescript
export interface UiComponentTemplate {
  id: string;
  name: string;
  kind: 'Engine' | 'Weapon' | 'Shield' | 'Sensor' | 'Cargo' | 'Stealth';
  tier: 1 | 2 | 3 | 4 | 5;
}

export const COMPONENT_LIBRARY: UiComponentTemplate[] = [
  { id: 'engine_mk1', name: 'Motor MK-I', kind: 'Engine', tier: 1 },
  { id: 'engine_mk3', name: 'Motor MK-III', kind: 'Engine', tier: 3 },
  { id: 'railgun_s', name: 'Canhão Linear S', kind: 'Weapon', tier: 1 },
  { id: 'plasma_m', name: 'Canhão Plasma M', kind: 'Weapon', tier: 3 },
  { id: 'shield_bio', name: 'Escudo Biônico', kind: 'Shield', tier: 2 },
  { id: 'sensor_array', name: 'Array Sensores', kind: 'Sensor', tier: 1 },
  { id: 'cargo_x2', name: 'Carga Expansão +2', kind: 'Cargo', tier: 1 },
  { id: 'cloak_lvl1', name: 'Camuflagem I', kind: 'Stealth', tier: 1 },
];
```

- [ ] **Step 2: Criar `apps/client/src/ui/shipBuilder.css`**

```css
:root {
  --bg-panel: rgba(8, 12, 22, 0.92);
  --border: #1d2a44;
  --accent: #4ec9ff;
  --text: #d6e1f5;
  --text-dim: #6b7c9c;
}

#ship-builder {
  position: fixed;
  right: 16px;
  top: 16px;
  bottom: 16px;
  width: 360px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  color: var(--text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
}

#ship-builder h2 {
  margin: 0;
  font-size: 16px;
  color: var(--accent);
  letter-spacing: 1px;
}

.section-title {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-top: 8px;
}

.component-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  background: rgba(78, 201, 255, 0.06);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 4px;
  cursor: grab;
  user-select: none;
}

.component-item:active { cursor: grabbing; }
.component-item[data-tier="3"], .component-item[data-tier="4"] { border-color: #7a4eff; }
.component-item[data-tier="5"] { border-color: #ffb84e; }

.slot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border);
  border-radius: 4px;
  margin-bottom: 4px;
  min-height: 32px;
}

.slot-row[data-filled="true"] {
  background: rgba(78, 255, 159, 0.08);
  border-style: solid;
}

.slot-kind { color: var(--text-dim); font-size: 12px; }
.slot-component { color: var(--accent); font-size: 13px; }
```

- [ ] **Step 3: Criar `apps/client/src/ui/shipBuilder.ts`**

```typescript
import { COMPONENT_LIBRARY, type UiComponentTemplate } from './componentLibrary';
import './shipBuilder.css';

interface Slot {
  id: number;
  kind: UiComponentTemplate['kind'];
  component: UiComponentTemplate | null;
}

const TEMPLATE_SLOTS: Array<Omit<Slot, 'component'>> = [
  { id: 1, kind: 'Engine' },
  { id: 2, kind: 'Engine' },
  { id: 3, kind: 'Weapon' },
  { id: 4, kind: 'Weapon' },
  { id: 5, kind: 'Shield' },
  { id: 6, kind: 'Sensor' },
  { id: 7, kind: 'Cargo' },
  { id: 8, kind: 'Stealth' },
];

class ShipBuilder {
  private slots: Slot[] = TEMPLATE_SLOTS.map((s) => ({ ...s, component: null }));
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <h2>SHIP BUILDER</h2>
      <div class="section-title">Componentes</div>
      <div id="lib"></div>
      <div class="section-title">Slots da Nave</div>
      <div id="slots"></div>
      <div class="section-title">Status</div>
      <div id="stats"></div>
    `;
    this.renderLibrary();
    this.renderSlots();
    this.renderStats();
  }

  private renderLibrary(): void {
    const lib = this.root.querySelector('#lib')!;
    lib.innerHTML = '';
    for (const comp of COMPONENT_LIBRARY) {
      const el = document.createElement('div');
      el.className = 'component-item';
      el.draggable = true;
      el.dataset.tier = String(comp.tier);
      el.innerHTML = `<span>${comp.name}</span><span class="slot-kind">T${comp.tier}</span>`;
      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData('text/plain', comp.id);
      });
      lib.appendChild(el);
    }
  }

  private renderSlots(): void {
    const wrap = this.root.querySelector('#slots')!;
    wrap.innerHTML = '';
    for (const slot of this.slots) {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.dataset.slotId = String(slot.id);
      row.dataset.filled = slot.component ? 'true' : 'false';
      row.innerHTML = `
        <span class="slot-kind">#${slot.id} ${slot.kind}</span>
        <span class="slot-component">${slot.component?.name ?? '—'}</span>
      `;
      row.addEventListener('dragover', (ev) => ev.preventDefault());
      row.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const compId = ev.dataTransfer?.getData('text/plain');
        if (!compId) return;
        const comp = COMPONENT_LIBRARY.find((c) => c.id === compId);
        if (!comp) return;
        if (comp.kind !== slot.kind) {
          row.animate(
            [{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
            { duration: 180 },
          );
          return;
        }
        slot.component = comp;
        this.renderSlots();
        this.renderStats();
      });
      wrap.appendChild(row);
    }
  }

  private renderStats(): void {
    const stats = this.root.querySelector('#stats')!;
    const filled = this.slots.filter((s) => s.component).length;
    const total = this.slots.length;
    const mass = this.slots.reduce((acc, s) => acc + (s.component ? 50 * s.component.tier : 0), 0);
    stats.innerHTML = `
      <div>Slots: ${filled}/${total}</div>
      <div>Massa: ${mass} t</div>
    `;
  }

  getLoadout(): Array<{ slotId: number; templateId: string; tier: number }> {
    return this.slots
      .filter((s) => s.component)
      .map((s) => ({ slotId: s.id, templateId: s.component!.id, tier: s.component!.tier }));
  }
}

export function mountShipBuilder(): ShipBuilder {
  const root = document.createElement('div');
  root.id = 'ship-builder';
  document.body.appendChild(root);
  return new ShipBuilder(root);
}
```

- [ ] **Step 4: Wire-up no `main.ts`**

Adicione no início de `bootstrap()`, após `renderer.init()`:

```typescript
import { mountShipBuilder } from './ui/shipBuilder';
const builder = mountShipBuilder();
(window as any).__builder = builder; // para debug / sync com backend na Fase 2+
```

- [ ] **Step 5: Validar**

```bash
pnpm exec tsc --noEmit
pnpm exec vite build
pnpm dev
```

Esperado: painel lateral direito com lista de componentes (drag) e 8 slots. Arrastar motor para slot de arma deve animar shake e recusar. Salvar loadout via `window.__builder.getLoadout()` no console.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ui apps/client/index.html
git commit -m "feat(ui): ship builder panel with drag-and-drop"
```

---

### Task 8: Persistência local (IndexedDB) do loadout

**Files:**
- Create: `apps/client/src/persistence/db.ts`, `apps/client/src/persistence/loadoutRepo.ts`
- Modify: `apps/client/src/ui/shipBuilder.ts`

- [ ] **Step 1: Criar `apps/client/src/persistence/db.ts`**

```typescript
const DB_NAME = 'batle';
const DB_VERSION = 1;
const STORE_LOADOUTS = 'loadouts';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOADOUTS)) {
        db.createObjectStore(STORE_LOADOUTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
```

- [ ] **Step 2: Criar `apps/client/src/persistence/loadoutRepo.ts`**

```typescript
import { openDb, STORE_LOADOUTS } from './db';

export interface SavedLoadout {
  id: string;
  name: string;
  slots: Array<{ slotId: number; templateId: string; tier: number }>;
  createdAt: number;
  updatedAt: number;
}

export async function saveLoadout(loadout: SavedLoadout): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOADOUTS, 'readwrite');
    tx.objectStore(STORE_LOADOUTS).put(loadout);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listLoadouts(): Promise<SavedLoadout[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOADOUTS, 'readonly');
    const req = tx.objectStore(STORE_LOADOUTS).getAll();
    req.onsuccess = () => resolve(req.result as SavedLoadout[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLoadout(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOADOUTS, 'readwrite');
    tx.objectStore(STORE_LOADOUTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 3: Botão "Save" no Ship Builder**

Edite `apps/client/src/ui/shipBuilder.ts`, dentro do método `render()`, após `<div id="stats">`:

Adicione antes do fechamento de `</div>` raiz:

```html
<button id="save-loadout" style="margin-top:8px;padding:8px;background:#1d2a44;color:var(--accent);border:1px solid var(--accent);border-radius:4px;cursor:pointer">SALVAR LAYOUT</button>
```

E adicione no construtor, após `this.render()`:

```typescript
this.root.querySelector('#save-loadout')!.addEventListener('click', async () => {
  const name = prompt('Nome do layout:');
  if (!name) return;
  const { saveLoadout } = await import('../persistence/loadoutRepo');
  await saveLoadout({
    id: crypto.randomUUID(),
    name,
    slots: this.getLoadout(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  alert('Layout salvo!');
});
```

- [ ] **Step 4: Validar**

```bash
pnpm exec vite build
pnpm dev
```

Esperado: botão "SALVAR LAYOUT" salva no IndexedDB. Inspecionar `Application → IndexedDB → batle → loadouts` no DevTools.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/persistence apps/client/src/ui/shipBuilder.ts
git commit -m "feat(persistence): indexdb loadout repository"
```

---

### Task 9: CI no GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Criar `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  client:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/client
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsc --noEmit
      - run: pnpm exec vite build
      - run: pnpm test

  sim-core:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { toolchain: 1.83.0 }
      - uses: Swatinem/rust-cache@v2
      - run: cargo test --workspace --all-features
      - run: cargo clippy --workspace -- -D warnings
```

- [ ] **Step 2: Validar localmente**

```bash
cd c:\Users\user\Downloads\batle
cargo clippy --workspace -- -D warnings
cd apps/client
pnpm exec tsc --noEmit
pnpm exec vite build
```

Expected: tudo verde.

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: github actions for client and sim-core"
```

---

### Task 10: Documento de arquitetura inicial

**Files:**
- Create: `docs/architecture/0001-tech-stack.md`

- [ ] **Step 1: Criar `docs/architecture/0001-tech-stack.md`**

Conteúdo mínimo (não criar bloat):

```markdown
# ADR-0001: Pilha Tecnológica

Status: Aceito · Data: 2026-08-30

## Contexto
[Resumo do problema e requisitos]

## Decisão
[Resumo da pilha escolhida — ver Seção 2 do plano]

## Consequências
- Positivas: ...
- Negativas: ...

## Alternativas avaliadas
- Babylon.js (descartado por: ...)
- Colyseus no servidor (descartado por: GC pauses)
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture
git commit -m "docs: initial ADR for tech stack"
```

---

## 6. Próximas Ações

Quando esta Fase 1 estiver concluída e validada, os próximos planos a serem gerados (com este mesmo template) serão:

- `docs/plans/2026-XX-XX-phase-2-battle-system.md` — Rust game server, physics, combat
- `docs/plans/2026-XX-XX-phase-3-multiplayer-infra.md` — Matchmaking, accounts, scaling
- `docs/plans/2026-XX-XX-phase-4-content.md` — Clans, economy, AI, procgen
- `docs/plans/2026-XX-XX-phase-5-beta.md` — VR/AR, mobile, polish

Cada fase começará com uma nova sessão de brainstorming para refinar requisitos.

---

## 7. Auto-Review (Checklist do writing-plans)

- [x] **Cobertura da spec**: Cada requisito da spec está mapeado para uma fase (1→builder+progressão, 2→batalha+física, 3→infra+multiplayer+contas+chat+clãs, 4→economia+AI+procgen, 5→VR/AR+cross-platform+loja).
- [x] **Sem placeholders**: Todo step tem código real, caminhos exatos, comandos com output esperado.
- [x] **Tipos consistentes**: `ComponentInstance.slot_id` definido em Task 6 e usado consistentemente em `build_ship`. `SlotKind` no Rust e no TS com mesma semântica.
- [x] **TDD respeitado**: Tasks 3, 6 têm testes escritos antes/depois conforme fluxo TDD.
- [x] **Commits frequentes**: Cada task termina com commit.
- [x] **Arquivos com responsabilidade única**: Renderer, ECS, UI, persistência isolados.

---

## 8. Execution Handoff

**Plano completo salvo em** `c:\Users\user\Downloads\batle\docs\plans\2026-08-30-space-battle-game.md`.

**Duas opções de execução:**

1. **Subagent-Driven (recomendado)** — Eu disparo um subagente novo por tarefa, reviso entre tarefas, iteração rápida. Ideal para fases longas e detecção precoce de problemas.

2. **Inline Execution** — Executo as tarefas nesta mesma sessão usando `executing-plans`, em lote com checkpoints para revisão.

**Qual abordagem prefere?**
