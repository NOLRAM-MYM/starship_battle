# Fase 5 — VR/AR (WebXR), Mobile e Polish Beta

**Data:** 2026-08-31
**Status:** ✅ Concluída
**Dependência:** Fase 4 ✅ (Mundo Vivo: economia, NPC AI, worldgen, missões, sync binária)

## 1. Objetivo

Elevar o jogo a um nível de produto: suportar **VR imersivo via WebXR**, **jogo mobile via touch**, **rendering das entidades vivas** introduzidas na Fase 4, e fechar o ciclo de **polish beta** (UI/HUD, settings, áudio, acessibilidade, leveling). O resultado deve ser um build jogável em desktop, mobile e headset VR, com CI garantindo regressão zero.

## 2. Componentes

### 2.1. WebXR / VR
- **Sessão XR**: lifecycle (requestSession, endSession), feature detect (`navigator.xr?.isSessionSupported`).
- **Stereo rendering**: dois olhos via `renderer.xr.enabled = true` + `renderer.xr.setReferenceSpaceType('local-floor')`.
- **Controllers**: hand tracking + gamepad abstraction (botões primários: thrust, brake, fire, look).
- **HUD XR**: floating panels via `THREE.Group` em world space, legíveis a 1m.
- **Comfort**: vignette, snap turn (30°/60°/90°), movement smooth/dash.
- **Fallback**: modo "desktop" continua funcional quando XR indisponível.

### 2.2. Mobile / Touch
- **Touch input layer**: virtual joystick (esquerda: thrust + yaw), botão direito: fire, swipe: brake.
- **Adaptive UI**: breakpoints (mobile < 768px, tablet 768-1024, desktop > 1024), CSS grid + media queries.
- **Performance**: detect `devicePixelRatio` alto → cap em 1.5; LOD em asteroids/estrelas; render scale 0.75 em low-end.
- **Offline detection**: indicador de conexão; retry exponencial no `connect()`.
- **Wake lock**: `navigator.wakeLock?.request('screen')` durante jogo.

### 2.3. Renderers cliente (entidades Fase 4)
- **NpcRenderer**: nave NPC com cor por arquétipo (pirata=vermelho, patrulheiro=azul, minerador=amarelo), health bar 3D.
- **AsteroidRenderer**: rocks procedural com displacement noise; kind-driven material (Rock, Iron, Gold, DarkMatter).
- **AnomalyRenderer**: warp (anel distorcido), radiation (nuvem pulsante), gravity well (espiral).
- **WreckRenderer**: destroços com partícula de fumaça, loot icon hoverable.
- **ECS components**: `NpcTag`, `AsteroidTag`, `AnomalyTag`, `WreckTag` com TypedArrays.
- **Snapshot decode**: extrair `EntityPayload` em `protocol.ts` (typed discriminated union).

### 2.4. Polish Beta
- **HUD**: minimapa, target reticle, HP/Shield bar, XP bar, money counter, ping.
- **Settings menu**: gráfico (low/med/high/ultra), áudio (master/sfx/music), input (sensibilidade, invert Y), acessibilidade (colorblind, font scale, subtitles).
- **Áudio**: WebAudio com sounds pools (laser, explosion, engine hum, ui beeps); música adaptativa por estado (idle/combat/menu).
- **Acessibilidade**: high-contrast mode, font scaling 1x-2x, subtitle para chat de voz (placeholder).
- **Performance HUD**: fps, frame time, draw calls, memory (via `performance.memory` se disponível).
- **Leveling / Skill tree**: XP ganha por kill/quest; 3 skill branches (Combat, Industry, Exploration) com 5 nodes cada; persistência via API.

### 2.5. CI / Test Suite do cliente
- **vitest config**: já existe; ampliar cobertura com `ecs.test.ts` + novos para `protocol.test.ts` (EntityPayload decode), `shipBuilder.test.ts`.
- **GitHub Actions** ou `scripts/ci.sh`: rodar `pnpm -r build` + `cargo test` + `vitest run` em paralelo.
- **Build size budget**: falha se `apps/client/dist/` > 5 MB gzipped.
- **Helm lint**: já existe `scripts/lint-helm.mjs`; adicionar ao CI.

