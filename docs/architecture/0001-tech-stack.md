# ADR-0001: Pilha Tecnológica

Status: Aceito · Data: 2026-08-30

## Contexto

Precisamos de um jogo MMO de batalhas espaciais no navegador com:
- Renderização 3D fotorrealista (WebGPU, partículas, sombras volumétricas)
- Suporte a 100 jogadores simultâneos por mapa
- Lógica de jogo determinística compartilhada entre cliente e servidor
- Cross-platform (desktop, mobile, VR/AR)
- Latência <100ms p99 em batalhas online

## Decisão

| Camada | Escolha | Justificativa principal |
|---|---|---|
| Cliente (UI/3D) | TypeScript + Three.js (WebGPURenderer) | WebGPU de primeira, ecossistema maduro |
| ECS cliente | bitECS | Performático, garbage-free, ideal para 10k+ entidades |
| Linguagem servidor de jogo | Rust + Bevy | Zero GC pauses, latência determinística |
| Networking | QUIC (quinn) + snapshot interpolation | 0-RTT, melhor para mobile |
| API | Node.js + Fastify (TS) | Compartilha tipos com cliente, webhooks |
| Dados | PostgreSQL + Redis + TimescaleDB | Hot path relacional + cold path séries temporais |
| Persistência cliente | IndexedDB | Offline-first; sync com backend na Fase 3 |
| Áudio | Web Audio API | Posicional 3D nativo |
| VR/AR | WebXR Device API + Three.js XR | Padrão aberto, suporte a Quest/Vision/Pico |

## Consequências

**Positivas:**
- TS estrito compartilhado cliente↔API reduz drift de contratos
- Rust no servidor elimina GC pauses em tick rate 30Hz com 100 players
- WebGPU permite compute shaders para simulação de partículas e nebulosas
- IndexedDB permite jogo offline em aviões/submarinos

**Negativas:**
- WebGPU ainda exige fallback (WebGL2) para ~20% dos navegadores
- Rust aumenta o tempo de iteração de balanceamento
- bitECS é menos conhecido que alternativas JS

**Riscos mitigados:**
- Mantemos sim-core puro e testável em WASM para compartilhar regras
- Plano de code-splitting agressivo para reduzir TTI mobile
- Plano de feature flagging por região para rollout gradual

## Alternativas Avaliadas

| Alternativa | Por que descartada |
|---|---|
| Babylon.js | Pesado para nosso caso, prefiro Three com material custom |
| Unity WebGL | Bundle enorme, sem suporte nativo a WebXR moderno |
| Colyseus (Node) no servidor | GC pauses imprevisíveis em 100 players |
| WebSocket puro | Sem 0-RTT, pior em mobile |
| PostgreSQL puro para tudo | Custaria caro em queries analíticas |

## Referências

- Plano completo: `docs/plans/2026-08-30-space-battle-game.md`
- Padrão de ADR: https://adr.github.io/
