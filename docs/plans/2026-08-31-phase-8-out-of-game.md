# Fase 8 — Fluxo Fora de Jogo (Login & Hangar) Implementation Plan

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIO: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa por tarefa. Steps usam checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as telas de Login, Registro e um Menu Principal (Hangar) para gerenciar as naves antes de entrar na partida.

**Architecture:** 
- O cliente (`main.ts`) deixará de conectar imediatamente no WebSocket.
- Será implementada uma máquina de estados visual básica: `LOGIN` -> `HANGAR` -> `PLAYING`.
- **LOGIN:** Formulário HTML/CSS comunicando com a API `/auth/login` e `/auth/register` (construída na Fase 3). O token JWT será salvo no `localStorage`.
- **HANGAR:** Tela que lista os loadouts do jogador (via `loadoutRepo.ts` da Fase 7), permite abrir o `ShipBuilder` e possui um botão "JOGAR" que aciona a transição para o estado `PLAYING`.
- **PLAYING:** Oculta as interfaces fora de jogo, conecta ao `GameServer` (WebSocket) e inicia o loop de renderização (WebGPU).

**Tech Stack:** TypeScript (Vanilla DOM/HTML/CSS), Vite.

---

## 1. Escopo e Tasks

### Task 8.1: Cliente de Autenticação (authApi.ts)

**Files:**
- Create: `apps/client/src/net/authApi.ts`

- [ ] **Step 1: Implementar chamadas HTTP para Auth**
Criar `apps/client/src/net/authApi.ts` para abstrair as chamadas REST.

```typescript
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  return data.token; // Retorna o JWT
}

export async function register(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error('Registration failed');
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/client/src/net/authApi.ts
git commit -m "feat(client): auth api client functions"
```

---

### Task 8.2: Tela de Login (LoginScreen.ts)

**Files:**
- Create: `apps/client/src/ui/LoginScreen.ts`
- Create: `apps/client/src/ui/LoginScreen.css`

- [ ] **Step 1: Criar o CSS da tela de Login**
Criar `apps/client/src/ui/LoginScreen.css` com estilos para um modal centralizado (fundo escuro, inputs, botões).

- [ ] **Step 2: Implementar a classe LoginScreen**
Criar `apps/client/src/ui/LoginScreen.ts`.

```typescript
import './LoginScreen.css';
import { login, register } from '../net/authApi';

export class LoginScreen {
  private root: HTMLElement;
  private onSuccess?: () => void;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'login-screen';
    this.render();
    document.body.appendChild(this.root);
  }

  onLoginSuccess(cb: () => void) {
    this.onSuccess = cb;
  }

  hide() {
    this.root.style.display = 'none';
  }

  show() {
    this.root.style.display = 'flex';
  }

  private render() {
    this.root.innerHTML = `
      <div class="login-box">
        <h1>Space Battle</h1>
        <input type="text" id="login-user" placeholder="Username" />
        <input type="password" id="login-pass" placeholder="Password" />
        <button id="btn-login">Login</button>
        <button id="btn-register">Register</button>
        <div id="login-error" style="color: red; margin-top: 10px;"></div>
      </div>
    `;

    const btnLogin = this.root.querySelector('#btn-login') as HTMLButtonElement;
    const btnRegister = this.root.querySelector('#btn-register') as HTMLButtonElement;
    const userIn = this.root.querySelector('#login-user') as HTMLInputElement;
    const passIn = this.root.querySelector('#login-pass') as HTMLInputElement;
    const errDiv = this.root.querySelector('#login-error') as HTMLElement;

    btnLogin.addEventListener('click', async () => {
      try {
        const token = await login(userIn.value, passIn.value);
        localStorage.setItem('token', token);
        localStorage.setItem('username', userIn.value);
        this.onSuccess?.();
      } catch (e) {
        errDiv.textContent = 'Erro ao fazer login. Verifique as credenciais.';
      }
    });

    btnRegister.addEventListener('click', async () => {
      try {
        await register(userIn.value, passIn.value);
        errDiv.style.color = 'green';
        errDiv.textContent = 'Registrado com sucesso! Faça login.';
      } catch (e) {
        errDiv.style.color = 'red';
        errDiv.textContent = 'Erro ao registrar (usuário pode já existir).';
      }
    });
  }
}
```

- [ ] **Step 3: Commit**
```bash
git add apps/client/src/ui/LoginScreen.*
git commit -m "feat(client): login screen UI"
```

---

### Task 8.3: Hangar/Lobby (HangarScreen.ts)