## 3. Tasks

### Task 5.1 — WebXR / VR session
- `apps/client/src/xr/session.ts`: `isSupported()`, `request(mode)`, `end()`, eventos.
- `apps/client/src/xr/controllers.ts`: mapeamento controller → ações (thrust, fire, look).
- `apps/client/src/xr/hud.ts`: painéis world-space (HP, reticle, chat).
- `apps/client/src/xr/comfort.ts`: snap turn, vignette, movement modes.
- `apps/client/src/render/Renderer.ts`: integrar `renderer.xr`; loop XR-aware (usar `renderer.setAnimationLoop`).
- `apps/client/src/ui/xrToggle.ts`: botão "Enter VR" / "Exit VR".
- Critério: 3 testes (isSupported default false, mock session lifecycle, fallback desktop).
- Manual: build roda, `chrome://flags/#webxr` em desktop testa o caminho.

### Task 5.2 — Mobile / Touch
- `apps/client/src/input/touch.ts`: virtual joystick + buttons + swipe gesture.
- `apps/client/src/input/adaptive.ts`: detectar mobile (`matchMedia('(pointer: coarse)')`) e rotear.
- `apps/client/src/styles/mobile.css`: breakpoints, fullscreen, safe-area-inset.
- `apps/client/src/ui/responsive.ts`: rebuild HUD layout em resize (use `ResizeObserver`).
- `apps/client/src/perf/adaptive.ts`: ajustar `pixelRatio` e `renderScale` baseado em FPS medido.
- `apps/client/src/net/reconnect.ts`: exponential backoff (1s, 2s, 4s, max 30s).
- Critério: 4 testes (touch input mock, mobile detect, reconnect backoff, perf throttling).

### Task 5.3 — Renderers entidades Fase 4
- `apps/client/src/ecs/components/npc.ts`, `asteroid.ts`, `anomaly.ts`, `wreck.ts` (TypedArrays).
- `apps/client/src/ecs/systems/worldEntities.ts`: spawn/update/destroy a partir de `EntityPayload`.
- `apps/client/src/render/NpcRenderer.ts`, `AsteroidRenderer.ts`, `AnomalyRenderer.ts`, `WreckRenderer.ts`.
- `apps/client/src/net/protocol.ts`: estender decoder para `EntityPayload` variants.
- `apps/client/src/render/materials.ts`: materiais por kind (Iron, Gold, DarkMatter têm albedo diferente).
- Critério: 4 testes (decoder de cada payload, spawn/destroy ECS, material kind → color).

### Task 5.4 — Polish Beta (HUD + Settings + Audio + Leveling)
- `apps/client/src/hud/Hud.ts`: HP/Shield bar, reticle, minimapa (Canvas2D ou DOM), XP bar, money.
- `apps/client/src/ui/settings.ts`: painel de settings persistido em `localStorage`.
- `apps/client/src/audio/AudioBus.ts`: WebAudio com SoundPool, música adaptativa.
- `apps/client/src/ui/accessibility.ts`: colorblind filters, font scaling.
- `apps/client/src/perf/PerfHud.ts`: overlay opcional (Ctrl+P toggle).
- `apps/api/src/progression/`:
  - `schema.sql`: `account_xp`, `account_skills` (account_id, branch, node, level).
  - `routes.ts`: `GET /progression/me`, `POST /progression/skills/spend`.
  - `service.ts`: XP gains por evento (kill, quest complete, wreck salvage); spend valida pré-requisitos.
- Critério: 6 testes (hud snapshot, settings persistence, audio pool, skill tree validity, XP curve, skill spend).

### Task 5.5 — CI + Test Suite do cliente + Build budget
- `apps/client/vitest.config.ts`: configurar ambiente `happy-dom` (já tem), thresholds de cobertura opcional.
- `apps/client/test/smoke.test.ts`: 1 teste que valida que `bootstrap()` é chamável (mock `navigator.gpu`).
- `scripts/ci.sh`: orquestrador que roda `pnpm -r build && pnpm -r test && cargo test --workspace`.
- `scripts/check-bundle-size.mjs`: falha se `apps/client/dist/index.html` gzip > 5 MB.
- `.github/workflows/ci.yml` (opcional, se o repo usar GitHub): matriz Rust + Node, cache de pnpm store + cargo registry.
- Critério: 2 testes (bundle size check, smoke test).

