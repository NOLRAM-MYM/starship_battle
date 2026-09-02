/**
 * Agregação de atributos da nave — a ponte entre o shipyard e o combate.
 *
 * O builder antigo só somava massa e contava motores; o painel de status
 * não dizia nada sobre como a nave se comportaria. Aqui derivamos os
 * atributos derivados de verdade (aceleração, DPS, tempo-para-matar) a
 * partir de componentes + classe do piloto, para que o jogador consiga
 * comparar duas builds antes de sair do hangar.
 *
 * Módulo puro e testado: nada de DOM.
 */

import { componentById, type UiComponentTemplate } from '../ui/componentLibrary';
import { pilotClassById, type PilotClass } from '../data/pilots';

/** Massa do casco vazio, antes de qualquer componente. */
export const BASE_HULL_MASS = 1000;
/** Integridade de casco base — nave sem nenhum componente. */
export const BASE_HULL_HP = 800;

export interface AggregateStats {
  mass: number;
  thrust: number;
  /** thrust / mass * 1000 — aceleração comparável entre builds. */
  acceleration: number;
  damage: number;
  fireRate: number;
  /** damage * fireRate. */
  dps: number;
  shield: number;
  shieldRegen: number;
  hull: number;
  /** hull + shield: quanto dano a nave absorve antes de explodir. */
  effectiveHp: number;
  sensorRange: number;
  cargo: number;
  /** 0..0.9 — fração de redução da assinatura. */
  stealth: number;
  /** Soma dos custos dos componentes instalados. */
  cost: number;
}

/** Loadout como o resto do app o representa: slot -> template. */
export interface LoadoutEntry {
  slotId: number;
  templateId: string;
  tier: number;
}

const EMPTY: AggregateStats = {
  mass: BASE_HULL_MASS,
  thrust: 0,
  acceleration: 0,
  damage: 0,
  fireRate: 0,
  dps: 0,
  shield: 0,
  shieldRegen: 0,
  hull: BASE_HULL_HP,
  effectiveHp: BASE_HULL_HP,
  sensorRange: 0,
  cargo: 0,
  stealth: 0,
  cost: 0,
};

/**
 * Soma os componentes e aplica os modificadores do piloto.
 * `pilot` ausente = nenhum modificador (nave "de estaleiro").
 */
export function aggregateStats(
  components: readonly UiComponentTemplate[],
  pilot?: PilotClass | null,
): AggregateStats {
  const out: AggregateStats = { ...EMPTY };

  for (const c of components) {
    out.mass += c.mass;
    out.cost += c.cost;
    const s = c.stats;
    out.thrust += s.thrust ?? 0;
    out.damage += s.damage ?? 0;
    out.fireRate += s.fireRate ?? 0;
    out.shield += s.shield ?? 0;
    out.shieldRegen += s.shieldRegen ?? 0;
    out.hull += s.hull ?? 0;
    out.sensorRange += s.sensorRange ?? 0;
    out.cargo += s.cargo ?? 0;
    out.stealth += s.stealth ?? 0;
  }

  if (pilot) {
    const m = pilot.modifiers;
    out.thrust *= m.thrust ?? 1;
    out.damage *= m.damage ?? 1;
    out.fireRate *= m.fireRate ?? 1;
    out.shield *= m.shield ?? 1;
    out.shieldRegen *= m.shieldRegen ?? 1;
    out.hull *= m.hull ?? 1;
    out.sensorRange *= m.sensorRange ?? 1;
    out.cargo *= m.cargo ?? 1;
    out.stealth += m.stealthBonus ?? 0;
  }

  // Derivados — calculados depois dos modificadores.
  out.shield = Math.max(0, out.shield);
  out.hull = Math.max(1, out.hull);
  out.stealth = clamp(out.stealth, 0, 0.9);
  out.acceleration = (out.thrust / out.mass) * 1000;
  out.dps = out.damage * out.fireRate;
  out.effectiveHp = out.hull + out.shield;

  return round(out);
}

/** Resolve ids de um loadout salvo e agrega. Ids desconhecidos são ignorados. */
export function statsForLoadout(
  loadout: readonly LoadoutEntry[],
  pilotClassId?: string | null,
): AggregateStats {
  const comps: UiComponentTemplate[] = [];
  for (const entry of loadout) {
    const c = componentById(entry.templateId);
    if (c) comps.push(c);
  }
  return aggregateStats(comps, pilotClassId ? pilotClassById(pilotClassId) : null);
}

/**
 * Diferença entre duas agregações — alimenta a prévia "+12 DPS / -0.4 acel"
 * ao passar o mouse sobre um componente no shipyard.
 */
export function statsDelta(before: AggregateStats, after: AggregateStats): Partial<AggregateStats> {
  const delta: Record<string, number> = {};
  for (const key of Object.keys(before) as Array<keyof AggregateStats>) {
    const d = after[key] - before[key];
    if (Math.abs(d) > 0.01) delta[key] = round1(d);
  }
  return delta as Partial<AggregateStats>;
}

/**
 * Nota de 0 a 100 por eixo, para o gráfico radar do hangar.
 * Os divisores são os tetos práticos do catálogo atual.
 */
export function statRating(stats: AggregateStats): Record<'agilidade' | 'poder' | 'defesa' | 'alcance' | 'suporte', number> {
  return {
    agilidade: pct(stats.acceleration, 260),
    poder: pct(stats.dps, 320),
    defesa: pct(stats.effectiveHp, 2200),
    alcance: pct(stats.sensorRange, 3000),
    suporte: pct(stats.cargo + stats.shieldRegen * 6, 400),
  };
}

function pct(v: number, max: number): number {
  return clamp(Math.round((v / max) * 100), 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round(s: AggregateStats): AggregateStats {
  return {
    mass: Math.round(s.mass),
    thrust: Math.round(s.thrust),
    acceleration: round1(s.acceleration),
    damage: Math.round(s.damage),
    fireRate: round1(s.fireRate),
    dps: Math.round(s.dps),
    shield: Math.round(s.shield),
    shieldRegen: round1(s.shieldRegen),
    hull: Math.round(s.hull),
    effectiveHp: Math.round(s.effectiveHp),
    sensorRange: Math.round(s.sensorRange),
    cargo: Math.round(s.cargo),
    stealth: round1(s.stealth),
    cost: Math.round(s.cost),
  };
}
