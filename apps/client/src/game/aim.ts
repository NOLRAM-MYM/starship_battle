/**
 * Solução de mira do cliente.
 *
 * Espelho de `crates/sim-core/src/ship/aim.rs`, com fixture dourada
 * gerada pelo próprio servidor amarrando os dois — mesma técnica usada
 * para o catálogo de armas e para os efeitos de skill, pelo mesmo
 * motivo: uma divergência aqui não quebra nada, só faz o retículo
 * apontar para o lugar errado, em silêncio.
 *
 * O que isto resolve: acertar exigia adivinhar duas correções
 * simultâneas — onde o alvo estará quando o projétil chegar, e o quanto
 * a gravidade vai encurvar o tiro no caminho. Cada uma depende do tempo
 * de voo, que por sua vez depende das duas. Na prática ninguém acerta um
 * alvo cruzando a 60 u/s a 800 unidades de distância.
 */

export interface AimInput {
  shooterPos: [number, number, number];
  shooterVel: [number, number, number];
  targetPos: [number, number, number];
  targetVel: [number, number, number];
  /** Velocidade do projétil, relativa à nave. */
  projectileSpeed: number;
  /** Aceleração gravitacional média no trecho. */
  gravity: [number, number, number];
  /** Tempo de vida do projétil. */
  projectileTtl: number;
}

export interface AimSolution {
  leadPoint: [number, number, number];
  timeOfFlight: number;
  /** 0 = trivial, 1 = praticamente impossível. */
  difficulty: number;
  reachable: boolean;
}

export type AimBand = 'easy' | 'moderate' | 'hard' | 'extreme';

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));

/**
 * Passos de refino do tempo de voo.
 *
 * O problema é implícito: o tempo depende de onde o alvo estará, que
 * depende do tempo. Três passos convergem a menos de 1% nas velocidades
 * do jogo, e o custo importa porque isto roda a cada quadro.
 */
const REFINOS = 3;

/** Margem de acerto usada para normalizar os desvios, em unidades. */
const MARGEM = 12;

/**
 * Resolve a mira.
 *
 * Iteração de ponto fixo, e não a quadrática fechada, porque a gravidade
 * curva a trajetória: a forma fechada só vale para tiro retilíneo e
 * daria uma resposta plausível e errada justamente perto dos corpos
 * celestes, que é onde o jogador mais precisa dela.
 */
export function solveAim(input: AimInput): AimSolution {
  const relPos = sub(input.targetPos, input.shooterPos);
  // O projétil herda a velocidade da nave: o que importa é a velocidade
  // RELATIVA do alvo.
  const relVel = sub(input.targetVel, input.shooterVel);
  const distancia = len(relPos);

  if (input.projectileSpeed <= 0.001) {
    return {
      leadPoint: input.targetPos,
      timeOfFlight: 0,
      difficulty: 1,
      reachable: false,
    };
  }

  let t = distancia / input.projectileSpeed;
  let alvoFuturo: V3 = input.targetPos;
  for (let i = 0; i < REFINOS; i++) {
    alvoFuturo = add(input.targetPos, scale(relVel, t));
    // A gravidade desloca o PROJÉTIL: a mira sobe contra a queda.
    const queda = scale(input.gravity, 0.5 * t * t);
    const mira = sub(alvoFuturo, queda);
    t = len(sub(mira, input.shooterPos)) / input.projectileSpeed;
  }

  const queda = scale(input.gravity, 0.5 * t * t);
  const leadPoint = sub(alvoFuturo, queda);
  const reachable = t <= input.projectileTtl;

  return {
    leadPoint,
    timeOfFlight: t,
    difficulty: difficultyOf(input, relVel, distancia, t, reachable),
    reachable,
  };
}

/**
 * Mede quão difícil é o tiro.
 *
 * Três fatores, porque são três coisas diferentes que erram o tiro: a
 * antecipação (deslocamento lateral do alvo durante o voo), a curvatura
 * da gravidade, e a fração do alcance consumida. A velocidade RADIAL do
 * alvo quase não atrapalha — só a transversal —, e é isso que separa
 * uma medida útil de um número decorativo.
 */
function difficultyOf(
  input: AimInput,
  relVel: V3,
  distancia: number,
  t: number,
  reachable: boolean,
): number {
  if (!reachable) return 1;
  if (distancia < 0.001) return 0;

  const dir = scale(sub(input.targetPos, input.shooterPos), 1 / distancia);
  const radial = dot(relVel, dir);
  const transversal = len(sub(relVel, scale(dir, radial)));

  const desvioAlvo = transversal * t;
  const desvioGrav = 0.5 * len(input.gravity) * t * t;

  const fAlvo = Math.min(desvioAlvo / MARGEM, 1);
  const fGrav = Math.min(desvioGrav / MARGEM, 1);
  const fAlcance = Math.min(t / Math.max(input.projectileTtl, 0.001), 1);

  const bruto = 0.5 * fAlvo + 0.35 * fGrav + 0.15 * fAlcance;
  return Math.min(Math.max(bruto, 0), 1);
}

export function aimBand(difficulty: number, reachable: boolean): AimBand {
  if (!reachable) return 'extreme';
  if (difficulty < 0.25) return 'easy';
  if (difficulty < 0.55) return 'moderate';
  if (difficulty < 0.85) return 'hard';
  return 'extreme';
}

/** Rótulo curto para o HUD. */
export function aimBandLabel(band: AimBand): string {
  switch (band) {
    case 'easy':
      return 'TIRO CERTO';
    case 'moderate':
      return 'ANTECIPE';
    case 'hard':
      return 'DIFÍCIL';
    case 'extreme':
      return 'SEM SOLUÇÃO';
  }
}

/**
 * Cor do retículo por faixa.
 *
 * A faixa também muda o TAMANHO do retículo na interface, porque cor
 * sozinha não serve para quem enxerga cores de forma diferente — a mesma
 * regra usada nos projéteis e nas animações de habilidade.
 */
export function aimBandColor(band: AimBand): string {
  switch (band) {
    case 'easy':
      return '#45e5a4';
    case 'moderate':
      return '#ffd166';
    case 'hard':
      return '#ff8a3c';
    case 'extreme':
      return '#ff5f6d';
  }
}