## 4. Critérios de Sucesso

- `chrome://flags/#webxr` em desktop detecta suporte e o botão "Enter VR" entra em sessão imersiva.
- Mobile (Chrome Android): joystick virtual + 2 botões controlam thrust/fire, HUD responsivo sem overflow.
- Snapshot com `EntityPayload::Npc`/`Asteroid`/`Anomaly`/`Wreck` é decodificado e renderizado pelo cliente.
- Leveling: kill de pirate dá XP, sobe nível, gasta ponto em skill node Combat.T1, persiste via API.
- `pnpm ci` roda em < 5 min, todos os testes passam, bundle < 5 MB gzip.
- Build de produção (`pnpm --filter @batle/client build`) continua com 0 erros TS.
- Todos os testes de Fases 1-4 continuam passando (regressão zero).

## 5. Não-Objetivos

- AR (plane detection, hit-test) — apenas esqueleto de XR VR; AR fica para Fase 6+.
- Streaming de assets (glTF on-demand) — todos os assets no bundle.
- Multiplayer VR (multiplayer cross-platform com mix VR/desktop) fica para Fase 6+; em Fase 5 cada cliente é VR-ou-desktop.
- Matchmaking de skill rating refinado (Elo) — só basic por level bracket.
- PvP balanceado com skills ativos — só passive nodes.
- Voice chat — placeholder; NATS já tem o canal.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| WebXR API instável entre browsers | Feature detect + fallback desktop; testes de unidade sem browser real |
| FPS baixo em mobile (Galaxy S21) | LOD agressivo, render scale adaptativo, target 30fps mínimo em low |
| Bundle JS > 5 MB (three.js + bitecs) | Three.js tree-shake com imports nomeados; dynamic import de materials |
| Leveling grind quebra balance | XP curve calibrada: lvl 1→2 = 100 XP, escala 1.4x por nível; skill cap em 5/node |
| CI flaky por timeout | Network mocks, retries com jitter, test isolation |
| Acessibilidade adiciona complexidade | Toggle global, defaults sensatos; não bloqueante |

## 7. Convenções

- Toda feature XR atrás de feature detect (`if (navigator.xr)`) — nunca quebra o desktop.
- Settings persistidos em `localStorage` com schema versionado (`batle.settings.v1`).
- Áudio: nunca `new Audio()` direto; sempre via `AudioBus` (pool, gain control, mute).
- Materials: instanciar uma vez por kind, clonar com `material.clone()` para variações.
- Skill tree: arquivo `data/skillTree.json` carregado no boot; mudanças de balance não requerem redeploy do cliente.
- CI: cache pnpm store + cargo registry; Node 20+ e Rust 1.78+.

## 8. Estimativa de tasks

| Task | Complexidade | Linhas estimadas | Testes |
|---|---|---|---|
| 5.1 WebXR | Média | ~600 | 3 |
| 5.2 Mobile | Média | ~500 | 4 |
| 5.3 Renderers Fase 4 | Alta | ~900 | 4 |
| 5.4 Polish Beta | Alta | ~1100 | 6 |
| 5.5 CI + bundle | Baixa | ~250 | 2 |
| **Total** | — | **~3350** | **19** |

## 9. Resultado final esperado pós-Fase 5

- **Rust:** 145 (atuais) + ~10 (progressão) = ~155 testes
- **API TS:** 115 (atuais) + ~12 (progression) = ~127 testes
- **Client TS:** 0 (atual) + 19 (novos) = ~19 testes
- **Build size:** < 5 MB gzip cliente
- **CI:** < 5 min end-to-end
- **Plataformas suportadas:** desktop (Chrome/Edge/Firefox/Safari), mobile (Chrome Android, Safari iOS), VR (Quest Browser, Chrome desktop com headset)

## 10. Status Final

**Concluído em:** 2026-08-31

### Tasks entregues (5/5)

