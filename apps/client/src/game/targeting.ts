/**
 * Seleção de alvo — o HUD tinha um campo `targetName` que nunca saía de "—".
 *
 * A escolha combina distância e alinhamento com o nariz da nave: um
 * inimigo bem à frente ganha de um mais próximo porém às costas. Isso faz
 * o Tab/alvo automático escolher o que o jogador *está olhando*, que é o
 * que ele espera.
 *
 * Módulo puro (só números) para poder ser testado sem three.js nem DOM.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Contact {
  id: number;
  name: string | null;
  pos: Vec3;
  /** 'hostile' entra na mira automática; 'neutral'/'ally' não. */
  faction: 'hostile' | 'neutral' | 'ally';
  /**
   * O que o contato é.
   *
   * Um torpedo a caminho mata em segundos; uma nave a mesma distância
   * não. Sem distinguir os dois, a escolha automática mandaria o jogador
   * atirar na nave enquanto o torpedo chega.
   */
  kind?: 'ship' | 'torpedo';
  hpRatio: number | null;
}

export interface TargetCandidate {
  contact: Contact;
  distance: number;
  /** -1 (atrás) .. 1 (exatamente à frente). */
  alignment: number;
  score: number;
}

export interface TargetingOptions {
  /** Contatos além disso são ignorados. */
  maxRange?: number;
  /** Alinhamento mínimo; 0 = hemisfério frontal, -1 = 360°. */
  minAlignment?: number;
  /** Peso do alinhamento contra a distância (0..1). */
  alignmentWeight?: number;
  /**
   * Alcance efetivo da arma primária, em unidades.
   *
   * Contatos além disso continuam sendo alvos válidos — dá para querer
   * acompanhar um inimigo que se afasta —, mas perdem prioridade. Sem
   * isto o travamento automático escolhia rotineiramente alguém fora do
   * alcance de tiro: o alvo aparecia no painel e a mira respondia "SEM
   * SOLUÇÃO", porque o raio de travamento (1200) é mais que o dobro do
   * alcance de um canhão linear (~494).
   */
  weaponRange?: number;
}

/**
 * Penalidade de pontuação para alvos fora do alcance da arma.
 *
 * Penalidade, e não exclusão: um inimigo fugindo continua sendo o alvo
 * que interessa, e removê-lo da lista faria o Tab pular justamente quem
 * o jogador está perseguindo.
 */
const PENALIDADE_FORA_DE_ALCANCE = 0.45;

/**
 * Ganho MÁXIMO de prioridade de um torpedo, quando ele está em cima.
 *
 * Abater o torpedo é uma das quatro defesas, e a que exige o tiro mais
 * difícil do jogo: um objeto pequeno, rápido e em curva. Se ele não
 * subisse na ordem, o jogador teria de encontrá-lo manualmente entre os
 * contatos justamente nos segundos em que não há tempo para isso.
 */
const GANHO_TORPEDO = 1.6;

/**
 * Distância a partir da qual um torpedo deixa de ser urgente.
 *
 * A ameaça de um torpedo é o TEMPO ATÉ O IMPACTO, não a sua mera
 * existência: a ~105 u/s, 400 unidades são uns quatro segundos. Com um
 * ganho fixo, um torpedo a 1000 unidades — dez segundos de distância —
 * ganhava de uma nave colada, e o jogador era mandado atirar longe
 * enquanto levava tiro de perto.
 */
const ALCANCE_URGENTE_TORPEDO = 400;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Ordena os candidatos hostis do melhor para o pior alvo.
 * `forward` deve ser unitário e apontar para o nariz da nave.
 */
export function rankTargets(
  origin: Vec3,
  forward: Vec3,
  contacts: readonly Contact[],
  opts: TargetingOptions = {},
): TargetCandidate[] {
  const maxRange = opts.maxRange ?? 1200;
  const minAlignment = opts.minAlignment ?? -0.2;
  const w = opts.alignmentWeight ?? 0.6;

  const out: TargetCandidate[] = [];
  for (const c of contacts) {
    if (c.faction !== 'hostile') continue;
    const rel = sub(c.pos, origin);
    const distance = length(rel);
    if (distance > maxRange || distance <= 0) continue;

    const alignment = dot(
      { x: rel.x / distance, y: rel.y / distance, z: rel.z / distance },
      forward,
    );
    if (alignment < minAlignment) continue;

    // Proximidade e alinhamento normalizados em 0..1, depois combinados.
    const proximity = 1 - distance / maxRange;
    const facing = (alignment + 1) / 2;
    let score = proximity * (1 - w) + facing * w;
    // Fora do alcance da arma, o alvo cai na ordem: continua travável,
    // mas deixa de ser a escolha automática quando há alguém em quem os
    // tiros de fato chegam.
    if (opts.weaponRange !== undefined && distance > opts.weaponRange) {
      score *= 1 - PENALIDADE_FORA_DE_ALCANCE;
    }
    if (c.kind === 'torpedo') {
      const urgencia = Math.max(0, 1 - distance / ALCANCE_URGENTE_TORPEDO);
      score *= 1 + (GANHO_TORPEDO - 1) * urgencia;
    }

    out.push({ contact: c, distance, alignment, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Melhor alvo, ou null se nada qualifica. */
export function pickTarget(
  origin: Vec3,
  forward: Vec3,
  contacts: readonly Contact[],
  opts?: TargetingOptions,
): Contact | null {
  return rankTargets(origin, forward, contacts, opts)[0]?.contact ?? null;
}

/**
 * Próximo alvo do ciclo (tecla Tab). Volta ao primeiro no fim da lista
 * e cai no melhor alvo se o atual saiu de alcance.
 */
export function cycleTarget(
  currentId: number | null,
  origin: Vec3,
  forward: Vec3,
  contacts: readonly Contact[],
  opts?: TargetingOptions,
): Contact | null {
  const ranked = rankTargets(origin, forward, contacts, opts);
  if (ranked.length === 0) return null;
  if (currentId === null) return ranked[0]?.contact ?? null;

  const idx = ranked.findIndex((r) => r.contact.id === currentId);
  if (idx === -1) return ranked[0]?.contact ?? null;
  return ranked[(idx + 1) % ranked.length]?.contact ?? null;
}

/**
 * Projeta um contato para coordenadas de radar 2D (-1..1) no plano XZ,
 * já rodado para o referencial da nave: +Y da tela = frente.
 */
export function toRadarSpace(
  origin: Vec3,
  headingRadians: number,
  contact: Vec3,
  range: number,
): { x: number; y: number; clamped: boolean } {
  const dx = contact.x - origin.x;
  const dz = contact.z - origin.z;
  const cos = Math.cos(-headingRadians);
  const sin = Math.sin(-headingRadians);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;

  let nx = rx / range;
  let ny = -rz / range; // -Z do mundo é a frente -> +Y do radar
  const mag = Math.hypot(nx, ny);
  const clamped = mag > 1;
  if (clamped && mag > 0) {
    nx /= mag;
    ny /= mag;
  }
  return { x: nx, y: ny, clamped };
}