**Files:**
- Create: `apps/client/src/ui/HangarScreen.ts`
- Create: `apps/client/src/ui/HangarScreen.css`

- [ ] **Step 1: Criar o CSS do Hangar**
Criar `apps/client/src/ui/HangarScreen.css` com estilos para uma tela cheia, lista de naves e botão grande de PLAY.

- [ ] **Step 2: Implementar a classe HangarScreen**
Criar `apps/client/src/ui/HangarScreen.ts` integrando com `loadoutRepo.ts`.

```typescript
import './HangarScreen.css';
import { listLoadouts, type SavedLoadout } from '../persistence/loadoutRepo';

export class HangarScreen {
  private root: HTMLElement;
  private onPlay?: (selectedLoadout: SavedLoadout | null) => void;
  private onOpenBuilder?: () => void;
  private loadouts: SavedLoadout[] = [];
  private selectedIndex = -1;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hangar-screen';
    this.root.style.display = 'none'; // Inicia oculto
    this.render();
    document.body.appendChild(this.root);
  }

  onPlayClicked(cb: (loadout: SavedLoadout | null) => void) {
    this.onPlay = cb;
  }

  onBuilderClicked(cb: () => void) {
    this.onOpenBuilder = cb;
  }

  hide() { this.root.style.display = 'none'; }
  
  async show() {
    this.root.style.display = 'flex';
    await this.refreshLoadouts();
  }

  private async refreshLoadouts() {
    try {
      this.loadouts = await listLoadouts();
      if (this.loadouts.length > 0 && this.selectedIndex === -1) {
        this.selectedIndex = 0;
      }
      this.renderList();
    } catch (e) {
      console.error('Failed to fetch loadouts', e);
    }
  }

  private render() {
    this.root.innerHTML = `
      <div class="hangar-box">
        <h1>Hangar</h1>
        <div id="hangar-list"></div>
        <div class="hangar-actions">
          <button id="btn-builder">Construir Nova Nave</button>
          <button id="btn-play" class="primary-btn">ENTRAR NA BATALHA</button>
        </div>
      </div>
    `;

    this.root.querySelector('#btn-builder')?.addEventListener('click', () => {
      this.onOpenBuilder?.();
    });

    this.root.querySelector('#btn-play')?.addEventListener('click', () => {
      const selected = this.selectedIndex >= 0 ? this.loadouts[this.selectedIndex] : null;
      this.onPlay?.(selected);
    });
  }

  private renderList() {
    const list = this.root.querySelector('#hangar-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (this.loadouts.length === 0) {
      list.innerHTML = '<p>Nenhuma nave encontrada. Construa uma!</p>';
      return;
    }

    this.loadouts.forEach((l, idx) => {
      const div = document.createElement('div');
      div.className = 'hangar-item' + (idx === this.selectedIndex ? ' selected' : '');
      div.textContent = l.name;
      div.addEventListener('click', () => {
        this.selectedIndex = idx;
        this.renderList();
      });
      list.appendChild(div);
    });
  }
}
```

- [ ] **Step 3: Commit**
```bash
git add apps/client/src/ui/HangarScreen.*
git commit -m "feat(client): hangar screen UI for loadout selection"
```

---

### Task 8.4: Refatorar o `main.ts` (State Machine)

**Files:**
- Modify: `apps/client/src/main.ts`

- [ ] **Step 1: Alterar o fluxo de inicialização**
Em `main.ts`, não conectar o WebSocket logo de cara.
Criar instâncias do `LoginScreen` e `HangarScreen`.
- Se tiver token, pular `LoginScreen` e mostrar `HangarScreen`.
- Ao clicar em Play no `HangarScreen`, ocultar a UI, inicializar a conexão de rede (`connect(...)`) enviando o nome do jogador (salvo no `localStorage`) e iniciar o `requestAnimationFrame(tick)`.

- [ ] **Step 2: Adaptar o ShipBuilder**
Vincular o botão "Construir" do Hangar para chamar `builder.toggle()`. Ao salvar no ShipBuilder, atualizar a lista do Hangar.

- [ ] **Step 3: Testar o Fluxo**
Run: `pnpm --filter client build` e garantir que não há erros.

- [ ] **Step 4: Commit**
```bash
git add apps/client/src/main.ts
git commit -m "feat(client): implement out-of-game flow (login -> hangar -> play)"
```

---

## 2. Execução

Plano concluído e salvo em `docs/plans/2026-08-31-phase-8-out-of-game.md`.
