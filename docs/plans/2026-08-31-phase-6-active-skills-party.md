# Fase 6 — Habilidades Ativas, Party System e Eventos Visuais

**Data:** 2026-08-31
**Status:** Em andamento
**Dependência:** Fase 5 ✅

## 1. Objetivo
Introduzir a camada de habilidades ativas (Active Skills) no combate, permitir que jogadores formem grupos (Parties) com friendly-fire desativado, e sincronizar eventos visuais efêmeros (VFX) via protocolo. Tudo guiado por TDD (Test-Driven Development).

## 2. Componentes

### 2.1. Habilidades Ativas (Active Skills)
- **Skills**: Dash (impulso de velocidade), EMP (desativa naves próximas), Repair (cura ao longo do tempo).
- **Cooldowns e Durações**: Gerenciados no servidor (autoritativo).
- **Efeitos (Buffs/Debuffs)**: Modificadores temporários na física e estado da nave.
- **Input**: Novo campo no `ClientMsg::Input` para skills ativadas.

### 2.2. Party System (Grupos)
- **Game Server**: Mapeamento de `player_id` -> `party_id`.
- **Regras**: Sem friendly fire entre membros da party. Compartilhamento de XP.

### 2.3. Sincronização de Eventos (VFX)
- **ServerMsg::Event**: Novo tipo de mensagem para eventos de disparo e uso de skill (não persistem, são "fire-and-forget", otimizando banda).

### 2.4. UI/HUD
- **Cliente**: Action bar com cooldowns. Keybinds (1, 2, 3) e botões touch correspondentes.

## 3. Tasks

### Task 6.1 — Active Skills no `sim-core` (TDD)
- **Rust**: Criar `crates/sim-core/src/skills/`.
- **Escopo**: Adicionar estado de skills nas naves, aplicar efeitos (Dash, EMP, Repair), calcular cooldowns e aplicar modificadores no loop de física/dano.
- **Testes**: Escrever testes *antes* da implementação para validar cooldown, duração de efeito e stack de buffs.

### Task 6.2 — Party System no `game-server`
- **Rust**: Adicionar sistema de Party no estado do servidor. Ignorar colisão de projétil/dano entre membros.
- **Testes**: Projétil não causa dano a aliado; XP de NPC destruído é dividido.

### Task 6.3 — Sincronização de Eventos VFX
- **Rust/TS**: Adicionar `ServerMsg::Event` no protocolo e decoder no cliente.
- **Testes**: Roundtrip de serialização.

### Task 6.4 — Action Bar e Input (Cliente)
- **TS**: Atualizar HUD com cooldown overlays, capturar teclas 1,2,3 e cliques touch para emitir no `InputMsg`.
- **Testes**: Componentes da UI refletem estado de cooldown.

## 4. Critérios de Sucesso
- Jogador pode ativar um Dash que aumenta a velocidade por 2 segundos e entra em cooldown de 10s.
- Jogador na party não sofre dano de amigo.
- TDD rigoroso: todos os casos de uso devem ser validados em testes unitários.