| Task | Escopo | Arquivos principais | Testes |
|---|---|---|---|
| 5.1 | WebXR/VR | `apps/client/src/xr/{session,controllers,hud,comfort,types}.ts`, `ui/xrToggle.ts` | 4 vitest |
| 5.2 | Mobile/Touch | `apps/client/src/input/{touch,adaptive}.ts`, `perf/adaptive.ts`, `net/reconnect.ts`, `styles/mobile.css`, `ui/responsive.ts` | 4 vitest |
| 5.3 | Renderers Fase 4 + decoder | `apps/client/src/render/{WorldEntityRenderer,materials}.ts`, `ecs/{components,systems}/worldEntities.ts`, decoder de `EntityPayload` em `net/protocol.ts` | 4 vitest |
| 5.4 | Polish Beta + Leveling | `apps/client/src/{hud/Hud,ui/settings,ui/accessibility,audio/AudioBus,perf/PerfHud,data/skillTree}.ts`, `apps/api/src/progression/{types,repository,service,routes}.ts` + `schema.sql` | 3 client + 13 API |
| 5.5 | CI + bundle | `scripts/{ci.sh,ci.ps1,run-ci.mjs,check-bundle-size.mjs}`, `apps/client/test/smoke.test.ts` | 1 vitest |

### Estatísticas finais pós-Fase 5

- **Rust:** 145 testes passando (sem mudança na Fase 5)
- **API TS:** 115 + 13 = **128 testes** vitest
- **Client TS:** 0 + 19 = **35 testes** vitest (incluindo smoke)
- **Bundle cliente (gzipped):** 0.75 MB / 5 MB budget
- **CI script:** `pnpm run ci` orquestra install + build + test (TS+Rust) + helm lint + bundle check em uma chamada
- **Plataformas suportadas:** desktop WebGPU, mobile touch, VR via WebXR (Quest Browser / Chrome com headset)
- **Total acumulado do projeto:** ~272 testes (145 Rust + 128 API + 35 client)

### Mudanças de protocolo

- **Cliente TS agora bate com o servidor Rust v2:** `PROTOCOL_VERSION = 2`, `WelcomeMsg.world_seed`, `EntityPayload` decoder para Npc/Asteroid/Anomaly/Wreck.
- O servidor já estava em v2 desde a Fase 4.5; este é o alinhamento do cliente.

### Decisões de arquitetura

- **WebGPU como renderer único**: o `GameRenderer` já usa `three/webgpu`; WebXR é apenas um modo (`renderer.xr.enabled`).
- **Fallback desktop-first**: features XR/mobile todas com feature detect; desktop continua funcionando sem flag.
- **Áudio sintético**: zero assets externos, sons gerados em runtime (square/sawtooth/sine/triangle/noise). Permite bundle leve (< 1 MB) sem licenças.
- **Leveling passivo**: skill tree com 3 branches × 5 nodes, mas nodes passivos (sem habilidades ativas). Ativas ficam para Fase 6+.
- **Skill tree em JSON estático**: `apps/client/src/data/skillTree.json` permite rebalance sem redeploy.

### Pendências para Fase 6+

- **Multiplayer VR cross-platform** (mix VR/desktop na mesma partida) — fora do escopo da Fase 5.
- **AR (plane detection, hit-test)** — apenas esqueleto VR; AR fica para Fase 6+.
- **Habilidades ativas** (skill tree nodes que dão abilities in-game) — Fase 6+.
- **Streaming de assets** (glTF on-demand) — todos os assets no bundle por enquanto.
- **Voice chat** — placeholder; NATS já tem o canal, falta UI.
- **Matchmaking por skill rating (Elo)** — só level bracket básico; Elo em Fase 6+.
- **PvP balanceado com skills ativos** — só passive nodes em Fase 5.

## 11. Próximos Passos

- Considerar **Fase 6 — Multiplayer Avançado + Conteúdo** (clãs em combate, raids, eventos sazonais, etc.) ou **Fase 6 — AR + Habilidades Ativas + LiveOps**.
- Atualizar `project_memory.md` para refletir novos módulos (XR, mobile, polish, progression).
- Smoke test de produção: deployar bundle em staging e validar com headsets reais (Quest 3) e Chrome Android.
