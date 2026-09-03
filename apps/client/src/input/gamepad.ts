/**
 * Controles: DualShock 4, DualSense, Switch Pro e afins.
 *
 * Vale dizer o que o navegador NÃO faz, porque muda o que dá para
 * prometer: ele não pareia nada. O emparelhamento por Bluetooth acontece
 * no sistema operacional — o jogo só recebe a `Gamepad API`, que entrega
 * qualquer controle já pareado, com fio ou sem, sem diferença. Por isso
 * não existe "conectar via Bluetooth" aqui: existe reconhecer o que o
 * sistema já conectou, e mapear direito.
 *
 * O ganho maior nem é a conveniência: é o ANALÓGICO. O teclado só sabe
 * -1, 0 ou +1, e foi por isso que enquadrar um alvo era difícil — o
 * modelo de voo ganhou inércia para compensar. Uma alavanca entrega
 * qualquer valor no meio, então uma correção de dois graus vira um
 * empurrãozinho de dois graus.
 *
 * Sobre os modelos: o navegador expõe o `id` do dispositivo, e daí dá
 * para reconhecer a FAMÍLIA (PlayStation, Nintendo, Xbox) e acertar os
 * RÓTULOS dos botões. O layout físico é o mesmo "standard mapping" nos
 * três, então o jogo funciona mesmo num controle que não reconhecemos —
 * só mostra os nomes genéricos. Isso importa para hardware novo, como o
 * Switch 2: ele funciona no dia do lançamento, sem esperar que alguém
 * acrescente o id dele a uma lista.
 */

/** Família de controle, para os rótulos dos botões. */
export type PadFamily = 'playstation' | 'nintendo' | 'xbox' | 'generic';

export interface PadInfo {
  index: number;
  id: string;
  family: PadFamily;
  /** Nome curto para mostrar na interface. */
  label: string;
}

/**
 * Reconhece a família pelo `id` que o navegador expõe.
 *
 * Casamento por SUBSTRING, e não por lista de ids exatos: os ids variam
 * entre navegadores, sistemas e revisões de firmware do mesmo controle.
 * Uma lista exata estaria desatualizada na primeira revisão.
 */
export function detectFamily(id: string): PadFamily {
  const s = id.toLowerCase();

  // ORDEM IMPORTA. As marcas específicas vêm primeiro; o casamento
  // genérico por "wireless controller" fica por último, porque é como o
  // Chrome costuma nomear um DualShock — mas ele também aparece dentro
  // de "Xbox Wireless Controller". Testando a Sony antes, todo controle
  // de Xbox sem fio era classificado como PlayStation e os rótulos dos
  // botões saíam trocados.
  if (s.includes('xbox') || s.includes('xinput') || /\b045e\b/.test(s)) {
    return 'xbox';
  }
  if (
    s.includes('nintendo') ||
    s.includes('switch') ||
    s.includes('joy-con') ||
    s.includes('pro controller') ||
    /\b057e\b/.test(s) // fabricante Nintendo
  ) {
    return 'nintendo';
  }
  if (
    s.includes('dualsense') ||
    s.includes('dualshock') ||
    s.includes('playstation') ||
    /\b054c\b/.test(s) || // fabricante Sony
    s.includes('wireless controller')
  ) {
    return 'playstation';
  }
  return 'generic';
}

export function familyLabel(f: PadFamily): string {
  switch (f) {
    case 'playstation':
      return 'PlayStation';
    case 'nintendo':
      return 'Nintendo';
    case 'xbox':
      return 'Xbox';
    case 'generic':
      // "genérico", e não "Controle": o texto já vem precedido da
      // palavra Controle, e devolvê-la de novo produzia "Controle
      // Controle" na tela.
      return 'genérico';
  }
}

/**
 * Nome dos botões por família.
 *
 * Os índices do "standard mapping" são iguais nos três; o que muda é o
 * NOME impresso. E na Nintendo A/B e X/Y ficam em posições trocadas em
 * relação ao Xbox: chamar o botão 0 de "A" num controle Nintendo
 * mandaria o jogador apertar o botão errado, porque lá o 0 é o B.
 */
