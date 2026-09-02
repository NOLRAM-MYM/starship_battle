/**
 * Interpolação de snapshots.
 *
 * O servidor manda estado a ~15Hz e o cliente desenha a 60fps. Sem
 * interpolação, cada posição recebida era ESCRITA direto e repetida por
 * ~4 quadros seguidos: a nave andava aos saltos, e o mesmo valia para a
 * queda sob gravidade — que é justamente o movimento mais contínuo do
 * jogo.
 *
 * A solução padrão é renderizar um pouco ATRÁS do presente e interpolar
 * entre os dois snapshots que cercam esse instante. O custo é uma
 * latência visual de ~100ms; o ganho é movimento contínuo.
 *
 * Módulo puro: sem three.js, sem ECS, sem DOM.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Sample {
  /** Instante de chegada, em ms (`performance.now`). */
  t: number;
  pos: Vec3;
  quat: Quat;
}

/** Histórico de uma entidade. O mais antigo primeiro. */
export type History = Sample[];

/**
 * Quantos snapshots guardar por entidade.
 *
 * A 15Hz, 8 amostras são ~530ms de histórico — folga suficiente para
 * absorver um engasgo de rede sem virar consumo de memória.
 */
export const MAX_SAMPLES = 8;

/** Extrapolação máxima além do último snapshot, em ms. */
export const MAX_EXTRAPOLATION_MS = 150;

/**
 * Acrescenta uma amostra, descartando as antigas.
 *
 * Amostras fora de ordem (chegada tardia) são ignoradas: reinseri-las no
 * meio faria a entidade andar para trás.
 */
export function pushSample(history: History, sample: Sample): void {
  const ultimo = history[history.length - 1];
  if (ultimo && sample.t <= ultimo.t) return;
  history.push(sample);
  if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES);
}

/**
 * Intervalo médio entre as amostras, em ms.
 *
 * Medido em vez de assumido: o tick do servidor oscila (no Windows a
 * granularidade do timer chega a atrasar ~30%), então um intervalo fixo
 * geraria micro-travadas justamente quando o servidor atrasa.
 */
export function averageInterval(history: History, fallback = 66): number {
  if (history.length < 2) return fallback;
  let soma = 0;
  for (let i = 1; i < history.length; i++) {
    soma += history[i]!.t - history[i - 1]!.t;
  }
  return soma / (history.length - 1);
}

/** Interpolação linear de vetores. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Interpolação de quaternions (nlerp com correção de sinal).
 *
 * A correção importa: `q` e `-q` representam a MESMA orientação, e sem
 * escolher o sinal mais próximo a nave daria uma cambalhota ao cruzar
 * essa fronteira. Nlerp em vez de slerp porque entre dois snapshots o
 * ângulo é pequeno e a diferença não é perceptível.
 */
export function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  const dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const x = a[0] + (bx - a[0]) * t;
  const y = a[1] + (by - a[1]) * t;
  const z = a[2] + (bz - a[2]) * t;
  const w = a[3] + (bw - a[3]) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

export interface Interpolated {
  pos: Vec3;
  quat: Quat;
  /** true quando o valor veio de extrapolação (sem dado novo). */
  extrapolated: boolean;
}

/**
 * Estado da entidade no instante `renderTime`.
 *
 * - Antes do histórico: devolve a amostra mais antiga (a entidade acabou
 *   de aparecer, não há de onde interpolar).
 * - Dentro do histórico: interpola entre as duas amostras que o cercam.
 * - Depois do histórico: extrapola com a última velocidade conhecida,
 *   limitado a `MAX_EXTRAPOLATION_MS`. Sem esse limite, uma entidade que
 *   parou de receber dados sairia voando pela tela.
 */
