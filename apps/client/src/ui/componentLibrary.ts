export type SlotKindName = 'Engine' | 'Weapon' | 'Shield' | 'Sensor' | 'Cargo' | 'Stealth';

/** Tier funciona como raridade: 1 comum -> 5 lendário. */
export type Tier = 1 | 2 | 3 | 4 | 5;

/**
 * Contribuição de um componente para os atributos da nave.
 * Todos os campos são aditivos e opcionais — ausente = 0.
 */
export interface ComponentStats {
  /** Empuxo bruto (kN). Divide pela massa -> aceleração. */
  thrust?: number;
  /** Dano por salva. */
  damage?: number;
  /** Cadência de tiro (tiros/s). */
  fireRate?: number;
  /** Capacidade de escudo. */
  shield?: number;
  /** Regeneração de escudo por segundo. */
  shieldRegen?: number;
  /** Integridade de casco. */
  hull?: number;
  /** Alcance de detecção (unidades). */
  sensorRange?: number;
  /** Capacidade de carga. */
  cargo?: number;
  /** Redução da assinatura de radar (0..1). */
  stealth?: number;
}

export interface UiComponentTemplate {
  id: string;
  name: string;
  kind: SlotKindName;
  tier: Tier;
  /** Massa em toneladas — penaliza aceleração e agilidade. */
  mass: number;
  /** Custo em créditos (usado pela economia da Fase 4). */
  cost: number;
  /** Descrição curta exibida no tooltip do shipyard. */
  blurb: string;
  stats: ComponentStats;
}

/**
 * Catálogo do shipyard. Cada família tem uma linha de tiers para que a
 * escolha seja um trade-off (massa/custo vs. potência), não um upgrade óbvio.
 */
