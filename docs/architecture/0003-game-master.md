# ADR-0003: Papéis de conta e Game Master

- **Status:** aceito
- **Data:** 2026-09-01

## Contexto

Não havia conceito de privilégio no jogo. A tabela `accounts` tinha
apenas `username`, `email` e `password_hash`; todas as contas eram
iguais. Qualquer ajuste operacional — creditar um jogador, conceder um
item, corrigir XP, remover uma conta — só era possível com `psql` direto
no banco, sem trilha de auditoria e sem controle de quem fez o quê.

Era preciso também uma conta de jogador com saldo para testar os fluxos
de loja e estaleiro sem depender de `INSERT` manual em `wallets`.

## Decisão

### 1. Papel na conta, não tabela de permissões

`accounts.role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','gm'))`.

Duas roles bastam para o problema atual. Uma tabela de papéis/permissões
seria abstração sem demanda: não há hoje um terceiro nível nem
permissões granulares que justifiquem o custo de join por request.

Índice parcial `WHERE role = 'gm'` — poucos GMs entre muitos jogadores.

### 2. Papel dentro do JWT, com fail-closed

O token carrega `role`, então o guard não faz consulta ao banco por
requisição. `verifyToken` normaliza qualquer valor ausente ou
desconhecido para `'player'`: um token emitido antes desta mudança, ou
adulterado, **nunca** vira GM por omissão.

O contraponto é que a promoção só vale no próximo login — o token antigo
continua `player` até expirar. É o comportamento certo para escalar
privilégio (a pessoa precisa reautenticar) e é aceitável para rebaixar,
já que o `jwtExpiresSec` limita a janela.

### 3. Guard antes do banco, validação antes do guard de banco

`requireGm` responde 403 sem distinguir "sem token", "token inválido" e
"token de jogador" — não vaza se o endpoint existe nem se a autenticação
passou.

A ordem dentro de cada handler é: **autorização → validação de entrada →
disponibilidade do banco**. A primeira versão checava o banco logo após a
autorização, e um payload inválido respondia 503 em vez de 400; os testes
pegaram isso.

### 4. Toda mutação de moeda passa pelo ledger

`POST /gm/accounts/:id/grant` grava em `transactions` com
`reason = 'gm_grant'`, `from_account_id = NULL` (moeda criada, não
transferida) e `ref_id` = id do GM que concedeu. Uma auditoria consegue
separar crédito de origem administrativa de crédito ganho em jogo.

O saldo inicial do provisionamento também entra, com `reason = 'provision'`.

### 5. Reuso da progressão em vez de SQL próprio

`POST /gm/accounts/:id/xp` chama `addXp` do módulo de progressão, que já
recalcula o `level` pela curva oficial dentro da mesma transação.
Escrever em `account_xp` direto daqui criaria um segundo lugar para a
curva divergir.

### 6. Provisionamento idempotente com senha gerada

`src/gm/provision.ts` (`pnpm --filter @batle/api provision`) cria a conta
de GM e a de jogador de teste. Roda as migrações antes, é idempotente
(rodar de novo não duplica nem troca senha) e **nunca sobrescreve a senha
de uma conta existente** — isso trancaria alguém fora sem aviso.

Senhas vêm de `crypto.randomBytes(18)` (~144 bits) e são impressas uma
única vez. `GM_PASSWORD` / `PLAYER_PASSWORD` no ambiente permitem definir
as suas.

## Endpoints

| Método | Rota | Efeito |
|---|---|---|
| GET | `/gm/overview` | contadores do shard |
| GET | `/gm/accounts?limit=&q=` | lista contas com carteira e nº de itens |
| PATCH | `/gm/accounts/:id/role` | promove/rebaixa |
| POST | `/gm/accounts/:id/grant` | credita moeda (ledger) |
| POST | `/gm/accounts/:id/items` | concede item do catálogo |
| POST | `/gm/accounts/:id/xp` | soma XP e recalcula nível |
| DELETE | `/gm/accounts/:id` | remove conta e o ledger dela |

Um GM não pode se rebaixar nem se apagar (409): se fosse o último,
o shard ficaria sem ninguém capaz de promover outro, e a API não teria
como se recuperar.

## Consequências

**Positivas** — operação sem `psql`; toda ação administrativa logada
(`req.log.warn`) e, no caso de moeda, no ledger; conta de teste com saldo
disponível de imediato.

**Negativas / limites aceitos**

- **"Controle total" é sobre dados persistidos, não sobre a simulação.**
  Não há comando para expulsar um jogador conectado, teleportar nave ou
  pausar o mundo — o `game-server` não tem canal administrativo. Isso
  exigiria uma porta de controle no servidor Rust.
- **Promoção só vale no próximo login** (consequência do papel no JWT).
- **Sem 2FA nem allowlist de IP** nas rotas de GM. Para produção, o
  mínimo seria restringir `/gm/*` a uma rede interna no Ingress.
- **Sem rate limit específico**; herda o global de 200/min.

## Verificação

`apps/api/test/gm.test.ts` — 30 testes: matriz de 7 rotas x (sem token /
token de jogador / token de GM), fail-closed do papel no JWT, proteções
de auto-rebaixamento e autoexclusão, e validação de entrada.

Fluxo manual verificado com a pilha no ar: login do GM e do jogador,
403 para jogador e anônimo, listagem, grant de 7.500 créditos, concessão
de item, 5.000 XP → nível 10, e o item concedido aparecendo como
"Adquirido" na loja do cliente.
