# Space Battle Arena

MMO de batalhas espaciais em navegador com construção modular de naves.

## Estrutura
- `apps/client` — cliente TypeScript/WebGPU
- `apps/server-api` — backend Fastify (Fase 3+)
- `crates/sim-core` — lógica de jogo compartilhada (Rust)
- `docs/` — arquitetura e planos

## Requisitos
- Node >= 22
- pnpm >= 9
- Rust >= 1.83

## Setup
```bash
pnpm install
pnpm dev
```

## Roadmap
Ver `docs/plans/2026-08-30-space-battle-game.md`.
