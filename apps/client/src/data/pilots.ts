/**
 * Pilotos — a camada de "personagem" do jogo.
 *
 * Antes o jogador era só um nome numa barra de HP. Uma classe de piloto
 * dá identidade (avatar, lema, especialização) e, mais importante, um
 * viés mecânico: cada classe multiplica atributos diferentes, então a
 * mesma nave joga diferente conforme quem a pilota.
 *
 * Módulo puro: sem DOM, sem rede. O avatar é gerado deterministicamente
 * a partir do callsign, então o mesmo piloto tem sempre a mesma cara.
 */

export type PilotClassId = 'ace' | 'juggernaut' | 'ghost' | 'prospector';

/** Multiplicadores aplicados sobre os atributos agregados da nave. */
export interface PilotModifiers {
  thrust?: number;
  damage?: number;
  fireRate?: number;
  shield?: number;
  shieldRegen?: number;
  hull?: number;
  sensorRange?: number;
  cargo?: number;
  /** Aditivo, não multiplicativo (stealth já é 0..1). */
  stealthBonus?: number;
}

export interface PilotClass {
  id: PilotClassId;
  name: string;
  role: string;
  motto: string;
  /** Cor de destaque usada no card e no casco da nave. */
  accent: number;
  modifiers: PilotModifiers;
  /** Texto curto explicando o trade-off — mostrado na seleção. */
  tradeoff: string;
}

export const PILOT_CLASSES: PilotClass[] = [
  {
    id: 'ace',
    name: 'Ás',
    role: 'Caça / Duelo',
    motto: 'Chego antes de você decidir.',
    accent: 0x4ec9ff,
    modifiers: { thrust: 1.18, fireRate: 1.15, hull: 0.9, shield: 0.92 },
    tradeoff: 'Mais empuxo e cadência; casco e escudo mais frágeis.',
  },
  {
    id: 'juggernaut',
    name: 'Colosso',
    role: 'Linha de frente',
    motto: 'Passe por cima. Se conseguir.',
    accent: 0xffb347,
    modifiers: { hull: 1.3, shield: 1.22, damage: 1.08, thrust: 0.85 },
    tradeoff: 'Muito mais resistência e dano; bem mais lento.',
  },
  {
    id: 'ghost',
    name: 'Espectro',
    role: 'Emboscada',
    motto: 'Você só me vê no relatório.',
    accent: 0xb06bff,
    modifiers: { damage: 1.28, sensorRange: 1.25, shield: 0.8, hull: 0.88, stealthBonus: 0.15 },
    tradeoff: 'Alfa-strike e detecção superiores; muito pouco a absorver.',
  },
  {
    id: 'prospector',
    name: 'Prospector',
    role: 'Economia / Suporte',
    motto: 'A guerra acaba. O minério, não.',
    accent: 0x45e5a4,
    modifiers: { cargo: 1.6, shieldRegen: 1.35, sensorRange: 1.15, damage: 0.82 },
    tradeoff: 'Carga e sustentação muito melhores; dano bem menor.',
  },
];

const BY_ID = new Map(PILOT_CLASSES.map((p) => [p.id, p]));

export function pilotClassById(id: string): PilotClass | undefined {
  return BY_ID.get(id as PilotClassId);
}

/** Classe padrão para uma conta nova. */
export const DEFAULT_PILOT_CLASS: PilotClassId = 'ace';

export interface PilotProfile {
  callsign: string;
  classId: PilotClassId;
  /** Nível vindo da progressão (Fase 7). */
  level: number;
}

/**
 * Hash determinístico (FNV-1a 32 bits) — mesma função usada no
 * worldgen do servidor, para que avatares sejam estáveis entre sessões.
 */
export function hashCallsign(callsign: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < callsign.length; i++) {
    h ^= callsign.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface AvatarTraits {
  /** Matiz do visor, 0..359. */
  hue: number;
  /** Índice do formato de capacete (0..3). */
  helmet: number;
  /** Índice da marcação/insígnia (0..5). */
  insignia: number;
  /** Iniciais mostradas quando o SVG não cabe. */
  initials: string;
}

/** Deriva traços visuais estáveis a partir do callsign. */
export function avatarTraitsFor(callsign: string): AvatarTraits {
  const h = hashCallsign(callsign || 'pilot');
  const initials = (callsign || 'PL')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase()
    .padEnd(2, 'X');
  return {
    hue: h % 360,
    helmet: (h >>> 9) % 4,
    insignia: (h >>> 17) % 6,
    initials,
  };
}