export const COMPONENT_LIBRARY: UiComponentTemplate[] = [
  // ---------- Motores ----------
  {
    id: 'engine_mk1', name: 'Motor MK-I', kind: 'Engine', tier: 1, mass: 10, cost: 250,
    blurb: 'Propulsor de série. Leve, confiável, sem surpresas.',
    stats: { thrust: 60 },
  },
  {
    id: 'engine_mk3', name: 'Motor MK-III', kind: 'Engine', tier: 3, mass: 25, cost: 1400,
    blurb: 'Empuxo alto ao custo de massa. Pede casco reforçado.',
    stats: { thrust: 145 },
  },
  {
    id: 'engine_ion', name: 'Propulsor Iônico', kind: 'Engine', tier: 4, mass: 16, cost: 3200,
    blurb: 'Empuxo forte e leve — cara, mas transforma a agilidade.',
    stats: { thrust: 170, stealth: 0.05 },
  },
  {
    id: 'engine_void', name: 'Núcleo do Vazio', kind: 'Engine', tier: 5, mass: 34, cost: 8600,
    blurb: 'Protótipo instável. Empuxo absurdo, assinatura enorme.',
    stats: { thrust: 260, stealth: -0.12 },
  },

  // ---------- Torpedos ----------
  // Ocupam slot de arma, mas têm tecla própria (R) e perseguem o alvo
  // travado. Existem quatro formas de escapar deles — manobrar, dobra,
  // iscas de dispersão, ou abatê-los a tiro —, e é isso que os torna
  // uma ameaça administrável em vez de um imposto.
  {
    id: 'torpedo_seeker', name: 'Torpedo Perseguidor', kind: 'Weapon', tier: 4, mass: 22, cost: 5400,
    blurb: 'Vira bem e persegue longe, mas é frágil e tem pouco fôlego.',
    stats: { damage: 140, fireRate: 0.11 },
  },
  {
    id: 'torpedo_heavy', name: 'Torpedo Pesado', kind: 'Weapon', tier: 5, mass: 44, cost: 9200,
    blurb: 'Dói muito e aguenta tiro. Vira mal: quem reagir cedo sai da curva.',
    stats: { damage: 380, fireRate: 0.11 },
  },

  // ---------- Armas ----------
  {
    id: 'railgun_s', name: 'Canhão Linear S', kind: 'Weapon', tier: 1, mass: 20, cost: 400,
    blurb: 'Projétil cinético. Dano moderado, cadência alta.',
    stats: { damage: 24, fireRate: 3.2 },
  },
  {
    id: 'plasma_m', name: 'Canhão Plasma M', kind: 'Weapon', tier: 3, mass: 45, cost: 2100,
    blurb: 'Salvas pesadas e lentas. Pune quem erra o posicionamento.',
    stats: { damage: 72, fireRate: 1.1 },
  },
  {
    id: 'laser_burst', name: 'Laser em Rajada', kind: 'Weapon', tier: 2, mass: 26, cost: 950,
    blurb: 'Cadência altíssima, dano baixo. Derrete escudos.',
    stats: { damage: 12, fireRate: 6.5 },
  },
  {
    id: 'lance_singular', name: 'Lança Singular', kind: 'Weapon', tier: 5, mass: 62, cost: 9800,
    blurb: 'Um tiro, uma decisão. Recarga longa, dano devastador.',
    stats: { damage: 210, fireRate: 0.35 },
  },

  // ---------- Escudos ----------
  {
    id: 'shield_bio', name: 'Escudo Biônico', kind: 'Shield', tier: 2, mass: 15, cost: 700,
    blurb: 'Barreira equilibrada com regeneração constante.',
    stats: { shield: 260, shieldRegen: 9 },
  },
  {
    id: 'shield_bulwark', name: 'Baluarte Pesado', kind: 'Shield', tier: 4, mass: 38, cost: 3900,
    blurb: 'Capacidade enorme, regeneração lenta. Para linha de frente.',
    stats: { shield: 620, shieldRegen: 4, hull: 120 },
  },
  {
    id: 'shield_phase', name: 'Defletor de Fase', kind: 'Shield', tier: 3, mass: 12, cost: 2400,
    blurb: 'Pouca capacidade, regeneração agressiva. Recompensa desengajar.',
    stats: { shield: 180, shieldRegen: 26 },
  },

  // ---------- Sensores ----------
  {
    id: 'sensor_array', name: 'Array de Sensores', kind: 'Sensor', tier: 1, mass: 5, cost: 180,
    blurb: 'Varredura básica. Mostra contatos próximos no radar.',
    stats: { sensorRange: 600 },
  },
  {
    id: 'sensor_deep', name: 'Varredura Profunda', kind: 'Sensor', tier: 3, mass: 9, cost: 1600,
    blurb: 'Enxerga primeiro. Enxergar primeiro decide o combate.',
    stats: { sensorRange: 1500 },
  },

  // ---------- Carga ----------
  {
    id: 'cargo_x2', name: 'Expansão de Carga +2', kind: 'Cargo', tier: 1, mass: 8, cost: 220,
    blurb: 'Porão extra para minério e destroços.',
    stats: { cargo: 40 },
  },
  {
    id: 'cargo_hauler', name: 'Porão Industrial', kind: 'Cargo', tier: 3, mass: 30, cost: 1500,
    blurb: 'Muito espaço, muita massa. Mineração dedicada.',
    stats: { cargo: 160, hull: 60 },
  },

  // ---------- Dobra ----------
  // Ocupam slot de motor: melhorar o salto compete com empuxo normal.
  {
    id: 'warp_coil', name: 'Bobina de Dobra', kind: 'Engine', tier: 3, mass: 18, cost: 2600,
    blurb: 'Salto de dobra mais longo e mais forte. Não dá empuxo comum.',
    stats: {},
  },
  {
    id: 'vortex_tap', name: 'Captador de Vórtice', kind: 'Sensor', tier: 4, mass: 11, cost: 3800,
    blurb: 'Aproveita muito melhor o rastro de dobra ALHEIO. Feito para caçar.',
    stats: { sensorRange: 300 },
  },
  {
    id: 'wake_stabilizer', name: 'Estabilizador de Esteira', kind: 'Sensor', tier: 3, mass: 14, cost: 2200,
    blurb: 'Seu rastro dura muito mais — a esquadra inteira pega carona.',
    stats: { sensorRange: 150 },
  },

  // ---------- Furtividade ----------
  {
    id: 'cloak_lvl1', name: 'Camuflagem I', kind: 'Stealth', tier: 1, mass: 12, cost: 600,
    blurb: 'Reduz sua assinatura. Emboscadas ficam viáveis.',
    stats: { stealth: 0.18 },
  },
  {
    id: 'cloak_umbra', name: 'Manto Umbra', kind: 'Stealth', tier: 4, mass: 22, cost: 4400,
    blurb: 'Quase invisível ao radar — sacrifica escudo pelo silêncio.',
    stats: { stealth: 0.45, shield: -80 },
  },
];

/** Índice por id para lookup O(1) a partir de um loadout salvo. */
const BY_ID = new Map(COMPONENT_LIBRARY.map((c) => [c.id, c]));

export function componentById(id: string): UiComponentTemplate | undefined {
  return BY_ID.get(id);
}

/** Nome legível da raridade, usado nos cards do shipyard. */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case 1: return 'Comum';
    case 2: return 'Incomum';
    case 3: return 'Raro';
    case 4: return 'Épico';
    case 5: return 'Lendário';
  }
}