export function sampleAt(history: History, renderTime: number): Interpolated | null {
  if (history.length === 0) return null;

  const primeiro = history[0]!;
  if (history.length === 1 || renderTime <= primeiro.t) {
    return { pos: [...primeiro.pos], quat: [...primeiro.quat], extrapolated: false };
  }

  const ultimo = history[history.length - 1]!;
  if (renderTime >= ultimo.t) {
    const anterior = history[history.length - 2]!;
    const dt = ultimo.t - anterior.t;
    const alem = Math.min(renderTime - ultimo.t, MAX_EXTRAPOLATION_MS);
    if (dt <= 0 || alem <= 0) {
      return { pos: [...ultimo.pos], quat: [...ultimo.quat], extrapolated: false };
    }
    // Velocidade estimada pelas duas últimas amostras.
    const k = alem / dt;
    return {
      pos: [
        ultimo.pos[0] + (ultimo.pos[0] - anterior.pos[0]) * k,
        ultimo.pos[1] + (ultimo.pos[1] - anterior.pos[1]) * k,
        ultimo.pos[2] + (ultimo.pos[2] - anterior.pos[2]) * k,
      ],
      // A orientação NÃO é extrapolada: girar sem dado novo produz
      // rotação falsa muito mais visível que uma posição levemente
      // adiantada.
      quat: [...ultimo.quat],
      extrapolated: true,
    };
  }

  // Acha o par que cerca `renderTime`.
  for (let i = history.length - 1; i > 0; i--) {
    const b = history[i]!;
    const a = history[i - 1]!;
    if (renderTime >= a.t && renderTime <= b.t) {
      const span = b.t - a.t;
      const t = span > 0 ? (renderTime - a.t) / span : 0;
      return {
        pos: lerpVec3(a.pos, b.pos, t),
        quat: nlerpQuat(a.quat, b.quat, t),
        extrapolated: false,
      };
    }
  }

  return { pos: [...ultimo.pos], quat: [...ultimo.quat], extrapolated: false };
}

/**
 * Estado no instante `t` usando a VELOCIDADE autoritativa do servidor.
 *
 * Usado só para a nave do próprio jogador. As demais entidades são
 * desenhadas ~100ms atrás do presente (interpolação), o que é invisível
 * para quem observa mas vira atraso de input quando é a SUA nave: você
 * aperta a tecla e vê a reação um décimo de segundo depois.
 *
 * Aqui projetamos a partir do último snapshot com a velocidade que o
 * servidor informou — bem mais preciso que estimar pela diferença entre
 * duas amostras, porque a velocidade já vem medida.
 *
 * A projeção é limitada: se o servidor parar de responder, a nave
 * congela em vez de sair voando por conta própria.
 */
export function extrapolateWithVelocity(
  history: History,
  vel: Vec3,
  t: number,
): Interpolated | null {
  if (history.length === 0) return null;
  const ultimo = history[history.length - 1]!;

  const alem = t - ultimo.t;
  if (alem <= 0) return sampleAt(history, t);

  const s = Math.min(alem, MAX_EXTRAPOLATION_MS) / 1000;
  return {
    pos: [
      ultimo.pos[0] + vel[0] * s,
      ultimo.pos[1] + vel[1] * s,
      ultimo.pos[2] + vel[2] * s,
    ],
    // Orientação nunca é projetada: rotação inventada é muito mais
    // perceptível que posição levemente adiantada.
    quat: [...ultimo.quat],
    extrapolated: true,
  };
}

/**
 * Atraso de renderização recomendado, em ms.
 *
 * Um pouco mais que um intervalo de snapshot: assim quase sempre há duas
 * amostras cercando o instante desenhado, mesmo com jitter de rede. Menos
 * que isso e o cliente fica extrapolando (movimento errado); muito mais e
 * o jogo parece atrasado.
 */
export function renderDelay(history: History): number {
  const media = averageInterval(history);
  // 1.15x o intervalo: o suficiente para quase sempre haver duas
  // amostras cercando o instante desenhado, sem o atraso extra do 1.6x
  // anterior, que era perceptível como lentidão geral.
  return Math.min(140, Math.max(30, media * 1.15));
}
