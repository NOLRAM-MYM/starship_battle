# ADR-0004: Modelo de voo 3D e controles configuráveis

- **Status:** aceito
- **Data:** 2026-09-01

## Contexto

A nave só girava em torno de Y. `world.rs` aplicava `rotate_y(rot, steer *
turn_rate * dt)` e nada mais: não havia como subir, descer nem inclinar.
Na prática o jogo era 2D com gráficos 3D — a nave deslizava num plano
horizontal invisível.

O controle também era rígido e quebrado fora do QWERTY: o
`InputController` comparava `event.key`, que é o CARACTERE gerado. Num
teclado AZERTY a tecla marcada `W` produz `z`, então o jogador francês
teria os controles trocados sem nenhuma forma de corrigir.

Faltava ainda uma saída: entrando em partida, só recarregando a página.

## Decisão

### 1. Rotação nos três eixos, no referencial LOCAL

`Input` ganhou `pitch` e `roll` (protocolo v4). A composição é
`r * q_pitch * q_yaw * q_roll` — multiplicação à **direita**, que aplica
no eixo local da nave.

Isso importa: à esquerda, a rotação seria em torno dos eixos do mundo, e
depois de rolar 90° "puxar o nariz" mandaria a nave para o norte absoluto
em vez de para cima em relação à cabine. Todo simulador de voo usa o
referencial local por esse motivo.

O quaternion é renormalizado a cada passo. Sem isso o erro de ponto
flutuante acumula ao longo de milhares de ticks e a orientação deriva.

### 2. Teclas por POSIÇÃO física, não por caractere

O input passou a ler `event.code` (`KeyW`, `Digit1`, `ShiftLeft`), que
identifica a tecla física independentemente do layout. `KeyW` é a mesma
tecla em QWERTY, AZERTY, QWERTZ e ABNT2.

O rótulo exibido usa `navigator.keyboard.getLayoutMap()` quando o
navegador oferece, então o jogador vê o caractere impresso na tecla dele;
cai num nome genérico onde a API não existe (Firefox, Safari).

### 3. Mapa remapeável, com conflito resolvido na hora

Padrão pedido: **W/S** sobe e desce o nariz, **A/D** viram, **Q** atira,
**E** defende, **1/2/3** habilidades. Rolagem em **Z/C** e aceleração no
**Shift**, que sobram sob a mão esquerda.

Vincular uma tecla já usada **libera a ação anterior** em vez de deixar
duas ações no mesmo botão; o painel avisa qual ficou sem tecla. Teclas
que o navegador sequestra (F5, F11, F12, Meta) são recusadas.

### 4. Saída para o hangar com desmontagem completa

Botão no HUD e tecla (Esc por padrão). O `teardown` para o laço de
render, desconecta o socket, remove céu/marcos/VFX da cena e desmonta o
HUD. Sem isso, voltar ao hangar deixaria o loop desenhando por cima do
menu e uma segunda partida duplicaria tudo.

## Consequências

**Positivas** — voo real em 3D; controles funcionam em qualquer teclado e
podem ser reconfigurados; dá para sair da partida sem recarregar.

**Negativas / limites aceitos**

- **Quebra de compatibilidade** (v3 → v4): o servidor recusa `Join` de
  cliente com outra versão.
- **Sem mouse nem gamepad.** O eixo de pitch é digital (-1/0/+1), então
  não há controle analógico fino. Um eixo de mouse seria o próximo passo.
- **Sem assistência de voo**: não há estabilizador nem limite de ângulo,
  então é possível ficar de cabeça para baixo e se desorientar. A bússola
  e os marcos ajudam, mas um indicador de horizonte artificial faria falta.
- **`turn_rate` é único para os três eixos.** Naves reais rolam mais
  rápido do que arfam; diferenciar por eixo daria mais caráter a cada casco.

## Verificação

`apps/client/src/input/keyboard.test.ts` — 20 testes: eixos, edge-trigger
de tiro/defesa/habilidades, cancelamento no blur, ignorar digitação em
campos, troca de mapa em tempo real, detecção de conflito e rótulos.

`apps/client/src/net/protocol.test.ts` confere a ORDEM dos eixos no
encoder — se ela divergir do enum em Rust, o servidor leria pitch como
roll e a nave voaria errado sem erro nenhum.

Verificado no navegador com o servidor real: acelerar + W mudou o rumo de
000° para 180° (a nave passou a vertical e virou), os cardeais da bússola
acompanharam, e o botão HANGAR devolveu ao menu.