const NOMES: Record<PadFamily, Record<number, string>> = {
  playstation: { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Share', 9: 'Options', 10: 'L3', 11: 'R3' },
  nintendo: { 0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+', 10: 'L3', 11: 'R3' },
  xbox: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'View', 9: 'Menu', 10: 'L3', 11: 'R3' },
  generic: { 0: 'B1', 1: 'B2', 2: 'B3', 3: 'B4', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Sel', 9: 'Start', 10: 'L3', 11: 'R3' },
};

export function buttonLabel(family: PadFamily, index: number): string {
  return NOMES[family][index] ?? `B${index}`;
}

/** Índices do "standard mapping" que o jogo usa. */
export const BTN = {
  sul: 0,
  leste: 1,
  oeste: 2,
  norte: 3,
  ombroEsq: 4,
  ombroDir: 5,
  gatilhoEsq: 6,
  gatilhoDir: 7,
  select: 8,
  start: 9,
  analogEsq: 10,
  analogDir: 11,
  dpadCima: 12,
  dpadBaixo: 13,
  dpadEsq: 14,
  dpadDir: 15,
} as const;

/**
 * Zona morta, como fração do curso.
 *
 * Alavancas analógicas não voltam exatamente ao centro — um controle
 * usado marca 0.05 parado. Sem zona morta, a nave gira sozinha e o
 * jogador acha que o jogo está com deriva.
 */
export const DEADZONE = 0.12;

/**
 * Aplica zona morta RADIAL a um par de eixos.
 *
 * Radial, e não por eixo: cortar X e Y separadamente cria uma cruz morta
 * no centro, e a diagonal fica com um degrau — o clássico "a mira trava
 * nos eixos". Tratando o par como vetor, a zona morta é um círculo e o
 * movimento é liso em qualquer direção.
 *
 * Depois do corte, o resto é reescalado para 0..1: sem isso, o menor
 * movimento útil já sairia com a intensidade da zona morta, dando um
 * salto no início do curso.
 */
export function applyDeadzone(x: number, y: number, deadzone = DEADZONE): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return [0, 0];
  if (mag < 1e-6) return [0, 0];
  const escala = Math.min(1, (mag - deadzone) / (1 - deadzone)) / mag;
  return [x * escala, y * escala];
}

/**
 * Curva de resposta.
 *
 * Expoente 1.6: perto do centro a saída cresce mais devagar que a
 * entrada, o que dá resolução fina onde as correções acontecem; no fim
 * do curso a saída chega a 1 e a nave vira tão rápido quanto antes.
 *
 * Uma curva linear gasta metade do curso da alavanca em rotações
 * grandes demais para mirar; uma curva agressiva demais (expoente 3)
 * deixa a nave lenta e o jogador achando que ela não responde.
 */
export function responseCurve(v: number, expoente = 1.6): number {
  const m = Math.min(1, Math.abs(v));
  const r = Math.sign(v) * Math.pow(m, expoente);
  // `+ 0` normaliza o -0 que nasce de `Math.sign(-0)`. Não é preciosismo:
  // -0 compara diferente de 0 em `Object.is` e vaza para o protocolo,
  // onde vira um byte diferente à toa.
  return r + 0;
}

/** Eixos e gatilhos lidos de um controle. */
export interface PadAxes {
  /** -1..1 — guinada. */
  steer: number;
  /** -1..1 — arfagem. */
  pitch: number;
  /** -1..1 — rolagem. */
  roll: number;
  /** 0..1 — aceleração (gatilho analógico). */
  thrust: number;
  /** 0..1 — quanto o gatilho de precisão está pressionado. */
  fine: number;
}

/** Forma mínima de `Gamepad` que interessa aqui — facilita testar. */
export interface PadLike {
  index: number;
  id: string;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
}

function eixo(p: PadLike, i: number): number {
  return p.axes[i] ?? 0;
}
function botao(p: PadLike, i: number): { pressed: boolean; value: number } {
  return p.buttons[i] ?? { pressed: false, value: 0 };
}

/**
 * Lê os eixos de voo.
 *
 * Alavanca esquerda pilota (guinada e arfagem), a direita rola, e o
 * gatilho direito acelera. O gatilho é ANALÓGICO: dá para cruzar um
 * campo de asteroides a um terço da potência, o que o teclado nunca
 * permitiu.
 */
export function readAxes(p: PadLike, invertPitch = false): PadAxes {
  const [lx, ly] = applyDeadzone(eixo(p, 0), eixo(p, 1));
  const [rx] = applyDeadzone(eixo(p, 2), eixo(p, 3));

  // O eixo Y do controle cresce para BAIXO; arfagem positiva é o nariz
  // para CIMA. Sem a inversão, empurrar a alavanca para frente levanta
  // o nariz — o oposto de qualquer manche.
  const pitchBruto = invertPitch ? ly : -ly;

  const gatilhoDir = botao(p, BTN.gatilhoDir);
  const gatilhoEsq = botao(p, BTN.gatilhoEsq);

  return {
    steer: responseCurve(lx),
    pitch: responseCurve(pitchBruto),
    roll: responseCurve(rx),
    // Gatilhos digitais (alguns controles antigos) marcam value 0 e
    // pressed true; o `|| pressed ? 1 : 0` cobre os dois casos.
    thrust: gatilhoDir.value > 0 ? gatilhoDir.value : gatilhoDir.pressed ? 1 : 0,
    fine: gatilhoEsq.value > 0 ? gatilhoEsq.value : gatilhoEsq.pressed ? 1 : 0,
  };
}

/** Ações de combate lidas dos botões, já como edge-triggers. */
export interface PadButtons {
  fire: boolean;
  fireHeld: boolean;
  defend: boolean;
  skill: 'Dash' | 'Emp' | 'Repair' | null;
  useConsumable: number | null;
  launchTorpedo: boolean;
  deployDecoys: boolean;
  cycleTarget: boolean;
  toHangar: boolean;
  toggleGravityLines: boolean;
}

/**
 * Acima disto o gatilho de precisão conta como acionado.
 *
 * Não é 0: um gatilho analógico raramente marca zero exato, e um limiar
 * nulo deixaria o modo de precisão sempre ligado.
 */
export const LIMIAR_GATILHO = 0.35;

/**
 * Estado anterior dos botões, para detectar a borda de subida.
 *
 * Sem isto, segurar um botão dispararia a habilidade a 60 vezes por
 * segundo — e gastaria o cinto inteiro de consumíveis num toque.
 */
export type PadPrevState = Set<number>;

export function readButtons(p: PadLike, anterior: PadPrevState): PadButtons {
  const agora = new Set<number>();
  for (let i = 0; i < p.buttons.length; i++) {
    if (botao(p, i).pressed) agora.add(i);
  }
  // Cópia do estado do quadro ANTERIOR antes de sobrescrevê-lo.
  //
  // As funções abaixo fecham sobre `anterior`; atualizá-lo antes de
  // chamá-las fazia `subiu` comparar o quadro atual consigo mesmo e
  // devolver sempre `false` — nenhum botão do controle funcionava.
  const antes = new Set(anterior);
  const subiu = (i: number): boolean => agora.has(i) && !antes.has(i);
  const desceu = (i: number): boolean => !agora.has(i) && antes.has(i);

  // Substitui o conteúdo do conjunto no lugar: o chamador guarda a
  // referência entre quadros.
  anterior.clear();
  for (const i of agora) anterior.add(i);

  let skill: PadButtons['skill'] = null;
  if (subiu(BTN.sul)) skill = 'Dash';
  else if (subiu(BTN.leste)) skill = 'Emp';
  else if (subiu(BTN.oeste)) skill = 'Repair';

  let useConsumable: number | null = null;
  if (subiu(BTN.dpadEsq)) useConsumable = 0;
  else if (subiu(BTN.dpadDir)) useConsumable = 1;

  return {
    // O tiro sai ao SOLTAR, igual ao teclado: segurar acumula carga.
    fire: desceu(BTN.ombroDir),
    fireHeld: agora.has(BTN.ombroDir),
    defend: subiu(BTN.ombroEsq),
    skill,
    useConsumable,
    launchTorpedo: subiu(BTN.norte),
    deployDecoys: subiu(BTN.dpadBaixo),
    cycleTarget: subiu(BTN.analogDir),
    toHangar: subiu(BTN.start),
    toggleGravityLines: subiu(BTN.select),
  };
}

/** Descrição dos comandos, para a tela de controles. */
export function padBindings(family: PadFamily): Array<{ acao: string; botao: string }> {
  const b = (i: number): string => buttonLabel(family, i);
  return [
    { acao: 'Pilotar (guinada/arfagem)', botao: 'Alavanca esquerda' },
    { acao: 'Rolar', botao: 'Alavanca direita' },
    { acao: 'Acelerar', botao: b(BTN.gatilhoDir) },
    { acao: 'Mira fina', botao: b(BTN.gatilhoEsq) },
    { acao: 'Atirar (segurar carrega)', botao: b(BTN.ombroDir) },
    { acao: 'Defesa', botao: b(BTN.ombroEsq) },
    { acao: 'Impulso', botao: b(BTN.sul) },
    { acao: 'PEM', botao: b(BTN.leste) },
    { acao: 'Reparo', botao: b(BTN.oeste) },
    { acao: 'Torpedo', botao: b(BTN.norte) },
    { acao: 'Consumíveis', botao: 'Direcional ←/→' },
    { acao: 'Iscas', botao: 'Direcional ↓' },
    { acao: 'Trocar alvo', botao: b(BTN.analogDir) },
    { acao: 'Hangar', botao: b(BTN.start) },
    { acao: 'Linhas de gravidade', botao: b(BTN.select) },
  ];
}
